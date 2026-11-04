/**
 * 书单存储：微信云开发数据库 + 云存储
 * 集合：novels / prefs / feedback（反馈经云函数写入）
 */

const LOCAL_NOVELS_KEY = 'novel-wishlist-v1'
const LOCAL_PREFS_KEY = 'novel-wishlist-prefs-v1'
const LOCAL_MIGRATED_KEY = 'novel-wishlist-migrated-to-cloud'

const PRESET_TAGS = [
  '未读',
  '已读',
  '仙侠',
  '玄幻',
  '甜宠',
  '言情',
  '悬疑',
  '推理',
  '科幻',
  '现实',
  '历史',
  '轻小说',
  '追更中',
]

const PAGE_SIZE = 30

/** @type {any[]} */
let novelsCache = []
/** 全部书里出现过的标签（轻量字段汇总） */
let novelTagsCache = []
/** @type {{ customTags: string[], hiddenPresets: string[], tagOrder: string[], theme?: any }} */
let prefsCache = { customTags: [], hiddenPresets: [], tagOrder: [], theme: null }
let loaded = false
let loadingPromise = null
/** @type {{ at: number, list: any[] } | null} */
let allNovelsFetchCache = null
const ALL_NOVELS_CACHE_MS = 2500

function db() {
  return wx.cloud.database()
}

