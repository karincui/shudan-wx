const store = require('../../utils/store')
const { parseWishlistMarkdown } = require('../../utils/mdImport')
const { parseTableText } = require('../../utils/csvImport')
const { parseOcrTexts } = require('../../utils/ocrImport')
const themeBehavior = require('../../behaviors/themeBehavior')

Page({
  behaviors: [themeBehavior],

  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
  },

  onLoad() {
    this.initNavMetrics()
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 })
    }
  },

  initNavMetrics() {
    try {
      const sys = wx.getSystemInfoSync()
      const statusBarHeight = sys.statusBarHeight || 20
      let navBarHeight = 44
      try {
        const menu = wx.getMenuButtonBoundingClientRect()
        if (menu && menu.height) {
          const gap = menu.top - statusBarHeight
          navBarHeight = menu.height + gap * 2
        }
      } catch (e) {
        /* keep */
      }
      this.setData({ statusBarHeight, navBarHeight })
    } catch (e) {
      this.setData({ statusBarHeight: 20, navBarHeight: 44 })
    }
  },

  onBackupEntry() {
    wx.showActionSheet({
      itemList: ['导入内置电脑备份', '从微信选 .md 备份'],
      success: (res) => {
        if (res.tapIndex === 0) this.importSeed()
        else if (res.tapIndex === 1) this.importMdFile()
      },
    })
  },


  applyRows(rows, label) {
    if (!rows.length) {
      wx.showToast({ title: '没有解析出书目', icon: 'none' })
      return
    }
    wx.showModal({
      title: '导入确认',
      content: `将从${label}导入 ${rows.length} 本到云端（已有的会跳过）`,
      success: async (res) => {
        if (!res.confirm) return
        try {
          wx.showLoading({ title: '导入中…', mask: true })
          const result = await store.importNovels(rows)
          wx.hideLoading()
          wx.showToast({
            title: `新增 ${result.added}，跳过 ${result.skipped}`,
            icon: 'none',
            duration: 2500,
          })
        } catch (err) {
          wx.hideLoading()
          wx.showToast({ title: err.message || '导入失败', icon: 'none' })
        }
      },
    })
  },

  importSeed() {
    try {
      const md = require('../../data/beifen.seed.js')
      this.applyRows(parseWishlistMarkdown(md), '电脑备份')
    } catch (err) {
      wx.showToast({ title: '未找到内置备份', icon: 'none' })
    }
  },

  readChosenFile(cb) {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0]
        if (!file) return
        wx.getFileSystemManager().readFile({
          filePath: file.path,
          encoding: 'utf8',
          success: (r) => cb(String(r.data || ''), file.name || '文件'),
          fail: () => wx.showToast({ title: '读取失败', icon: 'none' }),
        })
      },
    })
  },

  importMdFile() {
    this.readChosenFile((text, name) => {
      this.applyRows(parseWishlistMarkdown(text), name)
    })
  },

  goTableImport() {
    wx.navigateTo({ url: '/pages/table-import/table-import' })
  },

  async uploadTempFile(filePath, cloudPath) {
    const up = await wx.cloud.uploadFile({
      cloudPath: cloudPath,
      filePath: filePath,
    })
    if (!up.fileID) throw new Error('上传失败')
    return up.fileID
  },

  importTableFile() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['csv', 'txt', 'xlsx', 'xls'],
      success: async (res) => {
        const file = res.tempFiles && res.tempFiles[0]
        if (!file) return
        const name = file.name || 'table.csv'
        const lower = name.toLowerCase()
        try {
          // 纯文本本地解析，更快
          if (/\.(csv|txt)$/.test(lower)) {
            wx.getFileSystemManager().readFile({
              filePath: file.path,
              encoding: 'utf8',
              success: (r) => this.applyRows(parseTableText(String(r.data || '')), name),
              fail: () => wx.showToast({ title: '读取失败', icon: 'none' }),
            })
            return
          }

          wx.showLoading({ title: '解析表格…', mask: true })
          const fileID = await this.uploadTempFile(
            file.path,
            `import-temp/${Date.now()}-${name}`,
          )
          const cf = await wx.cloud.callFunction({
            name: 'parseTableFile',
            data: { fileID: fileID, fileName: name },
          })
          wx.hideLoading()
          const result = (cf && cf.result) || {}
          if (!result.ok) {
            wx.showToast({
              title: result.errMsg || '解析失败，请确认已上传云函数',
              icon: 'none',
              duration: 3000,
            })
            return
          }
          this.applyRows(result.rows || [], name)
        } catch (err) {
          wx.hideLoading()
          wx.showToast({
            title: (err && err.message) || '表格导入失败',
            icon: 'none',
            duration: 3000,
          })
        }
      },
    })
  },

  importScreenshot() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: async (res) => {
        const file = res.tempFiles && res.tempFiles[0]
        if (!file || !file.tempFilePath) return
        try {
          wx.showLoading({ title: '识别中…', mask: true })
          const ext = (file.tempFilePath.match(/\.\w+$/) || ['.jpg'])[0]
          const fileID = await this.uploadTempFile(
            file.tempFilePath,
            `ocr-temp/${Date.now()}${ext}`,
          )
          const cf = await wx.cloud.callFunction({
            name: 'ocrPrinted',
            data: { fileID: fileID },
          })
          wx.hideLoading()
          const result = (cf && cf.result) || {}
          if (!result.ok) {
            wx.showToast({
              title: result.errMsg || '识别失败，请确认已上传云函数',
              icon: 'none',
              duration: 3000,
            })
            return
          }
          const rows = parseOcrTexts(result.texts || [])
          this.applyRows(rows, '截图识别')
        } catch (err) {
          wx.hideLoading()
          wx.showToast({
            title: (err && err.errMsg) || (err && err.message) || '识别失败',
            icon: 'none',
            duration: 3000,
          })
        }
      },
    })
  },
})
