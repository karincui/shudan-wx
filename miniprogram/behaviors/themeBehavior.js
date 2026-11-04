const theme = require('../utils/theme')

module.exports = Behavior({
  data: {
    pageTheme: '',
    themeBgImage: '',
  },

  lifetimes: {
    attached: function () {
      this.applyPageTheme()
    },
  },

  pageLifetimes: {
    show: function () {
      this.applyPageTheme()
    },
  },

  methods: {
    applyPageTheme: function () {
      var that = this
      var base = theme.getActiveTheme()
      that.setData({
        pageTheme: theme.buildPageStyle(base),
        themeBgImage: base.bgImage || '',
      })
      theme.applyChrome(base)
      theme.resolveThemeForDisplay(base).then(function (resolved) {
        that.setData({
          pageTheme: theme.buildPageStyle(resolved),
          themeBgImage: resolved.bgImage || '',
        })
        theme.applyChrome(resolved)
      })
    },
  },
})
