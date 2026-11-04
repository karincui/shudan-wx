const store = require('../../utils/store')
const { readTextFile } = require('../../utils/readTextFile')

var READER_THEME_KEY = 'readerTheme'
var READER_FLIP_KEY = 'readerFlipMode'
var READER_PROGRESS_KEY = 'readerShowProgress'
var READER_POS_PREFIX = 'readerPos:'
/** 旧版固定字数分页，仅用于迁移本地进度 */
var LEGACY_PAGE_CHARS = 12000
var LINE_HEIGHT_RATIO = 2
/** 略留余量防末行裁切；过大易在屏底留白 */
var PAGE_FILL_RATIO = 0.97

var THEME_CHROME = {
  parchment: { front: '#000000', bg: '#f6f4ef' },
  eye: { front: '#000000', bg: '#e8f0e4' },
  night: { front: '#ffffff', bg: '#222222' },
}

function loadSavedTheme() {
  try {
    var t = wx.getStorageSync(READER_THEME_KEY)
    if (t === 'parchment' || t === 'eye' || t === 'night') return t
  } catch (e) {
    /* ignore */
  }
  return 'night'
}

/** tap=点击角落翻页；scroll=滚到顶/底翻页 */
function loadSavedFlipMode() {
  try {
    var m = wx.getStorageSync(READER_FLIP_KEY)
    if (m === 'tap' || m === 'scroll') return m
  } catch (e) {
    /* ignore */
  }
  return 'tap'
}

/** 默认隐藏进度条 */
function loadSavedShowProgress() {
  try {
    var v = wx.getStorageSync(READER_PROGRESS_KEY)
    if (v === true || v === false) return v
    if (v === 'true') return true
    if (v === 'false') return false
  } catch (e) {
    /* ignore */
  }
  return false
}

/**
 * 进度：优先 charOffset（全文偏移），兼容旧 page/scrollTop
 * @returns {{ charOffset:number, page:number, scrollTop:number }}
 */
function loadNovelPos(novelId) {
  var pos = { charOffset: 0, page: 1, scrollTop: 0 }
  if (!novelId) return pos
  try {
    var raw = wx.getStorageSync(READER_POS_PREFIX + novelId)
    if (raw && typeof raw === 'object') {
      var off = Number(raw.charOffset)
      if (Number.isFinite(off) && off >= 0) pos.charOffset = Math.floor(off)
      var p = Number(raw.page) || 1
      pos.page = p > 0 ? Math.floor(p) : 1
      var s = Number(raw.scrollTop)
      pos.scrollTop = Number.isFinite(s) && s > 0 ? s : 0
      // 旧数据只有 page（按 12000 字），换算成近似偏移
      if (!(Number.isFinite(off) && off >= 0) && pos.page > 1) {
        pos.charOffset = (pos.page - 1) * LEGACY_PAGE_CHARS
      }
      return pos
    }
    var n = Number(raw)
    if (Number.isFinite(n) && n > 0) {
      pos.page = Math.floor(n)
      pos.charOffset = (pos.page - 1) * LEGACY_PAGE_CHARS
    }
  } catch (e) {
    /* ignore */
  }
  return pos
}

function saveNovelPos(novelId, page, charOffset, scrollTop) {
  if (!novelId) return
  try {
    wx.setStorageSync(READER_POS_PREFIX + novelId, {
      page: Math.max(1, Math.floor(Number(page) || 1)),
      charOffset: Math.max(0, Math.floor(Number(charOffset) || 0)),
      scrollTop: Math.max(0, Number(scrollTop) || 0),
      updatedAt: Date.now(),
    })
  } catch (e) {
    /* ignore */
  }
}

function rpxToPx(rpx, windowWidth) {
  return (Number(rpx) || 0) * (Number(windowWidth) || 375) / 750
}

/** 字符显示宽度（全角=1，半角≈0.5） */
function charUnit(ch) {
  if (!ch) return 0
  if (ch === '\t') return 2
  var code = ch.charCodeAt(0)
  if (code <= 0xff) return 0.5
  return 1
}

