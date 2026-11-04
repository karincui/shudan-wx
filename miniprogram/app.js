// 直接写环境 ID，避免额外 require 导致白屏
var CLOUD_ENV_ID = 'xiaoshuo-d1gjmmum1bef3c60d'
var theme = require('./utils/theme.js')
var mintToast = require('./utils/toast.js')

App({
  onLaunch: function () {
    this.globalData.envId = CLOUD_ENV_ID
    this.globalData.cloudReady = false

    // 统一自定义 Toast（页面需放置 <mint-toast id="mintToast" />）
    try {
      mintToast.install()
    } catch (e) {
      /* ignore */
    }

    // 先应用本地主题，避免闪白天
    try {
      theme.setActiveTheme(theme.readLocal())
    } catch (e) {
      /* ignore */
    }

    if (!wx.cloud) {
      console.error('请使用支持云开发的基础库')
      return
    }

    try {
      wx.cloud.init({
        env: CLOUD_ENV_ID,
        traceUser: true,
      })
      this.globalData.cloudReady = true
    } catch (e) {
      console.error('云开发初始化失败', e)
    }
  },
  globalData: {
    envId: CLOUD_ENV_ID,
    cloudReady: false,
    pendingRandom: false,
  },
})

