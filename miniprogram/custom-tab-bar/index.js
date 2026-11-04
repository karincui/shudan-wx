Component({
  data: {
    selected: 0,
    safeBottom: 0,
    show: true,
  },

  lifetimes: {
    attached: function () {
      var safeBottom = 0
      try {
        var info = wx.getSystemInfoSync()
        var inset = (info.safeAreaInsets && info.safeAreaInsets.bottom) || 0
        if (!inset && info.safeArea && info.screenHeight) {
          inset = Math.max(0, info.screenHeight - info.safeArea.bottom)
        }
        safeBottom = inset || 0
      } catch (e) {
        safeBottom = 0
      }
      this.setData({ safeBottom: safeBottom })
    },
  },

  methods: {
    onSwitch: function (e) {
      var path = e.currentTarget.dataset.path
      var index = Number(e.currentTarget.dataset.index)
      if (!path) return
      if (this.data.selected === index) return
      wx.switchTab({ url: path })
    },

    onRandom: function () {
      var app = getApp()
      if (app && app.globalData) {
        app.globalData.pendingRandom = true
      }
      var pages = getCurrentPages()
      var cur = pages && pages.length ? pages[pages.length - 1] : null
      if (cur && cur.route === 'pages/library/library') {
        if (typeof cur.runPendingRandom === 'function') {
          cur.runPendingRandom()
        } else if (typeof cur.onRandom === 'function') {
          if (app && app.globalData) app.globalData.pendingRandom = false
          cur.onRandom()
        }
        this.setData({ selected: 0 })
        return
      }
      wx.switchTab({ url: '/pages/library/library' })
    },
  },
})
