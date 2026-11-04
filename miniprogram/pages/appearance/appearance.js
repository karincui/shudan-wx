const store = require('../../utils/store')
const theme = require('../../utils/theme')
const themeBehavior = require('../../behaviors/themeBehavior')

function buildPreviewStyles(next) {
  const t = theme.normalizeTheme(next)
  let previewStyle =
    'color:' + t.ink + ';background-color:' + t.bg + ';position:relative;overflow:hidden;'
  let customPreviewStyle = 'background:' + t.bg + ';'
  if (t.bgImage) {
    const layers = theme.buildBgImageLayers(t)
    previewStyle +=
      'background-image:' +
      layers +
      ';background-size:cover;background-position:center;background-repeat:no-repeat;'
    customPreviewStyle =
      'background-image:' +
      layers +
      ';background-size:cover;background-position:center;background-color:' +
      t.bg +
      ';'
  }
  return { previewStyle, customPreviewStyle, theme: t }
}

Page({
  behaviors: [themeBehavior],

  data: {
    mode: 'day',
    bg: '#f6f4ef',
    ink: '#2a241c',
    card: '#ffffff',
    bgImage: '',
    bgImageFileID: '',
    bgImageOpacity: 100,
    pendingLocalImage: '',
    bgInput: '#f6f4ef',
    inkInput: '#2a241c',
    bgSwatches: theme.BG_SWATCHES,
    inkSwatches: theme.INK_SWATCHES,
    previewStyle: '',
    customPreviewStyle: '',
    saving: false,
  },

  onShow() {
    this.syncFromActive()
    this.applyPageTheme()
  },

  syncFromActive() {
    const base = theme.getActiveTheme()
    theme.resolveThemeForDisplay(base).then((t) => {
      const styles = buildPreviewStyles(t)
      this.setData({
        mode: t.mode,
        bg: t.bg,
        ink: t.ink,
        card: t.card,
        bgImage: t.bgImage || '',
        bgImageFileID: t.bgImageFileID || '',
        bgImageOpacity: theme.clampBgImageOpacity(t.bgImageOpacity, 100),
        pendingLocalImage: '',
        bgInput: t.bg,
        inkInput: t.ink,
        previewStyle: styles.previewStyle,
        customPreviewStyle: styles.customPreviewStyle,
        pageTheme: theme.buildPageStyle(t),
      })
    })
  },

  applyPreview(partial) {
    let next
    if (partial.mode === 'day') next = theme.PRESETS.day
    else if (partial.mode === 'night') next = theme.PRESETS.night
    else {
      next = theme.buildCustom({
        bg: partial.bg != null ? partial.bg : this.data.bg,
        ink: partial.ink != null ? partial.ink : this.data.ink,
        bgImage: partial.bgImage != null ? partial.bgImage : this.data.bgImage,
        bgImageFileID:
          partial.bgImageFileID != null ? partial.bgImageFileID : this.data.bgImageFileID,
        bgImageOpacity:
          partial.bgImageOpacity != null
            ? partial.bgImageOpacity
            : this.data.bgImageOpacity,
      })
    }
    const styles = buildPreviewStyles(next)
    this.setData({
      mode: next.mode,
      bg: next.bg,
      ink: next.ink,
      card: next.card,
      bgImage: next.bgImage || '',
      bgImageFileID: next.bgImageFileID || '',
      bgImageOpacity: theme.clampBgImageOpacity(next.bgImageOpacity, 100),
      bgInput: next.bg,
      inkInput: next.ink,
      previewStyle: styles.previewStyle,
      customPreviewStyle: styles.customPreviewStyle,
      pageTheme: theme.buildPageStyle(next),
    })
    theme.applyChrome(next)
  },

  onMode(e) {
    const mode = e.currentTarget.dataset.mode
    if (mode === 'custom') {
      this.applyPreview({
        mode: 'custom',
        bg: this.data.bg,
        ink: this.data.ink,
        bgImage: this.data.bgImage,
        bgImageFileID: this.data.bgImageFileID,
        bgImageOpacity: this.data.bgImageOpacity,
      })
      return
    }
    this.setData({ pendingLocalImage: '' })
    this.applyPreview({ mode })
  },

  onSwatch(e) {
    const type = e.currentTarget.dataset.type
    const color = e.currentTarget.dataset.color
    if (type === 'bg') {
      // 选手动背景色时清掉图片，避免误会
      this.setData({ pendingLocalImage: '' })
      this.applyPreview({
        mode: 'custom',
        bg: color,
        ink: this.data.ink,
        bgImage: '',
        bgImageFileID: '',
        bgImageOpacity: this.data.bgImageOpacity,
      })
    } else {
      this.applyPreview({
        mode: 'custom',
        bg: this.data.bg,
        ink: color,
        bgImage: this.data.bgImage,
        bgImageFileID: this.data.bgImageFileID,
        bgImageOpacity: this.data.bgImageOpacity,
      })
    }
  },

  onBgInput(e) {
    this.setData({ bgInput: (e.detail && e.detail.value) || '' })
  },

  onInkInput(e) {
    this.setData({ inkInput: (e.detail && e.detail.value) || '' })
  },

  onBgConfirm() {
    const bg = theme.normalizeHex(this.data.bgInput, this.data.bg)
    this.setData({ pendingLocalImage: '' })
    this.applyPreview({
      mode: 'custom',
      bg,
      ink: this.data.ink,
      bgImage: '',
      bgImageFileID: '',
      bgImageOpacity: this.data.bgImageOpacity,
    })
  },

  onInkConfirm() {
    const ink = theme.normalizeHex(this.data.inkInput, this.data.ink)
    this.applyPreview({
      mode: 'custom',
      bg: this.data.bg,
      ink,
      bgImage: this.data.bgImage,
      bgImageFileID: this.data.bgImageFileID,
      bgImageOpacity: this.data.bgImageOpacity,
    })
  },

  onBgOpacityChanging(e) {
    const bgImageOpacity = theme.clampBgImageOpacity(
      e.detail && e.detail.value,
      this.data.bgImageOpacity,
    )
    this.applyPreview({
      mode: 'custom',
      bg: this.data.bg,
      ink: this.data.ink,
      bgImage: this.data.bgImage,
      bgImageFileID: this.data.bgImageFileID,
      bgImageOpacity,
    })
  },

  onBgOpacityChange(e) {
    this.onBgOpacityChanging(e)
  },

  cropImage(src) {
    return new Promise((resolve, reject) => {
      if (!wx.cropImage) {
        // 低版本基础库：跳过裁剪，直接用原图
        resolve(src)
        return
      }
      wx.cropImage({
        src,
        // 不强制比例，尽量自由裁剪；部分基础库需要传值
        cropScale: '9:16',
        success: (res) => resolve((res && res.tempFilePath) || src),
        fail: (err) => {
          // 用户取消裁剪时保留原图
          if (err && /cancel/i.test(err.errMsg || '')) {
            resolve(src)
            return
          }
          resolve(src)
        },
      })
    })
  },

  onPickBgImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: async (res) => {
        const file = res.tempFiles && res.tempFiles[0]
        if (!file || !file.tempFilePath) return
        try {
          wx.showLoading({ title: '处理中…', mask: true })
          const cropped = await this.cropImage(file.tempFilePath)
          wx.hideLoading()
          this.setData({ pendingLocalImage: cropped })
          this.applyPreview({
            mode: 'custom',
            bg: this.data.bg,
            ink: this.data.ink,
            bgImage: cropped,
            // 新选的图尚未上传，先清旧 fileID，保存时再上传
            bgImageFileID: '',
            bgImageOpacity: this.data.bgImageOpacity || 70,
          })
          wx.showToast({ title: '已选背景图', icon: 'none' })
        } catch (err) {
          wx.hideLoading()
          wx.showToast({ title: (err && err.message) || '选图失败', icon: 'none' })
        }
      },
    })
  },

  onClearBgImage() {
    this.setData({ pendingLocalImage: '' })
    this.applyPreview({
      mode: 'custom',
      bg: this.data.bg,
      ink: this.data.ink,
      bgImage: '',
      bgImageFileID: '',
      bgImageOpacity: this.data.bgImageOpacity,
    })
  },

  onResetDay() {
    this.setData({ pendingLocalImage: '' })
    this.applyPreview({ mode: 'day' })
  },

  async onSave() {
    if (this.data.saving) return
    this.setData({ saving: true })
    try {
      let payload
      if (this.data.mode !== 'custom') {
        payload = { mode: this.data.mode }
      } else {
        let bgImageFileID = this.data.bgImageFileID || ''
        let bgImage = this.data.bgImage || ''
        if (this.data.pendingLocalImage) {
          wx.showLoading({ title: '上传背景图…', mask: true })
          bgImageFileID = await store.uploadThemeBackground(this.data.pendingLocalImage)
          bgImage = this.data.pendingLocalImage
          wx.hideLoading()
        }
        payload = {
          mode: 'custom',
          bg: this.data.bg,
          ink: this.data.ink,
          bgImage: bgImage,
          bgImageFileID: bgImageFileID,
          bgImageOpacity: theme.clampBgImageOpacity(this.data.bgImageOpacity, 100),
        }
      }
      await store.saveThemePrefs(payload)
      this.setData({ pendingLocalImage: '' })
      this.applyPageTheme()
      wx.showToast({ title: '已保存', icon: 'success' })
    } catch (err) {
      wx.hideLoading()
      try {
        const payload =
          this.data.mode === 'custom'
            ? {
                mode: 'custom',
                bg: this.data.bg,
                ink: this.data.ink,
                bgImage: this.data.bgImage,
                bgImageFileID: this.data.bgImageFileID,
                bgImageOpacity: theme.clampBgImageOpacity(this.data.bgImageOpacity, 100),
              }
            : { mode: this.data.mode }
        theme.setActiveTheme(payload)
        this.applyPageTheme()
        wx.showToast({ title: '已保存到本地', icon: 'none' })
      } catch (e2) {
        wx.showToast({ title: (err && err.message) || '保存失败', icon: 'none' })
      }
    } finally {
      this.setData({ saving: false })
    }
  },
})
