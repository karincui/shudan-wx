Component({
  data: {
    visible: false,
    type: 'none',
    title: '',
    sub: '',
    mask: false,
  },

  lifetimes: {
    detached: function () {
      this.clearTimer()
    },
  },

  methods: {
    noop: function () {},

    clearTimer: function () {
      if (this._timer) {
        clearTimeout(this._timer)
        this._timer = null
      }
    },

    show: function (options) {
      options = options || {}
      var that = this
      var type = options.type === 'success' || options.type === 'loading' ? options.type : 'none'
      var duration = Number(options.duration)
      if (!Number.isFinite(duration)) duration = type === 'loading' ? 0 : 2000

      this.clearTimer()
      this.setData({
        visible: true,
        type: type,
        title: String(options.title || ''),
        sub: String(options.sub || ''),
        mask: type === 'loading' ? options.mask !== false : false,
      })

      if (duration > 0) {
        this._timer = setTimeout(function () {
          that.hide()
        }, duration)
      }
    },

    hide: function () {
      this.clearTimer()
      this.setData({
        visible: false,
        title: '',
        sub: '',
        mask: false,
      })
    },
  },
})
