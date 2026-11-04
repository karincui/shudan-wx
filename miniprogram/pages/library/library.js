var store = require('../../utils/store.js')
var tagColors = require('../../utils/tagColors.js')
var tagTone = tagColors.tagTone
var themeBehavior = require('../../behaviors/themeBehavior.js')

var SORT_STORAGE_KEY = 'librarySort'
var FILTER_STORAGE_KEY = 'libraryFilters'
var RANDOM_POOL_KEY = 'libraryRandomPool'

function sanitizeFilterTags(tags) {
  return (Array.isArray(tags) ? tags : []).filter(function (t) {
    return !!t
  })
}

function loadSavedFilters() {
  try {
    var raw = wx.getStorageSync(FILTER_STORAGE_KEY)
    if (!raw || typeof raw !== 'object') return null
    var minRating = Number(raw.minRating) || 0
    if (minRating < 0) minRating = 0
    if (minRating > 5) minRating = 5
    var readFilter = raw.readFilter || 'all'
    if (readFilter === 'read' || readFilter === 'unread') readFilter = 'all'
    if (readFilter !== 'all' && readFilter !== 'want' && readFilter !== 'dislike') {
      readFilter = 'all'
    }
    return {
      query: String(raw.query || ''),
      readFilter: readFilter,
      filterTags: sanitizeFilterTags(raw.filterTags),
      minRating: minRating,
    }
  } catch (e) {
    return null
  }
}

function saveFilters(state) {
  try {
    wx.setStorageSync(FILTER_STORAGE_KEY, {
      query: String((state && state.query) || ''),
      readFilter: (state && state.readFilter) || 'all',
      filterTags: sanitizeFilterTags(state && state.filterTags),
      minRating: Number(state && state.minRating) || 0,
    })
  } catch (e) {
    /* ignore */
  }
}

function loadRandomPool() {
  try {
    var p = wx.getStorageSync(RANDOM_POOL_KEY)
    if (p === 'unread' || p === 'want' || p === 'filter') return p
  } catch (e) {
    /* ignore */
  }
  return 'unread'
}

function getRatingLabel(minRating) {
  var v = Number(minRating) || 0
  if (v >= 5) return '5星'
  if (v >= 4) return '≥4星'
  if (v >= 3) return '≥3星'
  return '评分'
}