/**
 * 按屏估算分页：用可视高度 / 行高得到行数，再按行宽切全文
 * @returns {{ start:number, end:number }[]}
 */
function buildPagesByScreen(fullText, layout) {
  var text = String(fullText || '')
  var len = text.length
  if (!len) return [{ start: 0, end: 0 }]

  var linesPerPage = Math.max(3, Number(layout.linesPerPage) || 12)
  var unitsPerLine = Math.max(6, Number(layout.unitsPerLine) || 16)
  var pages = []
  var i = 0

  while (i < len) {
    var start = i
    var lines = 0
    var col = 0

    while (i < len && lines < linesPerPage) {
      var ch = text.charAt(i)
      if (ch === '\r') {
        i += 1
        continue
      }
      if (ch === '\n') {
        lines += 1
        col = 0
        i += 1
        continue
      }
      var w = charUnit(ch)
      if (col > 0 && col + w > unitsPerLine) {
        lines += 1
        col = 0
        if (lines >= linesPerPage) break
      }
      col += w
      i += 1
    }

    if (i <= start) i = start + 1
    pages.push({ start: start, end: i })
  }

  return pages.length ? pages : [{ start: 0, end: 0 }]
}

function pageIndexForOffset(pages, offset) {
  var list = pages || []
  if (!list.length) return 0
  var off = Math.max(0, Number(offset) || 0)
  for (var i = 0; i < list.length; i++) {
    if (off < list[i].end) return i
  }
  return list.length - 1
}

