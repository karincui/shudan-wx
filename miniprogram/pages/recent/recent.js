var store = require('../../utils/store.js')
var themeBehavior = require('../../behaviors/themeBehavior.js')

var READER_POS_PREFIX = 'readerPos:'

function pad2(n) {
  return n < 10 ? '0' + n : String(n)
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function dayBucket(ts) {
  var n = Number(ts) || 0
  if (!n) return 'earlier'
  var d = new Date(n)
  if (!Number.isFinite(d.getTime())) return 'earlier'
  var today0 = startOfDay(new Date())
  var that0 = startOfDay(d)
  var dayMs = 24 * 60 * 60 * 1000
  if (that0 === today0) return 'today'
  if (that0 === today0 - dayMs) return 'yesterday'
  return 'earlier'
}

function formatRelativeTime(ts) {
  var n = Number(ts) || 0
  if (!n) return ''
  var d = new Date(n)
  if (!Number.isFinite(d.getTime())) return ''
  var now = Date.now()
  var diff = Math.max(0, now - n)
  var bucket = dayBucket(n)
  if (bucket === 'today') {
    if (diff < 60 * 1000) return '刚刚'
    if (diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + ' 分钟前'
    if (diff < 24 * 60 * 60 * 1000) return Math.floor(diff / 3600000) + ' 小时前'
    return '今天 ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes())
  }
  if (bucket === 'yesterday') {
    return '昨天 ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes())
  }
  if (d.getFullYear() === new Date().getFullYear()) {
    return pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes())
  }
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
}

function loadLocalPage(novelId) {
  if (!novelId) return 0
  try {
    var raw = wx.getStorageSync(READER_POS_PREFIX + novelId)
    if (raw && typeof raw === 'object') {
      var p = Number(raw.page) || 0
      return p > 0 ? Math.floor(p) : 0
    }
    var n = Number(raw)
    if (Number.isFinite(n) && n > 0) return Math.floor(n)
  } catch (e) {
    /* ignore */
  }
  return 0
}

function decorateItem(n) {
  var hasTxt = store.isTextAttachment(n.attachmentName)
  var page = loadLocalPage(n.id)
  return {
    id: n.id,
    title: n.title || '未命名',
    author: n.author || '',
    hasTxt: hasTxt,
    lastReadAt: Number(n.lastReadAt) || 0,
    bucket: dayBucket(n.lastReadAt),
    timeLabel: formatRelativeTime(n.lastReadAt),
    pageLabel: page > 0 ? '第 ' + page + ' 页' : '',
    initial: String(n.title || '书').trim().charAt(0) || '书',
    cta: hasTxt ? '续读' : '详情',
  }
}

Page({
  behaviors: [themeBehavior],

  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    loading: true,
    hero: null,
    yesterdayList: [],
    earlierList: [],
    empty: false,
  },

  onLoad: function () {
    this.initNavMetrics()
  },

  onShow: function () {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1, show: true })
    }
    this.reload()
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

  reload: function () {
    var that = this
    var startedAt = Date.now()
    that.setData({ loading: true })

    var finishWith = function (payload, err) {
      var wait = Math.max(0, 420 - (Date.now() - startedAt))
      setTimeout(function () {
        that.setData(
          Object.assign(
            {
              loading: false,
            },
            payload,
          ),
        )
        if (err) {
          wx.showToast({ title: (err && err.message) || '加载失败', icon: 'none' })
        }
      }, wait)
    }

    store
      .listRecentReading(30)
      .then(function (rows) {
        var items = (rows || []).map(decorateItem)
        var hero = items.length ? items[0] : null
        var rest = items.length > 1 ? items.slice(1) : []
        var yesterdayList = []
        var earlierList = []
        rest.forEach(function (it) {
          if (it.bucket === 'yesterday') yesterdayList.push(it)
          else earlierList.push(it)
        })
        finishWith({
          hero: hero,
          yesterdayList: yesterdayList,
          earlierList: earlierList,
          empty: !items.length,
        })
      })
      .catch(function (err) {
        finishWith(
          {
            hero: null,
            yesterdayList: [],
            earlierList: [],
            empty: true,
          },
          err,
        )
      })
  },

  onPullDownRefresh: function () {
    var that = this
    that.reload()
    setTimeout(function () {
      wx.stopPullDownRefresh()
    }, 400)
  },

  openItem: function (e) {
    var id = e.currentTarget.dataset.id
    var hasTxt = e.currentTarget.dataset.txt
    hasTxt = hasTxt === 1 || hasTxt === '1' || hasTxt === true
    if (!id) return
    if (hasTxt) {
      wx.navigateTo({ url: '/pages/reader/reader?id=' + id })
    } else {
      wx.navigateTo({ url: '/pages/detail/detail?id=' + id })
    }
  },

  goLibrary: function () {
    wx.switchTab({ url: '/pages/library/library' })
  },
})