Page({
  behaviors: [themeBehavior],

  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    query: '',
    readFilter: 'all',
    filterTags: [],
    filterMap: {},
    minRating: 0,
    ratingLabel: '评分',
    ratingOptions: [
      { value: 0, label: '不限' },
      { value: 3, label: '≥3星' },
      { value: 4, label: '≥4星' },
      { value: 5, label: '5星' },
    ],
    ratingSheetOpen: false,
    ratingSheetShow: false,
    ratingDraft: 0,
    tagItems: [],
    selectedTagItems: [],
    tagSheetOpen: false,
    tagSheetShow: false,
    tagDraft: [],
    tagDraftMap: {},
    tagDraftItems: [],
    novels: [],
    starList: [1, 2, 3, 4, 5],
    loading: true,
    loadingText: '正在加载书单',
    error: '',
    page: 1,
    pageSize: 30,
    total: 0,
    totalPages: 1,
    randomOpen: false,
    randomSheetShow: false,
    randomNovel: null,
    randomTagList: [],
    randomHint: '正在洗牌…',
    randomPhase: 'idle',
    randomFlipped: false,
    randomBusy: false,
    randomPool: 'unread',
    randomPoolOpen: false,
    drawCards: [],

    selectMode: false,
    selectedMap: {},
    selectedCount: 0,
    batchTagSheetOpen: false,
    batchTagSheetShow: false,
    batchTagDraft: [],
    batchTagDraftMap: {},
    batchTagDraftItems: [],

    swipeOpenId: '',
    swipeX: 0,
    swipeDragging: false,
    filterCounts: { all: 0, unread: 0, want: 0, read: 0, dislike: 0 },
    sortKey: 'pin',
    sortLabel: '置顶优先',

    sortOptions: store.SORT_OPTIONS || [],
    sortSheetOpen: false,
    sortSheetShow: false,
    sortDraft: 'pin',
  },

  _reloadSeq: 0,
  _queryTimer: null,
  _swipe: null,
  _swipeMoved: false,
  _actionW: 140,
  _sortCloseTimer: null,
  _ratingCloseTimer: null,
  _tagCloseTimer: null,
  _randomTimers: null,


  onLoad: function () {
    this.initNavMetrics()
    try {
      var sys = wx.getSystemInfoSync()
      // 两列卡片较窄，左滑三键合计约 270rpx
      this._actionW = Math.round(((270 / 750) * (sys.windowWidth || 375)) * 100) / 100
    } catch (e) {
      this._actionW = 135
    }
    this.initSort()
    this.initFilters()
    this.setData({ randomPool: loadRandomPool() })
  },

  initFilters: function () {
    var saved = loadSavedFilters()
    if (!saved) return
    var filterTags = sanitizeFilterTags(saved.filterTags)
    var filterMap = {}
    filterTags.forEach(function (t) {
      filterMap[t] = true
    })
    var selectedTagItems = filterTags.map(function (name) {
      var tone = tagTone(name)
      return { name: name, bg: tone.bg, fg: tone.fg }
    })
    var minRating = saved.minRating || 0
    this.setData({
      query: saved.query || '',
      readFilter: saved.readFilter || 'all',
      filterTags: filterTags,
      filterMap: filterMap,
      selectedTagItems: selectedTagItems,
      minRating: minRating,
      ratingLabel: getRatingLabel(minRating),
    })
  },

  persistFilters: function () {
    saveFilters({
      query: this.data.query,
      readFilter: this.data.readFilter,
      filterTags: this.data.filterTags,
      minRating: this.data.minRating,
    })
  },

  initNavMetrics: function () {
    try {
      var sys = wx.getSystemInfoSync()
      var statusBarHeight = sys.statusBarHeight || 20
      var navBarHeight = 44
      try {
        var menu = wx.getMenuButtonBoundingClientRect()
        if (menu && menu.height) {
          var gap = menu.top - statusBarHeight
          navBarHeight = menu.height + gap * 2
        }
      } catch (e) {
        /* keep */
      }
      this.setData({ statusBarHeight: statusBarHeight, navBarHeight: navBarHeight })
    } catch (e) {
      this.setData({ statusBarHeight: 20, navBarHeight: 44 })
    }
  },



  initSort: function () {
    var key = 'pin'
    try {
      key = store.normalizeSortKey(wx.getStorageSync(SORT_STORAGE_KEY) || 'pin')
    } catch (e) {
      key = 'pin'
    }
    this.setData({
      sortKey: key,
      sortDraft: key,
      sortLabel: store.getSortLabel(key),
      sortOptions: store.SORT_OPTIONS || [],
    })
  },



  onShow: function () {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({
        selected: 0,
        show: !(
          this.data.tagSheetOpen ||
          this.data.sortSheetOpen ||
          this.data.ratingSheetOpen ||
          this.data.randomOpen ||
          this.data.randomPoolOpen ||
          this.data.selectMode ||
          this.data.batchTagSheetOpen
        ),
      })
    }
    this.setData({ swipeOpenId: '', swipeX: 0 })
    var that = this
    // 先等列表加载完再触发随机，避免 onRandom 因 loading 直接 return
    Promise.resolve(this.reload(true)).then(
      function () {
        that.runPendingRandom()
      },
      function () {
        that.runPendingRandom()
      },
    )
  },

  onHide: function () {
    if (this.data.tagSheetOpen) {
      this.setData({
        tagSheetOpen: false,
        tagSheetShow: false,
        tagDraft: [],
        tagDraftMap: {},
        tagDraftItems: [],
      })
      this.setTabBarVisible(true)
    }
  },

  setTabBarVisible: function (show) {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ show: !!show })
    }
  },

  _buildTagDraftState: function (tags) {
    var list = sanitizeFilterTags(tags)
    var map = {}
    list.forEach(function (t) {
      map[t] = true
    })
    var items = list.map(function (name) {
      var tone = tagTone(name)
      return { name: name, bg: tone.bg, fg: tone.fg }
    })
    return { tagDraft: list, tagDraftMap: map, tagDraftItems: items }
  },

  runPendingRandom: function () {
    var app = getApp()
    if (!app || !app.globalData || !app.globalData.pendingRandom) return
    app.globalData.pendingRandom = false
    var that = this
    setTimeout(function () {
      that.onRandom()
    }, 60)
  },

  _flushPendingRandomAfterLoad: function () {
    if (!this._openRandomWhenReady) return
    this._openRandomWhenReady = false
    this.onRandom()
  },


  onRetry: function () {
    this.reload(true)
  },

  noop: function () {},

  onUnload: function () {
    if (this._queryTimer) clearTimeout(this._queryTimer)
    if (this._sortCloseTimer) clearTimeout(this._sortCloseTimer)
    if (this._ratingCloseTimer) clearTimeout(this._ratingCloseTimer)
    this.clearRandomTimers()
  },

  clearRandomTimers: function () {
    var list = this._randomTimers || []
    list.forEach(function (id) {
      clearTimeout(id)
    })
    this._randomTimers = []
  },

  _randTimer: function (fn, ms) {
    var that = this
    if (!that._randomTimers) that._randomTimers = []
    var id = setTimeout(function () {
      fn()
    }, ms)
    that._randomTimers.push(id)
    return id
  },

  _charOf: function (title) {
    var t = String(title || '').trim()
    return t ? t.charAt(0) : '书'
  },

  _buildDrawCards: function (chars) {
    var list = []
    for (var i = 0; i < 6; i++) {
      list.push({
        id: 'c' + i,
        char: chars[i] || '书',
        style: 'opacity:0;transform:translate(0,0) scale(0.6);',
      })
    }
    return list
  },


  _setCardsStyle: function (mapper) {
    var cards = (this.data.drawCards || []).map(function (c, i) {
      return Object.assign({}, c, { style: mapper(c, i) })
    })
    this.setData({ drawCards: cards })
  },


  openSortSheet: function () {
    var that = this
    if (that._sortCloseTimer) {
      clearTimeout(that._sortCloseTimer)
      that._sortCloseTimer = null
    }
    that.setTabBarVisible(false)
    that.setData({
      sortSheetOpen: true,
      sortSheetShow: false,
      sortDraft: that.data.sortKey || 'pin',
    })
    setTimeout(function () {
      that.setData({ sortSheetShow: true })
    }, 30)
  },

  closeSortSheet: function () {
    var that = this
    that.setData({ sortSheetShow: false })
    that._sortCloseTimer = setTimeout(function () {
      that.setData({ sortSheetOpen: false })
      that.setTabBarVisible(true)
      that._sortCloseTimer = null
    }, 220)
  },

  onSortDraft: function (e) {
    var key = (e.currentTarget.dataset && e.currentTarget.dataset.key) || 'pin'
    this.setData({ sortDraft: store.normalizeSortKey(key) })
  },

  resetSortDraft: function () {
    this.setData({ sortDraft: 'pin' })
  },

  confirmSort: function () {
    var that = this
    var key = store.normalizeSortKey(that.data.sortDraft)
    try {
      wx.setStorageSync(SORT_STORAGE_KEY, key)
    } catch (e) {
      /* ignore */
    }
    that.setData({
      sortKey: key,
      sortLabel: store.getSortLabel(key),
      page: 1,
    })
    that.closeSortSheet()
    that.reload(true, true, '排序中…')
  },



  decorate: function (list) {
    return (list || []).map(function (n) {
      var readLabel = n.isRead ? '已读' : '未读'
      var displayTags = (n.tags || [])
        .filter(function (t) {
          return t !== '未读' && t !== '已读'
        })
        .slice(0, 3)
        .map(function (name) {
          var tone = tagTone(name)
          return { name: name, bg: tone.bg, fg: tone.fg }
        })
      return Object.assign({}, n, {
        displayTags: displayTags,
        readLabel: readLabel,
        hasTxt: store.isTextAttachment(n.attachmentName),
      })
    })
  },

  reload: function (showLoading, resetPage, loadingText) {
    var that = this
    var seq = (that._reloadSeq = (that._reloadSeq || 0) + 1)
    var page = resetPage ? 1 : that.data.page || 1
    // 所有列表接口请求都出遮罩；文案可自定义
    that.setData({
      loading: true,
      loadingText: loadingText || '正在加载书单',
      error: '',
    })
    that.persistFilters()
    return Promise.all([
      store.listNovelsPage({
        page: page,
        query: that.data.query,
        readFilter: that.data.readFilter,
        tags: sanitizeFilterTags(that.data.filterTags),
        minRating: that.data.minRating || 0,
        sort: that.data.sortKey,
      }),

      store.getAllTags(),
      store.countNovelsByStatus({
        query: that.data.query,
        tags: sanitizeFilterTags(that.data.filterTags),
        minRating: that.data.minRating || 0,
      }),
    ])
      .then(function (results) {
        if (seq !== that._reloadSeq) return
        var p = results[0]
        var tags = results[1]
        var filterCounts = results[2] || { all: 0, unread: 0, want: 0, read: 0, dislike: 0 }
        var tagItems = (tags || []).map(function (name) {
          var tone = tagTone(name)
          return { name: name, bg: tone.bg, fg: tone.fg }
        })
        var filterTags = sanitizeFilterTags(that.data.filterTags)
        var filterMap = {}
        filterTags.forEach(function (t) {
          filterMap[t] = true
        })
        var selectedTagItems = filterTags.map(function (name) {
          var tone = tagTone(name)
          return { name: name, bg: tone.bg, fg: tone.fg }
        })
        that.setData({
          novels: that.decorate(p.list),
          tagItems: tagItems,
          filterTags: filterTags,
          filterMap: filterMap,
          selectedTagItems: selectedTagItems,
          filterCounts: filterCounts,
          page: p.page,
          pageSize: p.pageSize,
          total: p.total,
          totalPages: p.totalPages,
          loading: false,
          error: '',
          swipeOpenId: '',
          swipeX: 0,
        })
        that._flushPendingRandomAfterLoad()
      })

      .catch(function (err) {
        if (seq !== that._reloadSeq) return
        console.error(err)
        that.setData({
          loading: false,
          error: (err && err.message) || String(err) || '加载失败',
          novels: [],
          total: 0,
          totalPages: 1,
        })
        that._flushPendingRandomAfterLoad()
      })
  },

  onPullDownRefresh: function () {
    var that = this
    that
      .reload(true, true, '刷新书单…')
      .then(function () {
        wx.stopPullDownRefresh()
      })
      .catch(function () {
        wx.stopPullDownRefresh()
      })
  },

  onQueryInput: function (e) {
    var that = this
    that.setData({ query: (e.detail && e.detail.value) || '' })
    if (that._queryTimer) clearTimeout(that._queryTimer)
    that._queryTimer = setTimeout(function () {
      that.reload(true, true, '搜索中…')
    }, 350)
  },
  onSearch: function () {
    if (this._queryTimer) clearTimeout(this._queryTimer)
    this.reload(true, true, '搜索中…')
  },
  clearQuery: function () {
    var that = this
    if (that._queryTimer) clearTimeout(that._queryTimer)
    that.setData({ query: '', page: 1 }, function () {
      that.reload(true, true, '加载中…')
    })
  },
  onFilter: function (e) {
    var that = this
    var readFilter = (e.currentTarget.dataset && e.currentTarget.dataset.filter) || 'all'
    if (readFilter === 'read' || readFilter === 'unread') readFilter = 'all'
    that.setData({ readFilter: readFilter, page: 1 }, function () {
      that.persistFilters()
      that.reload(true, true, '筛选中…')
    })
  },

  openRatingSheet: function () {
    var that = this
    if (that._ratingCloseTimer) {
      clearTimeout(that._ratingCloseTimer)
      that._ratingCloseTimer = null
    }
    that.setTabBarVisible(false)
    that.setData({
      ratingSheetOpen: true,
      ratingSheetShow: false,
      ratingDraft: that.data.minRating || 0,
    })
    setTimeout(function () {
      that.setData({ ratingSheetShow: true })
    }, 30)
  },

  closeRatingSheet: function () {
    var that = this
    that.setData({ ratingSheetShow: false })
    that._ratingCloseTimer = setTimeout(function () {
      that.setData({ ratingSheetOpen: false })
      that.setTabBarVisible(true)
      that._ratingCloseTimer = null
    }, 220)
  },

  onRatingDraft: function (e) {
    var v = Number(e.currentTarget.dataset && e.currentTarget.dataset.value)
    if (!Number.isFinite(v) || v < 0) v = 0
    if (v > 5) v = 5
    this.setData({ ratingDraft: v })
  },

  resetRatingDraft: function () {
    this.setData({ ratingDraft: 0 })
  },

  confirmRating: function () {
    var that = this
    var v = Number(that.data.ratingDraft) || 0
    if (v < 0) v = 0
    if (v > 5) v = 5
    that.setData(
      {
        minRating: v,
        ratingLabel: getRatingLabel(v),
        page: 1,
      },
      function () {
        that.persistFilters()
        that.closeRatingSheet()
        that.reload(true, true, '筛选中…')
      },
    )
  },

  openTagSheet: function () {
    var that = this
    if (that._tagCloseTimer) {
      clearTimeout(that._tagCloseTimer)
      that._tagCloseTimer = null
    }
    var draft = that._buildTagDraftState(that.data.filterTags)
    that.setTabBarVisible(false)
    that.setData(
      Object.assign(
        {
          tagSheetOpen: true,
          tagSheetShow: false,
        },
        draft,
      ),
    )
    setTimeout(function () {
      that.setData({ tagSheetShow: true })
    }, 30)
  },

  closeTagSheet: function () {
    var that = this
    if (!that.data.tagSheetOpen) return
    that.setData({ tagSheetShow: false })
    if (that._tagCloseTimer) clearTimeout(that._tagCloseTimer)
    that._tagCloseTimer = setTimeout(function () {
      that.setData({
        tagSheetOpen: false,
        tagDraft: [],
        tagDraftMap: {},
        tagDraftItems: [],
      })
      that.setTabBarVisible(true)
      that._tagCloseTimer = null
    }, 220)
  },

  toggleTagDraft: function (e) {
    var tag = e.currentTarget.dataset.tag
    if (!tag) return
    var list = (this.data.tagDraft || []).slice()
    var idx = list.indexOf(tag)
    if (idx >= 0) list.splice(idx, 1)
    else list.push(tag)
    this.setData(this._buildTagDraftState(sanitizeFilterTags(list)))
  },

  clearTagDraft: function () {
    this.setData(this._buildTagDraftState([]))
  },

  confirmTagSheet: function () {
    var that = this
    var filterTags = sanitizeFilterTags(that.data.tagDraft)
    var filterMap = {}
    filterTags.forEach(function (t) {
      filterMap[t] = true
    })
    var selectedTagItems = filterTags.map(function (name) {
      var tone = tagTone(name)
      return { name: name, bg: tone.bg, fg: tone.fg }
    })
    that.setData(
      {
        filterTags: filterTags,
        filterMap: filterMap,
        selectedTagItems: selectedTagItems,
        page: 1,
      },
      function () {
        that.closeTagSheet()
        that.reload(true, true, '筛选中…')
      },
    )
  },

  toggleFilterTag: function (e) {
    var that = this
    var tag = e.currentTarget.dataset.tag
    if (!tag) return
    var filterTags = sanitizeFilterTags(that.data.filterTags)
    var idx = filterTags.indexOf(tag)
    if (idx >= 0) filterTags.splice(idx, 1)
    else filterTags.push(tag)
    var filterMap = {}
    filterTags.forEach(function (t) {
      filterMap[t] = true
    })
    var selectedTagItems = filterTags.map(function (name) {
      var tone = tagTone(name)
      return { name: name, bg: tone.bg, fg: tone.fg }
    })
    that.setData(
      {
        filterTags: filterTags,
        filterMap: filterMap,
        selectedTagItems: selectedTagItems,
        page: 1,
      },
      function () {
        that.reload(true, true, '筛选中…')
      },
    )
  },

  clearFilterTags: function () {
    var that = this
    that.setData(
      { filterTags: [], filterMap: {}, selectedTagItems: [], page: 1 },
      function () {
        that.reload(true, true, '清除筛选…')
      },
    )
  },

  goFirstPage: function () {
    if (this.data.page <= 1 || this.data.loading) return
    var that = this
    that.setData({ page: 1, swipeOpenId: '', swipeX: 0 }, function () {
      wx.pageScrollTo({ scrollTop: 0, duration: 200 })
      that.reload(true, false, '正在翻页…')
    })
  },
  goPrevPage: function () {
    if (this.data.page <= 1 || this.data.loading) return
    var that = this
    that.setData({ page: that.data.page - 1, swipeOpenId: '', swipeX: 0 }, function () {
      wx.pageScrollTo({ scrollTop: 0, duration: 200 })
      that.reload(true, false, '正在翻页…')
    })
  },
  goNextPage: function () {
    if (this.data.page >= this.data.totalPages || this.data.loading) return
    var that = this
    that.setData({ page: that.data.page + 1, swipeOpenId: '', swipeX: 0 }, function () {
      wx.pageScrollTo({ scrollTop: 0, duration: 200 })
      that.reload(true, false, '正在翻页…')
    })
  },

  goAdd: function () {
    wx.navigateTo({ url: '/pages/edit/edit' })
  },
  goImport: function () {
    wx.switchTab({ url: '/pages/import/import' })
  },
  goTableImport: function () {
    wx.navigateTo({ url: '/pages/table-import/table-import' })
  },
  goTags: function () {
    wx.navigateTo({ url: '/pages/tags/tags' })
  },
  goAppearance: function () {
    wx.navigateTo({ url: '/pages/appearance/appearance' })
  },

  closeSwipe: function () {
    if (!this.data.swipeOpenId && !this.data.swipeX) return
    this.setData({ swipeOpenId: '', swipeX: 0 })
  },

  // 爱心/星星/未读：拦住触摸，不启动左滑（不要用 catchtouchmove，会吃掉点击）
  onCtrlTouchStart: function () {
    this._ctrlTouch = true
    this._swipeMoved = false
    this._swipe = { ignore: true, moving: false }
  },

  onSwipeStart: function (e) {
    if (this.data.selectMode) {
      this._swipe = { ignore: true, moving: false }
      this._swipeMoved = false
      return
    }
    if (this._ctrlTouch) {
      this._ctrlTouch = false
      this._swipe = { ignore: true, moving: false }
      this._swipeMoved = false
      return
    }
    var id = e.currentTarget.dataset.id
    var t = (e.touches && e.touches[0]) || {}
    if (this.data.swipeOpenId && this.data.swipeOpenId !== id) {
      this.setData({ swipeOpenId: '', swipeX: 0 })
    }
    this._swipeMoved = false
    this._swipe = {
      id: id,
      startX: t.clientX || 0,
      startY: t.clientY || 0,
      startOffset: this.data.swipeOpenId === id ? this.data.swipeX : 0,
      moving: false,
      ignore: false,
    }
  },

  onSwipeMove: function (e) {
    var s = this._swipe
    if (!s || s.ignore || this._ctrlTouch) return
    var t = (e.touches && e.touches[0]) || {}
    var dx = (t.clientX || 0) - s.startX
    var dy = (t.clientY || 0) - s.startY
    if (!s.moving) {
      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 8) {
        s.ignore = true
        return
      }
      if (Math.abs(dx) < 20) return
      if (Math.abs(dx) <= Math.abs(dy)) return
      s.moving = true
      this._swipeMoved = true
    }
    var x = s.startOffset + dx
    var minX = -this._actionW
    if (x > 0) x = 0
    if (x < minX) x = minX
    this.setData({ swipeOpenId: s.id, swipeX: x, swipeDragging: true })
  },

  onSwipeEnd: function () {
    var s = this._swipe
    var fromCtrl = this._ctrlTouch
    this._ctrlTouch = false
    this._swipe = null
    if (fromCtrl || !s || s.ignore || !s.moving) {
      this.setData({ swipeDragging: false })
      return
    }
    var open = this.data.swipeX < -(this._actionW * 0.45)
    this.setData({
      swipeOpenId: open ? s.id : '',
      swipeX: open ? -this._actionW : 0,
      swipeDragging: false,
    })
  },

  goDetail: function (e) {
    if (this._swipeMoved || this._ctrlTouch) {
      this._swipeMoved = false
      this._ctrlTouch = false
      return
    }
    var id = e.currentTarget.dataset.id
    if (!id) return
    if (this.data.selectMode) {
      this.toggleSelectItem(e)
      return
    }
    if (this.data.swipeOpenId) {
      this.closeSwipe()
      return
    }
    wx.navigateTo({ url: '/pages/detail/detail?id=' + id })
  },

  goEditFromList: function (e) {
    var id = e.currentTarget.dataset.id
    this.closeSwipe()
    if (!id) return
    wx.navigateTo({ url: '/pages/edit/edit?id=' + id })
  },

  togglePin: function (e) {
    var that = this
    var id = e.currentTarget.dataset.id
    if (!id) return
    var pinned = !that._asBool(e.currentTarget.dataset.pinned)
    that.closeSwipe()
    that.setData({ loading: true, loadingText: pinned ? '置顶中…' : '取消置顶…' })
    store
      .setNovelPin(id, pinned)
      .then(function () {
        return that.reload(true, false, pinned ? '置顶中…' : '取消置顶…')
      })
      .then(function () {
        wx.showToast({ title: pinned ? '已置顶' : '已取消置顶', icon: 'none' })
      })
      .catch(function (err) {
        that.setData({ loading: false })
        wx.showToast({ title: (err && err.message) || '失败', icon: 'none' })
      })
  },

  onDeleteFromList: function (e) {
    var that = this
    var id = e.currentTarget.dataset.id
    if (!id) return
    wx.showModal({
      title: '删除确认',
      content: '删除后不可恢复，确定吗？',
      success: function (res) {
        if (!res.confirm) return
        that.closeSwipe()
        that.setData({ loading: true, loadingText: '删除中…' })
        store
          .deleteNovel(id)
          .then(function () {
            return that.reload(true, false, '删除中…')
          })
          .then(function () {
            wx.showToast({ title: '已删除', icon: 'success' })
          })
          .catch(function (err) {
            that.setData({ loading: false })
            wx.showToast({ title: (err && err.message) || '删除失败', icon: 'none' })
          })
      },
    })
  },

  _asBool: function (v) {
    return v === true || v === 'true' || v === 1 || v === '1'
  },

  toggleWant: function (e) {
    var that = this
    var id = e.currentTarget.dataset.id
    var want = !this._asBool(e.currentTarget.dataset.want)
    this.closeSwipe()
    this._swipe = null
    this._swipeMoved = false
    that.setData({ loading: true, loadingText: '保存中…' })
    store
      .setNovelWant(id, want)
      .then(function () {
        return that.reload(true, false, '保存中…')
      })
      .catch(function (err) {
        that.setData({ loading: false })
        wx.showToast({ title: (err && err.message) || '失败', icon: 'none' })
      })
  },

  toggleDislike: function (e) {
    var that = this
    var id = e.currentTarget.dataset.id
    var disliked = !this._asBool(e.currentTarget.dataset.dislike)
    this.closeSwipe()
    this._swipe = null
    this._swipeMoved = false
    that.setData({ loading: true, loadingText: '保存中…' })
    store
      .setNovelDisliked(id, disliked)
      .then(function () {
        return that.reload(true, false, '保存中…')
      })
      .catch(function (err) {
        that.setData({ loading: false })
        wx.showToast({ title: (err && err.message) || '失败', icon: 'none' })
      })
  },
  toggleRead: function (e) {
    var that = this
    var id = e.currentTarget.dataset.id
    var read = !this._asBool(e.currentTarget.dataset.read)
    this.closeSwipe()
    this._swipe = null
    this._swipeMoved = false
    that.setData({ loading: true, loadingText: '保存中…' })
    store
      .setNovelRead(id, read)
      .then(function () {
        return that.reload(true, false, '保存中…')
      })
      .catch(function (err) {
        that.setData({ loading: false })
        wx.showToast({ title: (err && err.message) || '失败', icon: 'none' })
      })
  },
  onRate: function (e) {
    var that = this
    var id = e.currentTarget.dataset.id
    var n = Number(e.currentTarget.dataset.n) || 0
    this.closeSwipe()
    this._swipe = null
    this._swipeMoved = false
    that.setData({ loading: true, loadingText: '保存中…' })
    store
      .setNovelRating(id, n)
      .then(function () {
        return that.reload(true, false, '保存中…')
      })
      .catch(function (err) {
        that.setData({ loading: false })
        wx.showToast({ title: (err && err.message) || '失败', icon: 'none' })
      })
  },

  /** tab 随机：先选池子再抽 */
  onRandom: function () {
    if (this.data.randomBusy && this.data.randomOpen) return
    if (this.data.loading) {
      // 列表还在加载：记一笔，等 reload 结束后再打开
      this._openRandomWhenReady = true
      return
    }
    this._openRandomWhenReady = false
    if (this.data.selectMode) {
      wx.showToast({ title: '请先退出多选', icon: 'none' })
      return
    }
    this.openRandomPoolSheet()
  },

  openRandomPoolSheet: function () {
    this.setTabBarVisible(false)
    this.setData({ randomPoolOpen: true })
  },

  closeRandomPoolSheet: function () {
    this.setData({ randomPoolOpen: false })
    if (!this.data.randomOpen) this.setTabBarVisible(true)
  },

  onPickRandomPool: function (e) {
    var pool = (e.currentTarget.dataset && e.currentTarget.dataset.pool) || 'unread'
    if (pool !== 'unread' && pool !== 'want' && pool !== 'filter') pool = 'unread'
    try {
      wx.setStorageSync(RANDOM_POOL_KEY, pool)
    } catch (err) {
      /* ignore */
    }
    this.setData({ randomPool: pool, randomPoolOpen: false })
    this.drawFromPool(pool)
  },

  _randomQueryForPool: function (pool) {
    if (pool === 'want') {
      return {
        query: '',
        readFilter: 'want',
        tags: [],
        minRating: 0,
      }
    }
    if (pool === 'unread') {
      return {
        query: '',
        readFilter: 'unread',
        tags: [],
        minRating: 0,
      }
    }
    return {
      query: this.data.query,
      readFilter: this.data.readFilter,
      tags: sanitizeFilterTags(this.data.filterTags),
      minRating: this.data.minRating || 0,
    }
  },

  drawFromPool: function (pool) {
    var that = this
    var q = that._randomQueryForPool(pool || that.data.randomPool)
    var excludeId =
      that.data.randomNovel && that.data.randomNovel.id ? that.data.randomNovel.id : ''
    that.setData({ loading: true, loadingText: '抽取中…' })
    store
      .pickRandomNovel({
        query: q.query,
        readFilter: q.readFilter,
        tags: q.tags,
        minRating: q.minRating,
        excludeId: excludeId,
      })
      .then(function (n) {
        if (!n) {
          that.setData({ loading: false })
          var tip =
            pool === 'want'
              ? '「很想看」里没有书'
              : pool === 'unread'
                ? '没有未读书'
                : '当前筛选没有书'
          wx.showToast({ title: tip, icon: 'none' })
          if (!that.data.randomOpen) that.setTabBarVisible(true)
          return
        }
        return store
          .listNovelsPage({
            page: 1,
            query: q.query,
            readFilter: q.readFilter,
            tags: q.tags,
            minRating: q.minRating,
            sort: that.data.sortKey,
          })
          .then(function (pageRes) {
            return { novel: n, list: (pageRes && pageRes.list) || [] }
          })
          .catch(function () {
            return { novel: n, list: [n] }
          })
      })
      .then(function (pack) {
        that.setData({ loading: false })
        if (!pack || !pack.novel) return
        that.startRandomDraw(pack.novel, pack.list)
      })
      .catch(function (err) {
        that.setData({ loading: false })
        if (!that.data.randomOpen) that.setTabBarVisible(true)
        wx.showToast({ title: (err && err.message) || '失败', icon: 'none' })
      })
  },

  startRandomDraw: function (novel, list) {
    var that = this
    that.clearRandomTimers()

    var chars = []
    var pool = (list || []).slice()
    if (!pool.length) pool = [novel]
    for (var i = 0; i < 6; i++) {
      var src = pool[i % pool.length]
      chars.push(that._charOf(src && src.title))
    }
    // 打乱一点首字
    for (var j = chars.length - 1; j > 0; j--) {
      var k = Math.floor(Math.random() * (j + 1))
      var tmp = chars[j]
      chars[j] = chars[k]
      chars[k] = tmp
    }
    chars[2] = that._charOf(novel.title)

    var tags = (novel.tags || [])
      .filter(function (t) {
        return t !== '未读' && t !== '已读'
      })
      .slice(0, 4)

    var alreadyOpen = that.data.randomOpen
    that.setTabBarVisible(false)
    that.setData({
      randomOpen: true,
      randomSheetShow: alreadyOpen,
      randomNovel: novel,
      randomTagList: tags,
      randomHint: '正在洗牌…',
      randomPhase: 'spread',
      randomFlipped: false,
      randomBusy: true,
      drawCards: that._buildDrawCards(chars),
    })

    if (!alreadyOpen) {
      that._randTimer(function () {
        that.setData({ randomSheetShow: true })
      }, 30)
    }

    that._randTimer(function () {
      that.runDrawAnimation()
    }, alreadyOpen ? 40 : 80)
  },

  runDrawAnimation: function () {
    var that = this
    // 1) 散开 0–200ms+stagger（约 52px/张 ≈ 104rpx）
    var spreadOffsets = [-260, -156, -52, 52, 156, 260]
    var spreadRot = [-25, -15, -5, 5, 15, 25]
    for (var i = 0; i < 6; i++) {
      ;(function (idx) {
        that._randTimer(function () {
          that._setCardsStyle(function (c, j) {
            if (j !== idx) return c.style
            var x = spreadOffsets[j]
            var r = spreadRot[j]
            return (
              'opacity:1;transform:translate(' +
              x +
              'rpx,-8rpx) rotate(' +
              r +
              'deg);transition:transform 0.2s ease, opacity 0.2s ease;'
            )
          })
        }, idx * 40)
      })(i)
    }

    // 2) 洗牌 320–1300ms，4 轮（±130px ≈ ±260rpx）
    var shuffleStart = 320
    for (var round = 0; round < 4; round++) {
      ;(function (r) {
        that._randTimer(function () {
          that._setCardsStyle(function () {
            var dx = Math.round((Math.random() * 2 - 1) * 260)
            var dy = Math.round((Math.random() * 2 - 1) * 40)
            var rot = Math.round((Math.random() * 2 - 1) * 30)
            return (
              'opacity:1;transform:translate(' +
              dx +
              'rpx,' +
              dy +
              'rpx) rotate(' +
              rot +
              'deg) scale(0.95);transition:transform 0.24s ease;'
            )
          })
        }, shuffleStart + r * 240)
      })(round)
    }

    // 3) 收拢 1380ms
    that._randTimer(function () {
      that.setData({ randomPhase: 'gather', randomHint: '揭晓中…' })
      that._setCardsStyle(function () {
        return 'opacity:0;transform:translate(0,0) scale(0.5);transition:transform 0.35s cubic-bezier(0.34,1.56,0.64,1), opacity 0.35s ease;'
      })
    }, 1380)


    // 4) 揭晓 1750ms：先出渐变正面，等用户点翻面
    that._randTimer(function () {
      that.setData({
        randomPhase: 'reveal',
        randomFlipped: false,
        randomBusy: false,
        randomHint: '抽到啦，点卡片翻面看看',
      })
    }, 1750)
  },

  onFlipReveal: function () {
    if (this.data.randomFlipped) return
    if (this.data.randomPhase !== 'reveal' && this.data.randomPhase !== 'done') return
    var that = this
    that.setData({
      randomFlipped: true,
      randomBusy: false,
      randomPhase: 'done',
      randomHint: '抽到啦，要不要翻开看看？',
    })
  },



  closeRandom: function () {
    this.clearRandomTimers()
    this.setData({
      randomOpen: false,
      randomSheetShow: false,
      randomNovel: null,
      randomTagList: [],
      randomHint: '正在洗牌…',
      randomPhase: 'idle',
      randomFlipped: false,
      randomBusy: false,
      drawCards: [],
    })
    if (!this.data.selectMode) this.setTabBarVisible(true)
  },

  onRandomAgain: function () {
    if (this.data.randomBusy) return
    this.drawFromPool(this.data.randomPool)
  },

  toggleSelectMode: function () {
    var on = !this.data.selectMode
    this.setData({
      selectMode: on,
      selectedMap: {},
      selectedCount: 0,
      swipeOpenId: '',
      swipeX: 0,
    })
    this.setTabBarVisible(!on)
  },

  exitSelectMode: function () {
    this.setData({
      selectMode: false,
      selectedMap: {},
      selectedCount: 0,
      batchTagSheetOpen: false,
      batchTagSheetShow: false,
    })
    this.setTabBarVisible(true)
  },

  toggleSelectItem: function (e) {
    if (!this.data.selectMode) return
    var id = e.currentTarget.dataset.id
    if (!id) return
    var map = Object.assign({}, this.data.selectedMap)
    if (map[id]) delete map[id]
    else map[id] = true
    this.setData({
      selectedMap: map,
      selectedCount: Object.keys(map).length,
    })
  },

  _selectedIds: function () {
    return Object.keys(this.data.selectedMap || {})
  },

  onBatchMarkRead: function () {
    this.batchMarkRead(true)
  },

  batchMarkRead: function (isRead) {
    var that = this
    var ids = that._selectedIds()
    if (!ids.length) {
      wx.showToast({ title: '先选几本', icon: 'none' })
      return
    }
    that.setData({ loading: true, loadingText: '批量处理中…' })
    store
      .batchPatchNovels(ids, { isRead: !!isRead })
      .then(function () {
        that.exitSelectMode()
        return that.reload(true, false, '刷新中…')
      })
      .then(function () {
        wx.showToast({ title: isRead ? '已标为已读' : '已标为未读', icon: 'none' })
      })
      .catch(function (err) {
        that.setData({ loading: false })
        wx.showToast({ title: (err && err.message) || '失败', icon: 'none' })
      })
  },

  batchMarkDislike: function () {
    var that = this
    var ids = that._selectedIds()
    if (!ids.length) {
      wx.showToast({ title: '先选几本', icon: 'none' })
      return
    }
    wx.showModal({
      title: '移入不喜欢',
      content: '将选中的 ' + ids.length + ' 本标记为不喜欢',
      success: function (res) {
        if (!res.confirm) return
        that.setData({ loading: true, loadingText: '批量处理中…' })
        store
          .batchPatchNovels(ids, { disliked: true })
          .then(function () {
            that.exitSelectMode()
            return that.reload(true, false, '刷新中…')
          })
          .then(function () {
            wx.showToast({ title: '已移入不喜欢', icon: 'none' })
          })
          .catch(function (err) {
            that.setData({ loading: false })
            wx.showToast({ title: (err && err.message) || '失败', icon: 'none' })
          })
      },
    })
  },

  openBatchTagSheet: function () {
    var that = this
    if (!that._selectedIds().length) {
      wx.showToast({ title: '先选几本', icon: 'none' })
      return
    }
    var draft = that._buildTagDraftState([])
    that.setData(
      Object.assign(
        {
          batchTagSheetOpen: true,
          batchTagSheetShow: false,
        },
        {
          batchTagDraft: draft.tagDraft,
          batchTagDraftMap: draft.tagDraftMap,
          batchTagDraftItems: draft.tagDraftItems,
        },
      ),
    )
    setTimeout(function () {
      that.setData({ batchTagSheetShow: true })
    }, 30)
  },

  closeBatchTagSheet: function () {
    var that = this
    that.setData({ batchTagSheetShow: false })
    setTimeout(function () {
      that.setData({
        batchTagSheetOpen: false,
        batchTagDraft: [],
        batchTagDraftMap: {},
        batchTagDraftItems: [],
      })
    }, 220)
  },

  toggleBatchTagDraft: function (e) {
    var tag = e.currentTarget.dataset.tag
    if (!tag) return
    var list = sanitizeFilterTags(this.data.batchTagDraft)
    var idx = list.indexOf(tag)
    if (idx >= 0) list.splice(idx, 1)
    else list.push(tag)
    var draft = this._buildTagDraftState(list)
    this.setData({
      batchTagDraft: draft.tagDraft,
      batchTagDraftMap: draft.tagDraftMap,
      batchTagDraftItems: draft.tagDraftItems,
    })
  },

  confirmBatchTags: function () {
    var that = this
    var ids = that._selectedIds()
    var addTags = sanitizeFilterTags(that.data.batchTagDraft)
    if (!addTags.length) {
      wx.showToast({ title: '先选标签', icon: 'none' })
      return
    }
    that.closeBatchTagSheet()
    that.setData({ loading: true, loadingText: '批量加标签…' })
    store
      .batchPatchNovels(ids, { addTags: addTags })
      .then(function () {
        that.exitSelectMode()
        return that.reload(true, false, '刷新中…')
      })
      .then(function () {
        wx.showToast({ title: '已添加标签', icon: 'none' })
      })
      .catch(function (err) {
        that.setData({ loading: false })
        wx.showToast({ title: (err && err.message) || '失败', icon: 'none' })
      })
  },

  goRandomDetail: function () {
    if (this.data.randomBusy) return
    var n = this.data.randomNovel
    if (!n) return
    this.clearRandomTimers()
    this.setData({
      randomOpen: false,
      randomSheetShow: false,
      randomNovel: null,
      randomTagList: [],
      randomPhase: 'idle',
      randomBusy: false,
      drawCards: [],
    })
    if (!this.data.selectMode) this.setTabBarVisible(true)
    wx.navigateTo({ url: '/pages/detail/detail?id=' + n.id })
  },


  onExport: function () {
    wx.showLoading({ title: '导出中…', mask: true })
    store
      .exportMarkdown()
      .then(function (md) {
        wx.hideLoading()
        if (!md || !String(md).trim()) {
          wx.showToast({ title: '书架是空的', icon: 'none' })
          return
        }
        wx.setClipboardData({
          data: md,
          success: function () {
            wx.showToast({ title: '备份已复制到剪贴板', icon: 'none', duration: 2500 })
          },
        })
      })
      .catch(function (err) {
        wx.hideLoading()
        wx.showToast({ title: (err && err.message) || '导出失败', icon: 'none' })
      })
  },
})
