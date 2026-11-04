var store = require('../../utils/store.js')
var theme = require('../../utils/theme.js')
var themeBehavior = require('../../behaviors/themeBehavior.js')
var cloudEnv = require('../../cloudEnv.js')
var adminUtil = require('../../utils/admin.js')
var { parseWishlistMarkdown } = require('../../utils/mdImport.js')

/** 免费版常见配额参考（MB / 次），精确以控制台为准 */
var FREE_STORAGE_MB = 5 * 1024
var FREE_DB_MB = 2 * 1024

function formatSizeMB(mb) {
  var n = Number(mb)
  if (!Number.isFinite(n)) return '—'
  if (n >= 1024) return (Math.round((n / 1024) * 100) / 100) + ' GB'
  return (Math.round(n * 100) / 100) + ' MB'
}

function buildLocalEstimate(novels) {
  var list = novels || []
  var storageBytes = 0
  var withFile = 0
  list.forEach(function (n) {
    var size = Number(n && n.attachmentSize) || 0
    if (size > 0) {
      storageBytes += size
      withFile += 1
    }
  })
  var storageMB = Math.round((storageBytes / (1024 * 1024)) * 100) / 100
  var storagePct = Math.min(100, Math.round((storageMB / FREE_STORAGE_MB) * 1000) / 10)
  // 每条小说文档粗估 2KB，仅作参考
  var dbMB = Math.round(((list.length * 2) / 1024) * 100) / 100
  var dbPct = Math.min(100, Math.round((dbMB / FREE_DB_MB) * 1000) / 10)
  return {
    source: 'estimate',
    tip: '小程序不能直接读官方账单；以下按书架附件估算，对照免费额度。精确余量：开发者工具 → 云开发 → 资源监控 / 用量统计',
    items: [
      {
        key: 'storage',
        label: '云存储（TXT 等）',
        usedText: formatSizeMB(storageMB),
        remainText: formatSizeMB(Math.max(0, FREE_STORAGE_MB - storageMB)),
        quotaText: formatSizeMB(FREE_STORAGE_MB),
        percent: storagePct,
        detail: withFile + ' 个附件 · ' + list.length + ' 本藏书',
      },
      {
        key: 'db',
        label: '数据库容量（估）',
        usedText: formatSizeMB(dbMB),
        remainText: formatSizeMB(Math.max(0, FREE_DB_MB - dbMB)),
        quotaText: formatSizeMB(FREE_DB_MB),
        percent: dbPct,
        detail: '按文档条数粗估，非官方计量',
      },
    ],
  }
}