function uid() {
  return `n_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function clampRating(n) {
  const r = Number(n)
  if (!Number.isFinite(r) || r <= 0) return 0
  return Math.min(5, Math.round(r))
}

function syncReadTags(tags, isRead) {
  const next = (tags || []).filter((t) => t !== '未读' && t !== '已读')
  next.unshift(isRead ? '已读' : '未读')
  return next
}

/** 置顶书用更大的 listScore，便于单字段排序 */
function calcListScore(pinned, pinnedAt, createdAt) {
  const created = Number(createdAt) || 0
  if (pinned) return 2000000000000000 + (Number(pinnedAt) || created || Date.now())
  return created
}

function normalize(raw) {
  const tags = Array.isArray(raw.tags) ? raw.tags : []
  const isRead =
    typeof raw.isRead === 'boolean'
      ? raw.isRead
      : tags.includes('已读') && !tags.includes('未读')
  const pinned = Boolean(raw.pinned)
  const pinnedAt = pinned ? Number(raw.pinnedAt) || Number(raw.createdAt) || Date.now() : 0
  const createdAt = raw.createdAt || Date.now()
  const listScore =
    raw.listScore != null && raw.listScore !== ''
      ? Number(raw.listScore) || calcListScore(pinned, pinnedAt, createdAt)
      : calcListScore(pinned, pinnedAt, createdAt)
  return {
    id: raw._id || raw.id || uid(),
    title: (raw.title || '').trim(),
    author: (raw.author || '').trim(),
    synopsis: (raw.synopsis || '').trim(),
    tags: syncReadTags(tags, isRead),
    isRead: Boolean(isRead),
    wantToRead: Boolean(raw.wantToRead),
    disliked: Boolean(raw.disliked),
    pinned: pinned,
    pinnedAt: pinnedAt,
    listScore: listScore,
    rating: clampRating(raw.rating),
    review: (raw.review || '').trim(),
    attachmentFileID: raw.attachmentFileID || '',
    attachmentName: raw.attachmentName || '',
    attachmentSize: raw.attachmentSize || 0,
    // 兼容旧本地字段名
    attachmentPath: raw.attachmentFileID || raw.attachmentPath || '',
    lastReadAt: Number(raw.lastReadAt) || 0,
    createdAt: createdAt,
    updatedAt: raw.updatedAt || Date.now(),
  }
}

function toDoc(novel) {
  return {
    title: novel.title,
    author: novel.author,
    synopsis: novel.synopsis,
    tags: novel.tags,
    isRead: novel.isRead,
    wantToRead: novel.wantToRead,
    disliked: Boolean(novel.disliked),
    pinned: Boolean(novel.pinned),
    pinnedAt: novel.pinned ? Number(novel.pinnedAt) || 0 : 0,
    listScore: calcListScore(novel.pinned, novel.pinnedAt, novel.createdAt),
    rating: novel.rating,
    review: novel.review,
    attachmentFileID: novel.attachmentFileID || '',
    attachmentName: novel.attachmentName || '',
    attachmentSize: novel.attachmentSize || 0,
    lastReadAt: Number(novel.lastReadAt) || 0,
    createdAt: novel.createdAt,
    updatedAt: novel.updatedAt,
  }
}

function assertCloud() {
  if (!wx.cloud) throw new Error('当前基础库不支持云开发')
  const app = getApp()
  const env = app && app.globalData && app.globalData.envId
  if (!env) {
    throw new Error('请先在 miniprogram/cloudEnv.js 填写云环境 envId，并开通云开发')
  }
}

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms)
  })
}

function invalidateAllNovelsCache() {
  allNovelsFetchCache = null
}

async function fetchAllNovelsFromCloud() {
  const now = Date.now()
  if (
    allNovelsFetchCache &&
    now - allNovelsFetchCache.at < ALL_NOVELS_CACHE_MS &&
    Array.isArray(allNovelsFetchCache.list)
  ) {
    return allNovelsFetchCache.list.slice()
  }
  const col = db().collection('novels')
  // 小程序端单次查询最多 20 条；写成 100 时 batch 只有 20，会被误判为「已经拉完」
  const MAX = 20
  const MAX_PAGES = 100
  let all = []
  let skip = 0
  let page = 0
  let expected = 0
  try {
    const countRes = await col.count()
    expected = (countRes && countRes.total) || 0
  } catch (e) {
    expected = 0
  }
  while (page < MAX_PAGES) {
    let batch = []
    try {
      // 用 _id 稳定翻页，避免无 orderBy 时 skip 漏文档
      const res = await col.orderBy('_id', 'asc').skip(skip).limit(MAX).get()
      batch = res.data || []
    } catch (e) {
      const res = await col.skip(skip).limit(MAX).get()
      batch = res.data || []
    }
    all = all.concat(batch)
    if (batch.length < MAX) break
    if (expected && all.length >= expected) break
    skip += MAX
    page += 1
    await sleep(0)
  }
  const list = all.map(normalize)
  allNovelsFetchCache = { at: Date.now(), list: list }
  return list.slice()
}

async function refreshNovelTags() {
  const col = db().collection('novels').field({ tags: true })
  const MAX = 20
  const MAX_PAGES = 100
  const set = new Set()
  let skip = 0
  let page = 0
  while (page < MAX_PAGES) {
    const res = await col.skip(skip).limit(MAX).get()
    const batch = res.data || []
    batch.forEach(function (row) {
      ;(row.tags || []).forEach(function (t) {
        if (t) set.add(t)
      })
    })
    if (batch.length < MAX) break
    skip += MAX
    page += 1
    await sleep(0)
  }
  novelTagsCache = Array.from(set)
}

function escapeRegExp(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildNovelQuery(opts) {
  opts = opts || {}
  const _ = db().command
  const andList = []

  if (opts.readFilter === 'read') {
    andList.push({ isRead: true })
    andList.push({ disliked: _.neq(true) })
  } else if (opts.readFilter === 'unread') {
    andList.push({ isRead: false })
    andList.push({ disliked: _.neq(true) })
  } else if (opts.readFilter === 'want') {
    andList.push({ wantToRead: true })
    andList.push({ disliked: _.neq(true) })
  } else if (opts.readFilter === 'dislike') {
    andList.push({ disliked: true })
  } else if (opts.readFilter === 'all' || !opts.readFilter) {
    // 「全部」排除不喜欢；导出等用 includeDisliked / raw
    andList.push({ disliked: _.neq(true) })
  }
  // readFilter === 'raw'：不过滤不喜欢（计数 / 导出）

  const tags = (Array.isArray(opts.tags) ? opts.tags : []).filter(Boolean)
  if (tags.length === 1) andList.push({ tags: tags[0] })
  else if (tags.length > 1) andList.push({ tags: _.in(tags) })

  const q = String(opts.query || '').trim()
  if (q) {
    const reg = db().RegExp({ regexp: escapeRegExp(q), options: 'i' })
    // 书名 / 作者 / 简介 / 短评 / 标签
    andList.push(
      _.or([
        { title: reg },
        { author: reg },
        { synopsis: reg },
        { review: reg },
        { tags: reg },
      ]),
    )
  }

  let query = db().collection('novels')
  if (andList.length === 1) query = query.where(andList[0])
  else if (andList.length > 1) query = query.where(_.and(andList))
  return query
}

async function fetchPrefsFromCloud() {
  const res = await db().collection('prefs').limit(1).get()
  const row = (res.data || [])[0]
  if (!row) {
    const prefs = { customTags: [], hiddenPresets: [], tagOrder: [], theme: null }
    await db().collection('prefs').add({ data: prefs })
    return prefs
  }
  return {
    _id: row._id,
    customTags: Array.isArray(row.customTags) ? row.customTags : [],
    hiddenPresets: Array.isArray(row.hiddenPresets) ? row.hiddenPresets : [],
    tagOrder: Array.isArray(row.tagOrder) ? row.tagOrder : [],
    theme: row.theme && typeof row.theme === 'object' ? row.theme : null,
  }
}

async function savePrefs() {
  const payload = {
    customTags: prefsCache.customTags || [],
    hiddenPresets: prefsCache.hiddenPresets || [],
    tagOrder: prefsCache.tagOrder || [],
    theme: prefsCache.theme || null,
  }
  if (prefsCache._id) {
    await db().collection('prefs').doc(prefsCache._id).update({ data: payload })
  } else {
    const addRes = await db().collection('prefs').add({ data: payload })
    prefsCache._id = addRes._id
  }
}

function readLocalNovels() {
  try {
    const list = wx.getStorageSync(LOCAL_NOVELS_KEY)
    return Array.isArray(list) ? list.map(normalize) : []
  } catch (e) {
    return []
  }
}

function readLocalPrefs() {
  try {
    const p = wx.getStorageSync(LOCAL_PREFS_KEY)
    if (p && typeof p === 'object') {
      return {
        customTags: Array.isArray(p.customTags) ? p.customTags : [],
        hiddenPresets: Array.isArray(p.hiddenPresets) ? p.hiddenPresets : [],
        tagOrder: Array.isArray(p.tagOrder) ? p.tagOrder : [],
      }
    }
  } catch (e) {
    /* ignore */
  }
  return { customTags: [], hiddenPresets: [], tagOrder: [] }
}

/** 云端为空时，把本地旧数据迁上去一次 */
async function migrateLocalIfNeeded() {
  if (wx.getStorageSync(LOCAL_MIGRATED_KEY) === '1') return { migrated: false, count: 0 }

  const countRes = await db().collection('novels').count()
  if ((countRes.total || 0) > 0) {
    wx.setStorageSync(LOCAL_MIGRATED_KEY, '1')
    return { migrated: false, count: 0 }
  }

  const localNovels = readLocalNovels()
  const localPrefs = readLocalPrefs()
  if (!localNovels.length && !localPrefs.customTags.length && !localPrefs.hiddenPresets.length) {
    wx.setStorageSync(LOCAL_MIGRATED_KEY, '1')
    return { migrated: false, count: 0 }
  }

  prefsCache = {
    ...prefsCache,
    customTags: [...new Set([...(prefsCache.customTags || []), ...localPrefs.customTags])],
    hiddenPresets: [...new Set([...(prefsCache.hiddenPresets || []), ...localPrefs.hiddenPresets])],
    tagOrder: localPrefs.tagOrder.length ? localPrefs.tagOrder : prefsCache.tagOrder,
  }
  await savePrefs()

  let count = 0
  for (const n of localNovels) {
    const doc = toDoc(n)
    doc.attachmentFileID = ''
    doc.attachmentName = n.attachmentName && String(n.attachmentPath || '').startsWith('cloud://')
      ? n.attachmentName
      : ''
    doc.attachmentSize = doc.attachmentName ? n.attachmentSize : 0
    if (String(n.attachmentPath || '').startsWith('cloud://')) {
      doc.attachmentFileID = n.attachmentPath
      doc.attachmentName = n.attachmentName
      doc.attachmentSize = n.attachmentSize
    }
    await db().collection('novels').add({ data: doc })
    count += 1
    if (count % 5 === 0) await sleep(0)
  }

  wx.setStorageSync(LOCAL_MIGRATED_KEY, '1')
  return { migrated: count > 0, count }
}

async function backfillListScoreIfNeeded() {
  // v2：补齐缺 listScore 的旧书；orderBy(listScore) 会直接漏掉这些文档
  if (wx.getStorageSync('listscore-backfill-v2') === '1') return
  try {
    const all = await fetchAllNovelsFromCloud()
    for (let i = 0; i < all.length; i++) {
      const n = all[i]
      const score = calcListScore(n.pinned, n.pinnedAt, n.createdAt)
      await db()
        .collection('novels')
        .doc(n.id)
        .update({
          data: {
            pinned: Boolean(n.pinned),
            pinnedAt: n.pinned ? Number(n.pinnedAt) || 0 : 0,
            listScore: score,
            isRead: Boolean(n.isRead),
          },
        })
      if ((i + 1) % 5 === 0) await sleep(0)
    }
    wx.setStorageSync('listscore-backfill-v2', '1')
  } catch (e) {
    console.warn('listScore 回填失败', e)
  }
}

async function refreshStore() {
  assertCloud()
  prefsCache = await fetchPrefsFromCloud()
  try {
    const themeUtil = require('./theme')
    if (prefsCache.theme) {
      themeUtil.setActiveTheme(prefsCache.theme)
    } else {
      // 云端无主题时，把本地主题写回云端
      const localTheme = themeUtil.getActiveTheme()
      prefsCache.theme = themeUtil.persistable(localTheme)
      await savePrefs()
      themeUtil.setActiveTheme(localTheme)
    }
  } catch (e) {
    console.warn('同步主题失败', e)
  }
  const mig = await migrateLocalIfNeeded()
  await refreshNovelTags()
  invalidateAllNovelsCache()
  novelsCache = []
  loaded = true
  // 旧书补 listScore，避免 orderBy 时查不到
  backfillListScoreIfNeeded()
  return { migrated: mig }
}

function getThemePrefs() {
  return prefsCache.theme || null
}

async function saveThemePrefs(themeInput) {
  await ensureLoaded()
  const themeUtil = require('./theme')
  const prev = themeUtil.getActiveTheme()
  const next = themeUtil.setActiveTheme(themeInput)
  // 换掉旧背景图时，尽量删掉云文件
  if (
    prev.bgImageFileID &&
    prev.bgImageFileID !== next.bgImageFileID &&
    String(prev.bgImageFileID).indexOf('cloud://') === 0
  ) {
    try {
      await removeCloudFile(prev.bgImageFileID)
    } catch (e) {
      console.warn('删除旧背景图失败', e)
    }
  }
  prefsCache.theme = themeUtil.persistable(next)
  await savePrefs()
  return next
}

async function uploadThemeBackground(tempFilePath) {
  assertCloud()
  const extMatch = String(tempFilePath || '').match(/\.[a-zA-Z0-9]+$/)
  const ext = (extMatch && extMatch[0]) || '.jpg'
  const cloudPath = 'theme-bg/' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + ext
  const up = await wx.cloud.uploadFile({
    cloudPath: cloudPath,
    filePath: tempFilePath,
  })
  if (!up.fileID) throw new Error('背景图上传失败')
  return up.fileID
}

async function ensureLoaded() {
  if (loaded) return
  if (loadingPromise) return loadingPromise
  loadingPromise = refreshStore()
    .catch((err) => {
      loaded = false
      throw err
    })
    .finally(() => {
      loadingPromise = null
    })
  return loadingPromise
}

function matchesFilters(n, { query = '', readFilter = 'all', tags = [], minRating = 0 } = {}) {
  if (readFilter === 'read' && !n.isRead) return false
  if (readFilter === 'unread' && n.isRead) return false
  if (readFilter === 'want' && !n.wantToRead) return false
  if (readFilter === 'dislike' && !n.disliked) return false
  // raw：含不喜欢（导出/计数底表）；其余非 dislike 均排除
  if (readFilter !== 'dislike' && readFilter !== 'raw' && n.disliked) return false
  const needTags = (Array.isArray(tags) ? tags : []).filter(Boolean)
  // 多标签组合：需同时包含（AND）
  if (needTags.length && !needTags.every((t) => (n.tags || []).includes(t))) return false
  const minR = Math.max(0, Math.min(5, Number(minRating) || 0))
  if (minR > 0 && (Number(n.rating) || 0) < minR) return false
  const q = String(query || '').trim().toLowerCase()
  if (!q) return true
  return (
    n.title.toLowerCase().includes(q) ||
    n.author.toLowerCase().includes(q) ||
    (n.tags || []).some((t) => t.toLowerCase().includes(q)) ||
    (n.synopsis || '').toLowerCase().includes(q) ||
    (n.review || '').toLowerCase().includes(q)
  )
}

const SORT_OPTIONS = [
  { key: 'pin', label: '置顶优先' },
  { key: 'recentRead', label: '最近在读' },
  { key: 'rating', label: '评分从高到低' },
  { key: 'title', label: '书名 A→Z' },
  { key: 'updated', label: '最近更新' },
]

function normalizeSortKey(sort) {
  const ok = SORT_OPTIONS.some(function (o) {
    return o.key === sort
  })
  return ok ? sort : 'pin'
}

function getSortLabel(sort) {
  const key = normalizeSortKey(sort)
  const hit = SORT_OPTIONS.find(function (o) {
    return o.key === key
  })
  return (hit && hit.label) || '置顶优先'
}

/** 置顶始终最前，再按规则排 */
function compareNovels(a, b, sort) {
  const ap = a && a.pinned ? 1 : 0
  const bp = b && b.pinned ? 1 : 0
  if (bp !== ap) return bp - ap
  if (ap && bp) {
    const pinDiff = (Number(b.pinnedAt) || 0) - (Number(a.pinnedAt) || 0)
    if (pinDiff) return pinDiff
  }

  const key = normalizeSortKey(sort)
  if (key === 'recentRead') {
    return (
      (Number(b.lastReadAt) || 0) - (Number(a.lastReadAt) || 0) ||
      (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0) ||
      (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0)
    )
  }
  if (key === 'rating') {
    return (
      (Number(b.rating) || 0) - (Number(a.rating) || 0) ||
      (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0) ||
      (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0)
    )
  }
  if (key === 'title') {
    return String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN')
  }
  if (key === 'updated') {
    return (
      (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0) ||
      (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0)
    )
  }
  // pin / 默认：listScore
  return (
    (Number(b.listScore) || 0) - (Number(a.listScore) || 0) ||
    (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0)
  )
}

/**
 * 分页取书（每次最多 PAGE_SIZE 条）
 * 先全量拉齐再本地排序分页，避免云端 orderBy 漏掉缺字段的旧书。
 * @returns {Promise<{ list:any[], page:number, pageSize:number, total:number, totalPages:number }>}
 */
async function listNovelsPage(opts) {
  opts = opts || {}
  await ensureLoaded()
  const pageSize = PAGE_SIZE
  let page = Math.max(1, Number(opts.page) || 1)
  const sort = normalizeSortKey(opts.sort)

  const all = await listNovels({
    query: opts.query,
    readFilter: opts.readFilter,
    tags: opts.tags,
    minRating: opts.minRating,
  })
  all.sort(function (a, b) {
    return compareNovels(a, b, sort)
  })
  const total = all.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1)
  if (page > totalPages) page = totalPages
  const skip = (page - 1) * pageSize
  const list = all.slice(skip, skip + pageSize)
  return { list, page, pageSize, total, totalPages }
}


/** 状态 Tab 数量：尊重搜索与标签，不含当前 readFilter */
async function countNovelsByStatus(opts) {
  opts = opts || {}
  await ensureLoaded()
  // raw：含不喜欢，再本地切分，保证「全部」与「不喜欢」数字一致
  const list = await listNovels({
    query: opts.query || '',
    tags: Array.isArray(opts.tags) ? opts.tags : [],
    minRating: opts.minRating,
    readFilter: 'raw',
  })
  var unread = 0
  var want = 0
  var read = 0
  var dislike = 0
  var all = 0
  list.forEach(function (n) {
    if (n.disliked) {
      dislike += 1
      return
    }
    all += 1
    if (n.isRead) read += 1
    else unread += 1
    if (n.wantToRead) want += 1
  })
  return {
    all: all,
    unread: unread,
    want: want,
    read: read,
    dislike: dislike,
  }
}

/** 兼容旧调用：取当前筛选下全部（导出等用） */
async function listNovels(opts) {
  opts = opts || {}
  await ensureLoaded()
  // 先拉齐整库，再本地筛选。避免 where+orderBy/skip 组合把缺字段的旧书漏掉
  // （典型现象：搜索「上心」能中，但「全部」翻遍每一页都看不到）
  const all = await fetchAllNovelsFromCloud()
  const filtered = all.filter(function (n) {
    return matchesFilters(n, {
      query: opts.query,
      readFilter: opts.readFilter || 'all',
      tags: opts.tags,
      minRating: opts.minRating,
    })
  })
  filtered.sort(function (a, b) {
    return compareNovels(a, b, 'pin')
  })
  return filtered
}

/** 最近在读（有 lastReadAt，排除不喜欢） */
async function listRecentReading(limit) {
  await ensureLoaded()
  const max = Math.max(1, Math.min(50, Number(limit) || 20))
  const all = await fetchAllNovelsFromCloud()
  return all
    .filter(function (n) {
      return (Number(n.lastReadAt) || 0) > 0 && !n.disliked
    })
    .sort(function (a, b) {
      return (Number(b.lastReadAt) || 0) - (Number(a.lastReadAt) || 0)
    })
    .slice(0, max)
}

async function getNovel(id) {
  await ensureLoaded()
  const cached = novelsCache.find((n) => n.id === id)
  if (cached) return cached
  try {
    const res = await db().collection('novels').doc(id).get()
    if (!res.data) return null
    const novel = normalize(res.data)
    novelsCache.push(novel)
    return novel
  } catch (e) {
    return null
  }
}

function rememberCustomTags(tags) {
  let dirty = false
  for (const t of tags || []) {
    if (!PRESET_TAGS.includes(t) && !(prefsCache.customTags || []).includes(t)) {
      prefsCache.customTags = [...(prefsCache.customTags || []), t]
      dirty = true
    }
    if (!(prefsCache.tagOrder || []).includes(t)) {
      prefsCache.tagOrder = [...(prefsCache.tagOrder || []), t]
      dirty = true
    }
  }
  const nextHidden = (prefsCache.hiddenPresets || []).filter(
    (x) => !(tags || []).includes(x),
  )
  if (nextHidden.length !== (prefsCache.hiddenPresets || []).length) {
    prefsCache.hiddenPresets = nextHidden
    dirty = true
  }
  return dirty
}

async function upsertNovel(data) {
  await ensureLoaded()
  invalidateAllNovelsCache()
  const title = (data.title || '').trim()
  if (!title) throw new Error('请填写书名')

  let tags = [...new Set((data.tags || []).map((t) => String(t).trim()).filter(Boolean))]
  let isRead = Boolean(data.isRead)
  if (tags.includes('已读') && !tags.includes('未读')) isRead = true
  if (tags.includes('未读') && !tags.includes('已读')) isRead = false
  if (typeof data.isRead === 'boolean') isRead = data.isRead
  tags = syncReadTags(tags, isRead)
  if (rememberCustomTags(tags)) await savePrefs()

  const now = Date.now()

  if (data.id) {
    const i = novelsCache.findIndex((n) => n.id === data.id)
    if (i < 0) throw new Error('找不到这本小说')
    const prev = novelsCache[i]
    const pinned =
      data.pinned !== undefined ? Boolean(data.pinned) : Boolean(prev.pinned)
    const pinnedAt = pinned
      ? data.pinnedAt !== undefined
        ? Number(data.pinnedAt) || now
        : prev.pinnedAt || now
      : 0
    let wantToRead =
      data.wantToRead !== undefined ? Boolean(data.wantToRead) : Boolean(prev.wantToRead)
    let disliked =
      data.disliked !== undefined ? Boolean(data.disliked) : Boolean(prev.disliked)
    if (wantToRead && disliked) {
      if (data.disliked !== undefined && data.wantToRead === undefined) wantToRead = false
      else disliked = false
    }
    const next = normalize({
      ...prev,
      ...data,
      _id: prev.id,
      title,
      tags,
      isRead,
      rating: data.rating !== undefined ? clampRating(data.rating) : prev.rating,
      review: data.review !== undefined ? String(data.review || '').trim() : prev.review,
      wantToRead,
      disliked,
      pinned,
      pinnedAt,
      listScore: calcListScore(pinned, pinnedAt, prev.createdAt),
      attachmentFileID:
        data.attachmentFileID !== undefined
          ? data.attachmentFileID || ''
          : data.attachmentPath !== undefined
            ? data.attachmentPath || ''
            : prev.attachmentFileID,
      attachmentName:
        data.attachmentName !== undefined ? data.attachmentName || '' : prev.attachmentName,
      attachmentSize:
        data.attachmentSize !== undefined ? data.attachmentSize || 0 : prev.attachmentSize,
      lastReadAt:
        data.lastReadAt !== undefined ? Number(data.lastReadAt) || 0 : prev.lastReadAt || 0,
      createdAt: prev.createdAt,
      updatedAt: now,
    })
    await db().collection('novels').doc(prev.id).update({ data: toDoc(next) })
    novelsCache[i] = next
    ;(tags || []).forEach(function (t) {
      if (t && novelTagsCache.indexOf(t) < 0) novelTagsCache.push(t)
    })
    return next
  }

  let wantToRead = Boolean(data.wantToRead)
  let disliked = Boolean(data.disliked)
  if (wantToRead && disliked) disliked = false
  const novel = normalize({
    ...data,
    title,
    tags,
    isRead,
    wantToRead,
    disliked,
    createdAt: now,
    updatedAt: now,
    attachmentFileID: data.attachmentFileID || data.attachmentPath || '',
  })
  const addRes = await db().collection('novels').add({ data: toDoc(novel) })
  novel.id = addRes._id
  novelsCache.unshift(novel)
  ;(tags || []).forEach(function (t) {
    if (t && novelTagsCache.indexOf(t) < 0) novelTagsCache.push(t)
  })
  return novel
}

async function removeCloudFile(fileID) {
  if (!fileID || !String(fileID).startsWith('cloud://')) return
  try {
    await wx.cloud.deleteFile({ fileList: [fileID] })
  } catch (e) {
    console.warn('删除云文件失败', e)
  }
}

async function deleteNovel(id) {
  await ensureLoaded()
  invalidateAllNovelsCache()
  const n = novelsCache.find((x) => x.id === id)
  if (n && n.attachmentFileID) await removeCloudFile(n.attachmentFileID)
  await db().collection('novels').doc(id).remove()
  novelsCache = novelsCache.filter((x) => x.id !== id)
}

async function setNovelRead(id, isRead) {
  const n = await getNovel(id)
  if (!n) throw new Error('找不到这本小说')
  return upsertNovel({ ...n, isRead: Boolean(isRead) })
}

async function setNovelWant(id, wantToRead) {
  const n = await getNovel(id)
  if (!n) throw new Error('找不到这本小说')
  const want = Boolean(wantToRead)
  // 很想看 / 不喜欢互斥
  return upsertNovel({
    ...n,
    wantToRead: want,
    disliked: want ? false : n.disliked,
  })
}

async function setNovelDisliked(id, disliked) {
  const n = await getNovel(id)
  if (!n) throw new Error('找不到这本小说')
  const off = Boolean(disliked)
  return upsertNovel({
    ...n,
    disliked: off,
    wantToRead: off ? false : n.wantToRead,
  })
}

async function setNovelRating(id, rating) {
  const n = await getNovel(id)
  if (!n) throw new Error('找不到这本小说')
  let next = clampRating(rating)
  if (next === n.rating && next > 0) next = 0
  return upsertNovel({ ...n, rating: next })
}

async function setNovelPin(id, pinned) {
  const n = await getNovel(id)
  if (!n) throw new Error('找不到这本小说')
  const on = Boolean(pinned)
  return upsertNovel({
    ...n,
    pinned: on,
    pinnedAt: on ? Date.now() : 0,
  })
}

/** 记录最近看过时间；不传则用当前时间 */
async function setNovelLastRead(id, at) {
  const n = await getNovel(id)
  if (!n) throw new Error('找不到这本小说')
  const ts = at != null ? Number(at) || Date.now() : Date.now()
  return upsertNovel({
    ...n,
    lastReadAt: ts,
  })
}

async function getAllTags() {
  await ensureLoaded()
  if (!novelTagsCache.length) {
    try {
      await refreshNovelTags()
    } catch (e) {
      console.warn('刷新标签汇总失败', e)
    }
  }
  const hidden = new Set(prefsCache.hiddenPresets || [])
  const presets = PRESET_TAGS.filter((t) => !hidden.has(t))
  const fromNovels = novelTagsCache.concat(
    novelsCache.flatMap((n) => n.tags || []),
  )
  const all = [...new Set([...presets, ...(prefsCache.customTags || []), ...fromNovels])]
  const order = prefsCache.tagOrder || []
  if (!order.length) return all
  const set = new Set(all)
  const ordered = []
  for (const t of order) {
    if (set.has(t)) {
      ordered.push(t)
      set.delete(t)
    }
  }
  for (const t of all) if (set.has(t)) ordered.push(t)
  return ordered
}

async function addCustomTag(tag) {
  await ensureLoaded()
  const t = String(tag || '').trim()
  if (!t) return getAllTags()
  prefsCache.hiddenPresets = (prefsCache.hiddenPresets || []).filter((x) => x !== t)
  if (!PRESET_TAGS.includes(t) && !(prefsCache.customTags || []).includes(t)) {
    prefsCache.customTags = [...(prefsCache.customTags || []), t]
  }
  if (!(prefsCache.tagOrder || []).includes(t)) {
    prefsCache.tagOrder = [...(prefsCache.tagOrder || []), t]
  }
  await savePrefs()
  return getAllTags()
}

async function setTagOrder(order) {
  await ensureLoaded()
  const list = (Array.isArray(order) ? order : [])
    .map(function (t) {
      return String(t || '').trim()
    })
    .filter(Boolean)
  // 去重保序
  const seen = new Set()
  const next = []
  list.forEach(function (t) {
    if (seen.has(t)) return
    seen.add(t)
    next.push(t)
  })
  prefsCache.tagOrder = next
  await savePrefs()
  return getAllTags()
}

async function deleteTag(tag) {
  await ensureLoaded()
  const t = String(tag || '').trim()
  if (!t) return { removedFromNovels: 0 }
  prefsCache.customTags = (prefsCache.customTags || []).filter((x) => x !== t)
  prefsCache.tagOrder = (prefsCache.tagOrder || []).filter((x) => x !== t)
  if (PRESET_TAGS.includes(t) && !(prefsCache.hiddenPresets || []).includes(t)) {
    prefsCache.hiddenPresets = [...(prefsCache.hiddenPresets || []), t]
  }
  await savePrefs()

  let removedFromNovels = 0
  for (const n of novelsCache) {
    if (!(n.tags || []).includes(t)) continue
    n.tags = n.tags.filter((x) => x !== t)
    n.updatedAt = Date.now()
    await db().collection('novels').doc(n.id).update({ data: { tags: n.tags, updatedAt: n.updatedAt } })
    removedFromNovels += 1
  }
  return { removedFromNovels }
}

async function pickRandomNovel(opts) {
  opts = opts || {}
  await ensureLoaded()
  const excludeId = opts.excludeId || ''
  let all = await listNovels({
    query: opts.query,
    readFilter: opts.readFilter,
    tags: opts.tags,
    minRating: opts.minRating,
  })
  // 非「不喜欢」筛选时，随机抽书默认排除不喜欢的
  if (opts.readFilter !== 'dislike') {
    all = all.filter(function (n) {
      return !n.disliked
    })
  }
  if (!all.length) return null
  const pool = excludeId ? all.filter(function (n) { return n.id !== excludeId }) : all
  const list = pool.length ? pool : all
  return list[Math.floor(Math.random() * list.length)] || null
}

/**
 * 提交问题反馈（经云函数写入 feedback 集合）
 * 控制台查看：云开发 → 数据库 → feedback
 * 集合权限建议：所有用户不可读写（读写只走云函数 / 控制台）
 */
async function submitFeedback(payload) {
  payload = payload || {}
  const content = String(payload.content || '').trim()
  if (!content) throw new Error('请填写反馈内容')
  if (content.length > 2000) throw new Error('内容请控制在 2000 字内')
  const contact = String(payload.contact || '').trim()
  if (contact.length > 80) throw new Error('联系方式过长')

  if (!wx.cloud || !wx.cloud.callFunction) {
    throw new Error('当前基础库不支持云开发')
  }

  const res = await wx.cloud.callFunction({
    name: 'submitFeedback',
    data: {
      content: content,
      contact: contact,
    },
  })
  const result = (res && res.result) || {}
  if (!result.ok) {
    throw new Error(result.errMsg || '提交失败')
  }
  return { ok: true, id: result.id }
}

async function exportMarkdown() {
  const novels = await listNovels({ readFilter: 'raw' })
  const lines = ['# 我的书单备份', '', `共 ${novels.length} 本`, '']
  novels.forEach(function (n) {
    const author = n.author ? ' — ' + n.author : ''
    lines.push('- ' + n.title + author)
    const tags = (n.tags || [])
      .filter(function (t) {
        return t !== '已读' && t !== '未读'
      })
      .join('、')
    const rating = n.rating ? n.rating + '星' : '未评分'
    const read = n.isRead ? '已读' : '未读'
    const flags = []
    if (n.wantToRead) flags.push('很想看')
    if (n.disliked) flags.push('不喜欢')
    lines.push(
      '  标签：' +
        (tags || '无') +
        ' · 评分：' +
        rating +
        ' · ' +
        read +
        (flags.length ? ' · ' + flags.join('、') : ''),
    )
    if (n.review) {
      lines.push('  短评：' + String(n.review).replace(/\s*\n\s*/g, ' ').trim())
    }
    if (n.synopsis) {
      lines.push('  ' + String(n.synopsis).replace(/\s*\n\s*/g, ' ').trim())
    }
    lines.push('')
  })
  return lines.join('\n').trim() + '\n'
}

/**
 * 批量改状态 / 加减标签
 * patch: { isRead?, wantToRead?, disliked?, addTags?: string[], removeTags?: string[] }
 */
async function batchPatchNovels(ids, patch) {
  patch = patch || {}
  const idList = (Array.isArray(ids) ? ids : []).filter(Boolean)
  if (!idList.length) return { updated: 0 }
  await ensureLoaded()
  let updated = 0
  for (let i = 0; i < idList.length; i++) {
    const id = idList[i]
    const prev = await getNovel(id)
    if (!prev) continue
    const data = Object.assign({}, prev, { id: id })
    if (patch.isRead !== undefined) data.isRead = Boolean(patch.isRead)
    if (patch.wantToRead !== undefined) data.wantToRead = Boolean(patch.wantToRead)
    if (patch.disliked !== undefined) {
      data.disliked = Boolean(patch.disliked)
      if (data.disliked) data.wantToRead = false
    }
    const addTags = (Array.isArray(patch.addTags) ? patch.addTags : []).filter(Boolean)
    const removeTags = (Array.isArray(patch.removeTags) ? patch.removeTags : []).filter(Boolean)
    if (addTags.length || removeTags.length) {
      let tags = Array.isArray(prev.tags) ? prev.tags.slice() : []
      removeTags.forEach(function (t) {
        tags = tags.filter(function (x) {
          return x !== t
        })
      })
      addTags.forEach(function (t) {
        if (tags.indexOf(t) < 0) tags.push(t)
      })
      data.tags = tags
    }
    await upsertNovel(data)
    updated += 1
    if (updated % 5 === 0) await sleep(0)
  }
  return { updated: updated }
}

async function setNovelReview(id, review) {
  await ensureLoaded()
  const n = await getNovel(id)
  if (!n) throw new Error('找不到这本书')
  return upsertNovel({
    ...n,
    review: String(review || '').trim(),
  })
}

async function importNovels(rows) {
  await ensureLoaded()
  const have = new Set(novelsCache.map((n) => `${n.title}||${n.author || ''}`))
  let added = 0
  let skipped = 0
  const now = Date.now()
  let prefsDirty = false

  for (let i = 0; i < (rows || []).length; i++) {
    const r = rows[i]
    const title = (r.title || '').trim()
    if (!title) continue
    const author = (r.author || '').trim()
    const key = `${title}||${author}`
    if (have.has(key)) {
      skipped += 1
      continue
    }

    let tags = Array.isArray(r.tags) && r.tags.length ? r.tags : ['未读']
    tags = syncReadTags(tags, tags.includes('已读') && !tags.includes('未读'))
    if (rememberCustomTags(tags)) prefsDirty = true

    const novel = normalize({
      title,
      author,
      synopsis: r.synopsis || '',
      tags,
      rating: r.rating,
      review: r.review,
      wantToRead: r.wantToRead,
      disliked: r.disliked,
      createdAt: now - added,
      updatedAt: now - added,
    })
    const addRes = await db().collection('novels').add({ data: toDoc(novel) })
    novel.id = addRes._id
    novelsCache.unshift(novel)
    have.add(key)
    added += 1

    // 每 5 本让出主线程，避免模拟器“长时间没有响应”
    if (added % 5 === 0) await sleep(0)
  }

  if (prefsDirty) await savePrefs()
  try {
    await refreshNovelTags()
  } catch (e) {
    /* ignore */
  }
  return { added, skipped, total: (rows || []).length }
}

function safeFileName(name) {
  return String(name || 'file')
    .replace(/[^\w.\u4e00-\u9fa5-]+/g, '_')
    .slice(0, 80)
}

/** 上传附件到云存储，返回 fileID */
async function uploadAttachment(novelId, tempFilePath, name, size) {
  if (!tempFilePath) throw new Error('没有文件')
  if (size > 20 * 1024 * 1024) throw new Error('附件不能超过 20MB')
  const cloudPath = `attachments/${novelId || 'tmp'}/${Date.now()}_${safeFileName(name)}`
  const res = await wx.cloud.uploadFile({
    cloudPath,
    filePath: tempFilePath,
  })
  if (!res.fileID) throw new Error('上传失败')
  return {
    attachmentFileID: res.fileID,
    attachmentName: name || '附件',
    attachmentSize: size || 0,
  }
}

/** 下载云文件到本地临时路径，供阅读/打开 */
async function downloadAttachment(fileID) {
  if (!fileID) throw new Error('没有附件')
  if (!String(fileID).startsWith('cloud://')) {
    // 兼容极旧本地路径
    return fileID
  }
  const res = await wx.cloud.downloadFile({ fileID })
  if (res.statusCode && res.statusCode !== 200) throw new Error('下载附件失败')
  return res.tempFilePath
}

function isTextAttachment(name = '') {
  const n = String(name || '').toLowerCase()
  return n.endsWith('.txt') || n.endsWith('.text') || n.endsWith('.md')
}

function getPresetTags() {
  return PRESET_TAGS.slice()
}

module.exports = {
  PAGE_SIZE,
  SORT_OPTIONS,
  normalizeSortKey,
  getSortLabel,
  clampRating,
  refreshStore,
  ensureLoaded,
  listNovels,
  listNovelsPage,
  countNovelsByStatus,
  listRecentReading,

  getNovel,
  upsertNovel,
  deleteNovel,
  setNovelRead,
  setNovelWant,
  setNovelDisliked,
  setNovelRating,
  setNovelPin,
  setNovelLastRead,
  setNovelReview,
  batchPatchNovels,
  getAllTags,
  addCustomTag,
  setTagOrder,
  deleteTag,
  getPresetTags,
  pickRandomNovel,
  exportMarkdown,
  submitFeedback,
  importNovels,
  uploadAttachment,
  downloadAttachment,
  removeCloudFile,
  isTextAttachment,
  refreshNovelTags,
  getThemePrefs,
  saveThemePrefs,
  uploadThemeBackground,
}
