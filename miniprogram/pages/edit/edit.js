const store = require('../../utils/store')
const { tagTone } = require('../../utils/tagColors')
const themeBehavior = require('../../behaviors/themeBehavior')

Page({
  behaviors: [themeBehavior],

  data: {
    id: '',
    title: '',
    author: '',
    synopsis: '',
    review: '',
    wantToRead: false,
    disliked: false,
    rating: 0,
    tags: ['未读'],
    selectedMap: { 未读: true },
    selectedChips: [],
    selectedCount: 1,
    allTags: [],
    tagItems: [],
    visibleTags: [],
    tagQuery: '',
    newTag: '',
    canAddTag: false,
    addingTag: false,
    starList: [1, 2, 3, 4, 5],
    attachmentFileID: '',
    attachmentName: '',
    attachmentSize: 0,
    pendingPath: '',
    pendingName: '',
    pendingSize: 0,
    clearAttachment: false,
    attachStatus: '未选择（可选）',
    saving: false,
  },

  async onLoad(query) {
    const id = query.id || ''
    try {
      const allTags = await store.getAllTags()
      if (!id) {
        this.applyTagState(['未读'], allTags)
        this.setData({ attachStatus: '未选择（可选）' })
        return
      }

      const novel = await store.getNovel(id)
      if (!novel) {
        wx.showToast({ title: '找不到这本书', icon: 'none' })
        return
      }
      wx.setNavigationBarTitle({ title: '编辑小说' })
      this.applyTagState(novel.tags || ['未读'], allTags)
      this.setData({
        id: novel.id,
        title: novel.title,
        author: novel.author,
        synopsis: novel.synopsis,
        review: novel.review,
        wantToRead: novel.wantToRead,
        disliked: novel.disliked,
        rating: novel.rating || 0,
        attachmentFileID: novel.attachmentFileID || '',
        attachmentName: novel.attachmentName || '',
        attachmentSize: novel.attachmentSize || 0,
        attachStatus: novel.attachmentName
          ? `已有：${novel.attachmentName}`
          : '未选择（可选）',
      })
    } catch (err) {
      wx.showToast({ title: err.message || '加载失败', icon: 'none' })
    }
  },

  toMap(tags) {
    const map = {}
    ;(tags || []).forEach((t) => {
      map[t] = true
    })
    return map
  },

  toTagItems(tags) {
    return (tags || [])
      .filter((t) => t !== '未读' && t !== '已读')
      .map((name) => {
        const tone = tagTone(name)
        return { name, bg: tone.bg, fg: tone.fg }
      })
  },

  filterTagItems(tagItems, query) {
    const q = String(query || '')
      .trim()
      .toLowerCase()
    if (!q) return tagItems
    return tagItems.filter((it) => String(it.name).toLowerCase().indexOf(q) >= 0)
  },

  applyTagState(tags, allTags, tagQuery) {
    const list = tags && tags.length ? tags.slice() : ['未读']
    const all = allTags || this.data.allTags || []
    const q = tagQuery !== undefined ? tagQuery : this.data.tagQuery
    const selectedChips = this.toTagItems(list)
    const tagItems = this.toTagItems(all)
    this.setData({
      tags: list,
      selectedMap: this.toMap(list),
      selectedChips,
      selectedCount: list.length,
      allTags: all,
      tagItems,
      tagQuery: q,
      visibleTags: this.filterTagItems(tagItems, q),
    })
  },

  refreshAttachStatus() {
    if (this.data.pendingName) {
      this.setData({ attachStatus: `待上传：${this.data.pendingName}` })
    } else if (this.data.clearAttachment) {
      this.setData({ attachStatus: '将移除附件' })
    } else if (this.data.attachmentName) {
      this.setData({ attachStatus: `已有：${this.data.attachmentName}` })
    } else {
      this.setData({ attachStatus: '未选择（可选）' })
    }
  },

  onTitle(e) {
    this.setData({ title: e.detail.value })
  },
  onAuthor(e) {
    this.setData({ author: e.detail.value })
  },
  onSynopsis(e) {
    this.setData({ synopsis: e.detail.value })
  },
  onReview(e) {
    this.setData({ review: e.detail.value })
  },
  onWant(e) {
    const wantToRead = !!e.detail.value
    this.setData({
      wantToRead,
      disliked: wantToRead ? false : this.data.disliked,
    })
  },
  onDislike(e) {
    const disliked = !!e.detail.value
    this.setData({
      disliked,
      wantToRead: disliked ? false : this.data.wantToRead,
    })
  },
  onStar(e) {
    const n = Number(e.currentTarget.dataset.n) || 0
    let rating = n
    if (rating === this.data.rating) rating = 0
    this.setData({ rating })
  },
  onNewTag(e) {
    const newTag = (e.detail && e.detail.value) || ''
    this.setData({ newTag, canAddTag: !!String(newTag).trim() })
  },

  clearNewTag() {
    this.setData({ newTag: '', canAddTag: false })
  },

  onTagQuery(e) {
    const tagQuery = (e.detail && e.detail.value) || ''
    this.setData({
      tagQuery,
      visibleTags: this.filterTagItems(this.data.tagItems, tagQuery),
    })
  },

  clearTagQuery() {
    this.setData({
      tagQuery: '',
      visibleTags: this.data.tagItems,
    })
  },

  toggleTag(e) {
    const tag = e.currentTarget.dataset.tag
    if (!tag) return
    let tags = (this.data.tags || []).slice()
    if (tag === '已读' || tag === '未读') {
      tags = tags.filter((t) => t !== '已读' && t !== '未读')
      tags.unshift(tag)
    } else if (tags.includes(tag)) {
      tags = tags.filter((t) => t !== tag)
    } else {
      tags.push(tag)
    }
    if (!tags.includes('已读') && !tags.includes('未读')) tags.unshift('未读')
    this.applyTagState(tags, this.data.allTags)
  },

  async addTag() {
    const t = (this.data.newTag || '').trim()
    if (!t || this.data.addingTag) return
    if (t === '未读' || t === '已读') {
      wx.showToast({ title: '请用上方切换阅读状态', icon: 'none' })
      return
    }
    this.setData({ addingTag: true })
    wx.showLoading({ title: '添加中…', mask: true })
    try {
      await store.addCustomTag(t)
      let tags = this.data.tags.slice()
      if (!tags.includes(t)) tags.push(t)
      const allTags = await store.getAllTags()
      this.setData({ newTag: '', canAddTag: false, addingTag: false })
      this.applyTagState(tags, allTags)
      wx.hideLoading()
      wx.showToast({ title: '已添加并选用', icon: 'none' })
    } catch (err) {
      wx.hideLoading()
      this.setData({ addingTag: false })
      wx.showToast({ title: err.message || '失败', icon: 'none' })
    }
  },

  pickAttach() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0]
        if (!file) return
        if (file.size > 20 * 1024 * 1024) {
          wx.showToast({ title: '附件不能超过 20MB', icon: 'none' })
          return
        }
        this.setData(
          {
            pendingPath: file.path,
            pendingName: file.name || '附件',
            pendingSize: file.size || 0,
            clearAttachment: false,
          },
          () => this.refreshAttachStatus(),
        )
      },
    })
  },

  clearAttach() {
    this.setData(
      {
        pendingPath: '',
        pendingName: '',
        pendingSize: 0,
        clearAttachment: true,
      },
      () => this.refreshAttachStatus(),
    )
  },

  async onSave() {
    if (this.data.saving) return
    this.setData({ saving: true })
    try {
      const payload = {
        id: this.data.id || undefined,
        title: this.data.title,
        author: this.data.author,
        synopsis: this.data.synopsis,
        review: this.data.review,
        wantToRead: this.data.wantToRead,
        disliked: this.data.disliked,
        rating: this.data.rating,
        tags: this.data.tags,
      }

      if (this.data.clearAttachment && !this.data.pendingPath) {
        if (this.data.attachmentFileID) {
          await store.removeCloudFile(this.data.attachmentFileID)
        }
        payload.attachmentFileID = ''
        payload.attachmentName = ''
        payload.attachmentSize = 0
      }

      let novel = await store.upsertNovel(payload)

      if (this.data.pendingPath) {
        if (novel.attachmentFileID) {
          await store.removeCloudFile(novel.attachmentFileID)
        }
        wx.showLoading({ title: '上传附件…', mask: true })
        const attach = await store.uploadAttachment(
          novel.id,
          this.data.pendingPath,
          this.data.pendingName,
          this.data.pendingSize,
        )
        wx.hideLoading()
        novel = await store.upsertNovel({ ...novel, ...attach })
      }

      const wasNew = !this.data.id
      this.setData({
        id: novel.id,
        attachmentFileID: novel.attachmentFileID || '',
        attachmentName: novel.attachmentName || '',
        attachmentSize: novel.attachmentSize || 0,
        pendingPath: '',
        pendingName: '',
        pendingSize: 0,
        clearAttachment: false,
        attachStatus: novel.attachmentName
          ? `已有：${novel.attachmentName}`
          : '未选择（可选）',
      })
      if (wasNew) wx.setNavigationBarTitle({ title: '编辑小说' })
      wx.showToast({ title: '已保存到云端', icon: 'success' })
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: err.message || '保存失败', icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  },
})