Page({
  behaviors: [themeBehavior],

  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    capsulePadRight: 96,
    darkMode: false,
    stats: { all: 0, read: 0, want: 0, dislike: 0, unread: 0, readPct: 0 },
    cloudQuota: {
      open: false,
      show: false,
      loading: false,
      source: '',
      tip: '',
      items: [],
    },
    exportOpen: false,
    exportShow: false,
    exportLoading: false,
    exportMd: '',
    exportBusy: false,
    feedbackOpen: false,
    feedbackShow: false,
    feedbackContent: '',
    feedbackContact: '',
    feedbackBusy: false,
    feedbackCanSubmit: false,
    isAdmin: false,
    feedbackBadge: false,
    myOpenId: '',
  },

  _exportCloseTimer: null,
  _quotaCloseTimer: null,
  _feedbackCloseTimer: null,
  _darkSaving: false,
  _quotaLoading: false,

  onLoad: function () {
    this.initNavMetrics()
  },

  onShow: function () {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({
        selected: 4,
        show:
          !this.data.exportOpen &&
          !this.data.cloudQuota.open &&
          !this.data.feedbackOpen,
      })
    }
    this.syncDarkMode()
    this.loadStats()
    this.checkAdmin()
  },

  onHide: function () {
    if (this.data.exportOpen) {
      this.setData({
        exportOpen: false,
        exportShow: false,
        exportLoading: false,
        exportMd: '',
      })
      this.setTabBarVisible(true)
    }
    if (this.data.cloudQuota.open || this._quotaLoading) {
      this.setData({
        'cloudQuota.open': false,
        'cloudQuota.show': false,
        'cloudQuota.loading': false,
      })
      this._quotaLoading = false
      this.setTabBarVisible(true)
    }
    if (this.data.feedbackOpen) {
      this.setData({
        feedbackOpen: false,
        feedbackShow: false,
        feedbackContent: '',
        feedbackContact: '',
        feedbackBusy: false,
        feedbackCanSubmit: false,
      })
      this.setTabBarVisible(true)
    }
  },

  onUnload: function () {
    if (this._exportCloseTimer) {
      clearTimeout(this._exportCloseTimer)
      this._exportCloseTimer = null
    }
    if (this._quotaCloseTimer) {
      clearTimeout(this._quotaCloseTimer)
      this._quotaCloseTimer = null
    }
    if (this._feedbackCloseTimer) {
      clearTimeout(this._feedbackCloseTimer)
      this._feedbackCloseTimer = null
    }
  },

  initNavMetrics: function () {
    try {
      var sys = wx.getSystemInfoSync()
      var statusBarHeight = sys.statusBarHeight || 20
      var windowWidth = sys.windowWidth || 375
      var navBarHeight = 44
      // 给右侧设置按钮留出胶囊按钮宽度，避免叠在「··· / 关闭」下面
      var capsulePadRight = 96
      try {
        var menu = wx.getMenuButtonBoundingClientRect()
        if (menu && menu.height) {
          var gap = menu.top - statusBarHeight
          navBarHeight = menu.height + gap * 2
        }
        if (menu && menu.left) {
          capsulePadRight = Math.ceil(windowWidth - menu.left + 8)
        }
      } catch (e) {
        /* keep */
      }
      this.setData({
        statusBarHeight: statusBarHeight,
        navBarHeight: navBarHeight,
        capsulePadRight: capsulePadRight,
      })
    } catch (e) {
      this.setData({ statusBarHeight: 20, navBarHeight: 44, capsulePadRight: 96 })
    }
  },

  syncDarkMode: function () {
    var t = theme.getActiveTheme()
    this.setData({ darkMode: t.mode === 'night' })
  },

  loadStats: function () {
    var that = this
    store
      .countNovelsByStatus({ readFilter: 'all' })
      .then(function (counts) {
        var shelf = (counts && counts.all) || 0
        var read = (counts && counts.read) || 0
        var want = (counts && counts.want) || 0
        var dislike = (counts && counts.dislike) || 0
        var unread = (counts && counts.unread) || 0
        that.setData({
          stats: {
            // 总藏书含不喜欢；列表「全部」Tab 不含
            all: shelf + dislike,
            read: read,
            want: want,
            dislike: dislike,
            unread: unread,
            readPct: shelf > 0 ? Math.round((read / shelf) * 100) : 0,
          },
        })
      })
      .catch(function () {
        /* keep previous */
      })
  },

  openCloudQuota: function () {
    var that = this
    if (this.data.cloudQuota.open || this._quotaLoading) return
    this.setTabBarVisible(false)
    this.setData({
      'cloudQuota.open': true,
      'cloudQuota.show': false,
      'cloudQuota.loading': true,
      'cloudQuota.source': '',
      'cloudQuota.tip': '',
      'cloudQuota.items': [],
    })
    setTimeout(function () {
      that.setData({ 'cloudQuota.show': true })
    }, 20)
    this.loadCloudQuota()
  },

  closeCloudQuota: function () {
    var that = this
    if (!this.data.cloudQuota.open) return
    this._quotaLoading = false
    this.setData({ 'cloudQuota.show': false, 'cloudQuota.loading': false })
    if (this._quotaCloseTimer) clearTimeout(this._quotaCloseTimer)
    this._quotaCloseTimer = setTimeout(function () {
      that.setData({
        'cloudQuota.open': false,
        'cloudQuota.source': '',
        'cloudQuota.tip': '',
        'cloudQuota.items': [],
      })
      that.setTabBarVisible(true)
      that._quotaCloseTimer = null
    }, 220)
  },

  loadCloudQuota: function () {
    if (this._quotaLoading) return
    var that = this
    this._quotaLoading = true
    this.setData({
      'cloudQuota.loading': true,
    })

    var patchQuota = function (next) {
      that.setData({
        'cloudQuota.source': next.source || '',
        'cloudQuota.tip': next.tip || '',
        'cloudQuota.items': next.items || [],
        'cloudQuota.loading': false,
      })
    }

    var applyEstimate = function () {
      return store
        .listNovels({ readFilter: 'raw' })
        .then(function (list) {
          var est = buildLocalEstimate(list)
          patchQuota(est)
        })
        .catch(function () {
          patchQuota({
            source: 'error',
            tip: '暂时读不到用量。可到：开发者工具 → 云开发 → 资源监控 查看官方余量',
            items: [],
          })
        })
    }

    var finish = function () {
      that._quotaLoading = false
      that.setData({ 'cloudQuota.loading': false })
    }

    if (!wx.cloud || !wx.cloud.callFunction) {
      applyEstimate().then(finish, finish)
      return
    }

    wx.cloud
      .callFunction({
        name: 'getCloudQuota',
        data: { envId: (cloudEnv && cloudEnv.envId) || '' },
      })
      .then(function (res) {
        var result = (res && res.result) || {}
        if (result.ok && result.items && result.items.length) {
          patchQuota({
            source: result.source || 'quota',
            tip: result.tip || '',
            items: result.items.map(function (it) {
              return {
                key: it.key,
                label: it.label,
                usedText: it.usedText,
                remainText: it.remainText,
                quotaText: it.quotaText,
                percent: it.percent || 0,
                detail: '已用 ' + it.usedText + ' / 配额 ' + it.quotaText,
              }
            }),
          })
          return
        }
        return applyEstimate()
      })
      .catch(function () {
        return applyEstimate()
      })
      .then(finish, finish)
  },

  refreshCloudQuota: function () {
    if (this._quotaLoading || !this.data.cloudQuota.open) return
    this.loadCloudQuota()
  },

  applyAdminState: function (openid, serverIsAdmin, openFeedbackCount) {
    var id = String(openid || '').trim()
    var isAdmin = !!serverIsAdmin || adminUtil.isAdminOpenId(id)
    var badge = false
    if (isAdmin && serverIsAdmin) {
      badge = Number(openFeedbackCount) > 0
    }
    this.setData({
      myOpenId: id,
      isAdmin: isAdmin,
      feedbackBadge: badge,
    })
    return isAdmin
  },

  checkAdmin: function () {
    var that = this
    if (!wx.cloud || !wx.cloud.callFunction) return
    wx.cloud
      .callFunction({
        name: 'adminApi',
        data: { action: 'checkAdmin' },
      })
      .then(function (res) {
        var result = (res && res.result) || {}
        if (result.ok) {
          that.applyAdminState(result.openid, result.isAdmin, result.openFeedbackCount)
          return
        }
        // checkAdmin 异常时再取一次 openid，用本地白名单判断入口显示
        return wx.cloud
          .callFunction({
            name: 'adminApi',
            data: { action: 'getOpenId' },
          })
          .then(function (res2) {
            var r2 = (res2 && res2.result) || {}
            that.applyAdminState(r2.openid, false, 0)
          })
      })
      .catch(function () {
        wx.cloud
          .callFunction({
            name: 'adminApi',
            data: { action: 'getOpenId' },
          })
          .then(function (res) {
            var result = (res && res.result) || {}
            that.applyAdminState(result.openid, false, 0)
          })
          .catch(function () {
            that.setData({ isAdmin: false, feedbackBadge: false })
          })
      })
  },

  /** 长按标题：复制当前 OpenID，便于核对白名单 */
  onTitleLongPress: function () {
    var that = this
    var copy = function (openid) {
      if (!openid) {
        wx.showToast({ title: '未获取到 OpenID', icon: 'none' })
        return
      }
      wx.setClipboardData({
        data: openid,
        success: function () {
          wx.showToast({ title: '已复制 OpenID', icon: 'success' })
        },
      })
    }
    if (this.data.myOpenId) {
      copy(this.data.myOpenId)
      return
    }
    wx.showLoading({ title: '获取中…', mask: true })
    wx.cloud
      .callFunction({
        name: 'adminApi',
        data: { action: 'getOpenId' },
      })
      .then(function (res) {
        wx.hideLoading()
        var result = (res && res.result) || {}
        var openid = result.openid || ''
        that.applyAdminState(openid, false)
        copy(openid)
      })
      .catch(function () {
        wx.hideLoading()
        wx.showToast({ title: '请先部署 adminApi', icon: 'none' })
      })
  },

  goFeedbackAdmin: function () {
    var that = this
    if (!wx.cloud || !wx.cloud.callFunction) {
      wx.showToast({ title: '云开发不可用', icon: 'none' })
      return
    }
    wx.showLoading({ title: '校验中…', mask: true })
    wx.cloud
      .callFunction({
        name: 'adminApi',
        data: { action: 'checkAdmin' },
      })
      .then(function (res) {
        wx.hideLoading()
        var result = (res && res.result) || {}
        var openid = result.openid || that.data.myOpenId || ''
        var isAdmin = that.applyAdminState(openid, result.isAdmin, result.openFeedbackCount)
        if (isAdmin) {
          wx.navigateTo({ url: '/pages/feedback-admin/feedback-admin' })
          return
        }
        wx.showModal({
          title: '无管理员权限',
          content:
            '当前 OpenID：\n' +
            (openid || '（未获取到）') +
            '\n\n请把该值写入云函数白名单后重新部署 adminApi。',
          confirmText: '复制 OpenID',
          success: function (r) {
            if (!r.confirm || !openid) return
            wx.setClipboardData({ data: openid })
          },
        })
      })
      .catch(function (err) {
        wx.hideLoading()
        wx.showToast({
          title: (err && err.message) || '请先部署 adminApi',
          icon: 'none',
        })
      })
  },

  openFeedback: function () {
    var that = this
    if (this.data.feedbackOpen) return
    this.setTabBarVisible(false)
    this.setData({
      feedbackOpen: true,
      feedbackShow: false,
      feedbackContent: '',
      feedbackContact: '',
      feedbackBusy: false,
      feedbackCanSubmit: false,
    })
    setTimeout(function () {
      that.setData({ feedbackShow: true })
    }, 20)
  },

  closeFeedback: function () {
    var that = this
    if (!this.data.feedbackOpen || this.data.feedbackBusy) return
    this.setData({ feedbackShow: false })
    if (this._feedbackCloseTimer) clearTimeout(this._feedbackCloseTimer)
    this._feedbackCloseTimer = setTimeout(function () {
      that.setData({
        feedbackOpen: false,
        feedbackContent: '',
        feedbackContact: '',
        feedbackBusy: false,
        feedbackCanSubmit: false,
      })
      that.setTabBarVisible(true)
      that._feedbackCloseTimer = null
    }, 220)
  },

  onFeedbackContent: function (e) {
    var content = (e.detail && e.detail.value) || ''
    this.setData({
      feedbackContent: content,
      feedbackCanSubmit: !!String(content).trim(),
    })
  },

  onFeedbackContact: function (e) {
    this.setData({
      feedbackContact: (e.detail && e.detail.value) || '',
    })
  },

  submitFeedback: function () {
    var that = this
    if (this.data.feedbackBusy || !this.data.feedbackCanSubmit) return
    var content = String(this.data.feedbackContent || '').trim()
    if (!content) {
      wx.showToast({ title: '请填写反馈内容', icon: 'none' })
      return
    }
    this.setData({ feedbackBusy: true })
    store
      .submitFeedback({
        content: content,
        contact: this.data.feedbackContact,
      })
      .then(function () {
        that.setData({ feedbackBusy: false })
        that.closeFeedback()
        setTimeout(function () {
          wx.showToast({
            title: '已提交，谢谢反馈',
            icon: 'success',
            duration: 2200,
          })
        }, 240)
      })
      .catch(function (err) {
        that.setData({ feedbackBusy: false })
        wx.showToast({
          title: (err && err.message) || '提交失败',
          icon: 'none',
        })
      })
  },

  goAppearance: function () {
    wx.navigateTo({ url: '/pages/appearance/appearance' })
  },

  goTags: function () {
    wx.navigateTo({ url: '/pages/tags/tags' })
  },

  onToggleDark: function () {
    if (this._darkSaving) return
    var that = this
    var nextDark = !this.data.darkMode
    var next = nextDark ? theme.PRESETS.night : theme.PRESETS.day
    this._darkSaving = true
    this.setData({ darkMode: nextDark })
    store
      .saveThemePrefs(next)
      .then(function () {
        that.applyPageTheme()
      })
      .catch(function (err) {
        that.setData({ darkMode: !nextDark })
        wx.showToast({
          title: (err && err.message) || '切换失败',
          icon: 'none',
        })
      })
      .then(function () {
        that._darkSaving = false
      })
  },

  setTabBarVisible: function (show) {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ show: !!show })
    }
  },

  openRestore: function () {
    var that = this
    wx.showActionSheet({
      itemList: ['导入内置电脑备份', '从微信选 .md 备份', '去导入页看全部方式'],
      success: function (res) {
        if (res.tapIndex === 0) that.importSeed()
        else if (res.tapIndex === 1) that.importMdFile()
        else if (res.tapIndex === 2) wx.switchTab({ url: '/pages/import/import' })
      },
    })
  },

  importSeed: function () {
    try {
      var md = require('../../data/beifen.seed.js')
      this.applyBackupRows(parseWishlistMarkdown(md), '电脑备份')
    } catch (err) {
      wx.showToast({ title: '未找到内置备份', icon: 'none' })
    }
  },

  importMdFile: function () {
    var that = this
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      success: function (res) {
        var file = res.tempFiles && res.tempFiles[0]
        if (!file) return
        wx.getFileSystemManager().readFile({
          filePath: file.path,
          encoding: 'utf8',
          success: function (r) {
            that.applyBackupRows(parseWishlistMarkdown(String(r.data || '')), file.name || '备份')
          },
          fail: function () {
            wx.showToast({ title: '读取失败', icon: 'none' })
          },
        })
      },
    })
  },

  applyBackupRows: function (rows, label) {
    if (!rows || !rows.length) {
      wx.showToast({ title: '没有解析出书目', icon: 'none' })
      return
    }
    var that = this
    wx.showModal({
      title: '导入确认',
      content: '将从' + label + '导入 ' + rows.length + ' 本到云端（已有的会跳过）',
      success: function (res) {
        if (!res.confirm) return
        wx.showLoading({ title: '导入中…', mask: true })
        store
          .importNovels(rows)
          .then(function (result) {
            wx.hideLoading()
            that.loadStats()
            wx.showToast({
              title: '新增 ' + result.added + '，跳过 ' + result.skipped,
              icon: 'none',
              duration: 2500,
            })
          })
          .catch(function (err) {
            wx.hideLoading()
            wx.showToast({ title: (err && err.message) || '导入失败', icon: 'none' })
          })
      },
    })
  },

  openExport: function () {
    var that = this
    if (this.data.exportOpen) return
    this.setTabBarVisible(false)
    this.setData({
      exportOpen: true,
      exportShow: false,
      exportLoading: true,
      exportMd: '',
      exportBusy: false,
    })
    setTimeout(function () {
      that.setData({ exportShow: true })
    }, 20)

    store
      .exportMarkdown()
      .then(function (md) {
        if (!that.data.exportOpen) return
        if (!md || !String(md).trim()) {
          that.closeExport()
          setTimeout(function () {
            wx.showToast({ title: '书架是空的', icon: 'none' })
          }, 240)
          return
        }
        that.setData({
          exportLoading: false,
          exportMd: md,
          exportBusy: false,
        })
      })
      .catch(function (err) {
        if (!that.data.exportOpen) return
        that.closeExport()
        setTimeout(function () {
          wx.showToast({
            title: (err && err.message) || '导出失败',
            icon: 'none',
          })
        }, 240)
      })
  },

  closeExport: function () {
    var that = this
    if (!this.data.exportOpen) return
    this.setData({ exportShow: false, exportLoading: false })
    if (this._exportCloseTimer) clearTimeout(this._exportCloseTimer)
    this._exportCloseTimer = setTimeout(function () {
      that.setData({ exportOpen: false, exportMd: '', exportBusy: false })
      that.setTabBarVisible(true)
      that._exportCloseTimer = null
    }, 220)
  },

  copyExport: function () {
    var that = this
    if (this.data.exportBusy) return
    var md = this.data.exportMd
    if (!md || !String(md).trim()) {
      wx.showToast({ title: '没有可复制的内容', icon: 'none' })
      return
    }
    this.setData({ exportBusy: true })
    wx.setClipboardData({
      data: String(md),
      success: function () {
        that.setData({ exportBusy: false })
        that.closeExport()
        setTimeout(function () {
          wx.showToast({ title: '已复制到剪贴板', icon: 'success', duration: 2000 })
        }, 260)
      },
      fail: function () {
        that.setData({ exportBusy: false })
        wx.showToast({ title: '复制失败', icon: 'none' })
      },
    })
  },

  noop: function () {},
})