Page({
  data: {
    text: '',
    error: '',
    theme: 'night',
    flipMode: 'tap',
    showProgress: false,
    novelTitle: '',
    fontSizes: [16, 18, 20, 22, 24],
    fontIndex: 1,
    page: 1,
    totalPages: 1,
    hasPager: false,
    settingsOpen: false,
    settingsShow: false,
    statusBarHeight: 20,
    navBarHeight: 44,
    capsuleTop: 0,
    capsuleHeight: 32,
    settingsLeft: 0,
    safeAreaBottom: 0,
    progressHeight: 56,
    bodyBottomPad: 24,
    pageSpacerPx: 48,
    windowWidth: 375,
    windowHeight: 667,
    navBg: '#222222',
    navTitleColor: '#c8c8c8',
  },

  _fullText: '',
  _novelId: '',
  _pages: [{ start: 0, end: 0 }],
  _charOffset: 0,
  _scrollReady: false,
  _scrollReadyTimer: null,
  _flipLock: false,
  _settingsCloseTimer: null,
  _lastScrollTop: 0,
  _saveScrollTimer: null,
  _rebuildTimer: null,

  async onLoad(query) {
    this.initNavMetrics()
    var theme = loadSavedTheme()
    var flipMode = loadSavedFlipMode()
    var showProgress = loadSavedShowProgress()
    this.setData({ theme: theme, flipMode: flipMode, showProgress: showProgress })
    this.updateBodyPad(showProgress)
    this.applyChrome(theme)
    try {
      const novel = await store.getNovel(query.id || '')
      if (!novel || !novel.attachmentFileID) {
        this.setData({ error: '没有可阅读的附件' })
        return
      }
      this._novelId = novel.id || ''
      this.setData({ novelTitle: novel.title || '阅读' })
      wx.showLoading({ title: '加载正文…', mask: true })
      const path = await store.downloadAttachment(novel.attachmentFileID)
      const text = readTextFile(path)
      wx.hideLoading()
      if (!text || !String(text).trim()) {
        this.setData({ text: '', error: '正文为空（请确认附件已上传成功）' })
        return
      }
      this._fullText = String(text)
      var pos = loadNovelPos(this._novelId)
      this._charOffset = pos.charOffset || 0
      this.rebuildPages()
      var pageIndex = pageIndexForOffset(this._pages, this._charOffset)
      this.applyPage(pageIndex + 1, { scrollTop: 0 })
      try {
        store.setNovelLastRead(this._novelId).catch(function () {})
      } catch (e2) {
        /* ignore */
      }
    } catch (err) {
      wx.hideLoading()
      console.error(err)
      this.setData({
        error: err.message || '读取失败（若文件是特殊编码，可另存为 UTF-8 后再试）',
      })
    }
  },

  onHide() {
    this.persistProgress()
  },

  onUnload() {
    this.persistProgress()
    if (this._scrollReadyTimer) {
      clearTimeout(this._scrollReadyTimer)
      this._scrollReadyTimer = null
    }
    if (this._settingsCloseTimer) {
      clearTimeout(this._settingsCloseTimer)
      this._settingsCloseTimer = null
    }
    if (this._saveScrollTimer) {
      clearTimeout(this._saveScrollTimer)
      this._saveScrollTimer = null
    }
    if (this._rebuildTimer) {
      clearTimeout(this._rebuildTimer)
      this._rebuildTimer = null
    }
  },

  persistProgress() {
    if (!this._novelId) return
    var page = this.data.page || 1
    var pages = this._pages || []
    var slice = pages[page - 1]
    var offset = slice ? slice.start : this._charOffset || 0
    this._charOffset = offset
    saveNovelPos(this._novelId, page, offset, this._lastScrollTop || 0)
  },

  scheduleSaveScroll(top) {
    var that = this
    that._lastScrollTop = top
    if (that._saveScrollTimer) clearTimeout(that._saveScrollTimer)
    that._saveScrollTimer = setTimeout(function () {
      that._saveScrollTimer = null
      that.persistProgress()
    }, 400)
  },

  noop() {},

  initNavMetrics() {
    try {
      var sys = wx.getSystemInfoSync()
      var statusBarHeight = sys.statusBarHeight || 20
      var windowWidth = sys.windowWidth || 375
      var windowHeight = sys.windowHeight || 667
      var safeAreaBottom = 0
      if (sys.safeAreaInsets && typeof sys.safeAreaInsets.bottom === 'number') {
        safeAreaBottom = sys.safeAreaInsets.bottom
      } else if (sys.safeArea && sys.screenHeight) {
        safeAreaBottom = Math.max(0, sys.screenHeight - sys.safeArea.bottom)
      }
      var navBarHeight = 44
      var capsuleTop = statusBarHeight + 6
      var capsuleHeight = 32
      var settingsLeft = windowWidth - 120
      try {
        var menu = wx.getMenuButtonBoundingClientRect()
        if (menu && menu.height) {
          var gap = menu.top - statusBarHeight
          navBarHeight = menu.height + gap * 2
          capsuleTop = menu.top
          capsuleHeight = menu.height
          settingsLeft = Math.max(8, menu.left - 8 - menu.height)
        }
      } catch (e) {
        /* keep */
      }
      var progressHeight = 54 + safeAreaBottom
      this.setData({
        statusBarHeight: statusBarHeight,
        navBarHeight: navBarHeight,
        capsuleTop: capsuleTop,
        capsuleHeight: capsuleHeight,
        settingsLeft: settingsLeft,
        safeAreaBottom: safeAreaBottom,
        progressHeight: progressHeight,
        windowWidth: windowWidth,
        windowHeight: windowHeight,
      })
      this.updateBodyPad(this.data.showProgress, progressHeight, safeAreaBottom)
    } catch (err) {
      this.setData({
        statusBarHeight: 20,
        navBarHeight: 44,
        capsuleTop: 26,
        capsuleHeight: 32,
        settingsLeft: 280,
        safeAreaBottom: 0,
        progressHeight: 54,
        bodyBottomPad: 24,
        windowWidth: 375,
        windowHeight: 667,
      })
    }
  },

  updateBodyPad(showProgress, progressHeight, safeAreaBottom) {
    var ph = typeof progressHeight === 'number' ? progressHeight : this.data.progressHeight
    var safe = typeof safeAreaBottom === 'number' ? safeAreaBottom : this.data.safeAreaBottom
    var bodyBottomPad = showProgress ? ph + 8 : Math.max(24, safe + 12)
    this.setData({ bodyBottomPad: bodyBottomPad })
  },

  /** 根据当前字号 / 窗口估算一屏排版参数 */
  getScreenLayout() {
    var fontSize = this.data.fontSizes[this.data.fontIndex] || 18
    var windowWidth = this.data.windowWidth || 375
    var windowHeight = this.data.windowHeight || 667
    var navTotal = (this.data.statusBarHeight || 20) + (this.data.navBarHeight || 44)
    var bottomChrome = this.data.showProgress
      ? this.data.progressHeight || 54
      : Math.max(12, this.data.safeAreaBottom || 0)
    var sidePad = rpxToPx(80, windowWidth)
    var contentWidth = Math.max(120, windowWidth - sidePad)
    var usableHeight = Math.max(120, windowHeight - navTotal - bottomChrome - 8)
    var lineHeightPx = fontSize * LINE_HEIGHT_RATIO
    var linesPerPage = Math.max(3, Math.floor((usableHeight * PAGE_FILL_RATIO) / lineHeightPx))
    var unitsPerLine = Math.max(6, Math.floor(contentWidth / fontSize))
    // 滚动翻页时加一点占位，保证能触发触底；点击翻页不展示
    var pageSpacerPx = Math.max(24, Math.round(lineHeightPx * 0.8))
    return {
      fontSize: fontSize,
      linesPerPage: linesPerPage,
      unitsPerLine: unitsPerLine,
      usableHeight: usableHeight,
      pageSpacerPx: pageSpacerPx,
    }
  },

  rebuildPages() {
    var layout = this.getScreenLayout()
    this._pages = buildPagesByScreen(this._fullText, layout)
    this.setData({ pageSpacerPx: layout.pageSpacerPx })
    return this._pages
  },

  /** 保留当前字符进度，按新版式重切并跳到对应页 */
  rebuildKeepOffset() {
    this.persistProgress()
    var offset = this._charOffset || 0
    this.rebuildPages()
    var idx = pageIndexForOffset(this._pages, offset)
    this.applyPage(idx + 1, { scrollTop: 0 })
  },

  scheduleRebuildKeepOffset() {
    var that = this
    if (that._rebuildTimer) clearTimeout(that._rebuildTimer)
    that._rebuildTimer = setTimeout(function () {
      that._rebuildTimer = null
      if (!that._fullText) return
      that.rebuildKeepOffset()
    }, 60)
  },

  openSettings() {
    var that = this
    if (that._settingsCloseTimer) {
      clearTimeout(that._settingsCloseTimer)
      that._settingsCloseTimer = null
    }
    that.setData({ settingsOpen: true, settingsShow: false })
    setTimeout(function () {
      that.setData({ settingsShow: true })
    }, 20)
  },

  closeSettings() {
    var that = this
    that.setData({ settingsShow: false })
    that._settingsCloseTimer = setTimeout(function () {
      that.setData({ settingsOpen: false })
      that._settingsCloseTimer = null
    }, 220)
  },

  applyChrome(theme) {
    var chrome = THEME_CHROME[theme] || THEME_CHROME.night
    var navTitleColor =
      theme === 'night' ? '#c8c8c8' : theme === 'eye' ? '#243028' : '#2a241c'
    this.setData({
      navBg: chrome.bg,
      navTitleColor: navTitleColor,
    })
    try {
      wx.setNavigationBarColor({
        frontColor: chrome.front,
        backgroundColor: chrome.bg,
        animation: { duration: 0, timingFunc: 'linear' },
      })
    } catch (e) {
      /* ignore */
    }
    try {
      wx.setBackgroundColor({
        backgroundColor: chrome.bg,
        backgroundColorTop: chrome.bg,
        backgroundColorBottom: chrome.bg,
      })
    } catch (e2) {
      /* ignore */
    }
  },

  armScrollReady() {
    var that = this
    that._scrollReady = false
    that._flipLock = false
    if (that._scrollReadyTimer) clearTimeout(that._scrollReadyTimer)
    that._scrollReadyTimer = setTimeout(function () {
      that._scrollReady = true
      that._scrollReadyTimer = null
    }, 420)
  },

  applyPage(page, opts) {
    opts = opts || {}
    var pages = this._pages && this._pages.length ? this._pages : [{ start: 0, end: 0 }]
    var totalPages = Math.max(1, pages.length)
    var p = Number(page) || 1
    if (p < 1) p = 1
    if (p > totalPages) p = totalPages
    var slice = pages[p - 1] || { start: 0, end: 0 }
    var chunk = (this._fullText || '').slice(slice.start, slice.end)
    var targetScroll = opts.scrollTop != null ? Math.max(0, Number(opts.scrollTop) || 0) : 0
    this._charOffset = slice.start
    this.armScrollReady()
    this._lastScrollTop = targetScroll
    this.setData({
      text: chunk,
      page: p,
      totalPages: totalPages,
      hasPager: totalPages > 1,
      error: '',
    })
    var that = this
    setTimeout(function () {
      try {
        wx.pageScrollTo({ scrollTop: targetScroll, duration: 0 })
      } catch (e) {
        /* ignore */
      }
      that._lastScrollTop = targetScroll
    }, targetScroll > 0 ? 80 : 0)
    saveNovelPos(this._novelId, p, slice.start, targetScroll)
    return p
  },

  goPrev() {
    if (this.data.page <= 1) return
    if (this._flipLock) return
    this._flipLock = true
    this.applyPage(this.data.page - 1)
  },

  goNext() {
    if (this.data.page >= this.data.totalPages) return
    if (this._flipLock) return
    this._flipLock = true
    this.applyPage(this.data.page + 1)
  },

  onReachBottom() {
    if (this.data.flipMode !== 'scroll') return
    if (!this._scrollReady || !this.data.hasPager) return
    this.goNext()
  },

  onPageScroll(e) {
    var top = (e && e.scrollTop) || 0
    var prev = this._lastScrollTop
    this.scheduleSaveScroll(top)
    if (this.data.flipMode !== 'scroll') return
    if (!this._scrollReady || !this.data.hasPager) return
    if (top <= 2 && prev > 8) {
      this.goPrev()
    }
  },

  onProgressChanging(e) {
    const page = Number(e.detail && e.detail.value) || 1
    if (page !== this.data.page) {
      this.setData({ page: page })
    }
  },

  onProgressChange(e) {
    const page = Number(e.detail && e.detail.value) || 1
    this.applyPage(page)
  },

  onFontChip(e) {
    var index = Number(e.currentTarget.dataset.index)
    if (!Number.isFinite(index) || index < 0) return
    if (index === this.data.fontIndex) return
    this.setData({ fontIndex: index })
    this.scheduleRebuildKeepOffset()
  },

  setTheme(e) {
    var theme = e.currentTarget.dataset.theme || 'night'
    this.setData({ theme: theme })
    this.applyChrome(theme)
    try {
      wx.setStorageSync(READER_THEME_KEY, theme)
    } catch (err) {
      /* ignore */
    }
  },

  setFlipMode(e) {
    var flipMode = e.currentTarget.dataset.mode || 'tap'
    if (flipMode !== 'tap' && flipMode !== 'scroll') flipMode = 'tap'
    this.setData({ flipMode: flipMode })
    this.armScrollReady()
    try {
      wx.setStorageSync(READER_FLIP_KEY, flipMode)
    } catch (err) {
      /* ignore */
    }
  },

  onProgressSwitch(e) {
    var showProgress = !!(e.detail && e.detail.value)
    this.setData({ showProgress: showProgress })
    this.updateBodyPad(showProgress)
    try {
      wx.setStorageSync(READER_PROGRESS_KEY, showProgress)
    } catch (err) {
      /* ignore */
    }
    // 进度条占高变化后重切页
    this.scheduleRebuildKeepOffset()
  },
})
