const store = require('../../utils/store')
const { tagTone } = require('../../utils/tagColors')

function formatSize(bytes) {
  const n = Number(bytes) || 0
  if (n <= 0) return ''
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10 * 1024 ? 1 : 0) + ' KB'
  return (n / (1024 * 1024)).toFixed(1) + ' MB'
}

function pad2(n) {
  return n < 10 ? '0' + n : String(n)
}

function formatLastRead(ts) {
  const n = Number(ts) || 0
  if (!n) return '还没记录'
  const d = new Date(n)
  if (!Number.isFinite(d.getTime())) return '还没记录'
  return (
    d.getFullYear() +
    '-' +
    pad2(d.getMonth() + 1) +
    '-' +
    pad2(d.getDate()) +
    ' ' +
    pad2(d.getHours()) +
    ':' +
    pad2(d.getMinutes())
  )
}

Page({
  data: {
    id: '',
    novel: null,
    loaded: false,
    displayTags: [],
    tagLine: '',
    attachSizeLabel: '',
    lastReadLabel: '还没记录',
    isText: false,
    starList: [1, 2, 3, 4, 5],
    reviewEditing: false,
    reviewDraft: '',
    statusBarHeight: 20,
    navBarHeight: 44,
  },

  onLoad(query) {
    this.setData({ id: query.id || '' })
    this.initNavMetrics()
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
        /* keep default */
      }
      this.setData({ statusBarHeight, navBarHeight })
    } catch (e) {
      this.setData({ statusBarHeight: 20, navBarHeight: 44 })
    }
  },

  onShow() {
    this.reload()
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/library/library' }) })
  },

  async reload() {
    try {
      const novel = await store.getNovel(this.data.id)
      this.setData({ loaded: true })
      if (!novel) {
        this.setData({ novel: null })
        wx.showToast({ title: '找不到这本书', icon: 'none' })
        return
      }
      const displayTags = (novel.tags || [])
        .filter((t) => t !== '未读' && t !== '已读')
        .map((name) => {
          const tone = tagTone(name)
          return { name, bg: tone.bg, fg: tone.fg }
        })
      const tagLine = displayTags.map((t) => t.name).join(' / ')
      this.setData({
        novel,
        displayTags,
        tagLine,
        attachSizeLabel: formatSize(novel.attachmentSize),
        lastReadLabel: formatLastRead(novel.lastReadAt),
        isText: store.isTextAttachment(novel.attachmentName),
        reviewDraft: this.data.reviewEditing ? this.data.reviewDraft : novel.review || '',
      })
    } catch (err) {
      this.setData({ loaded: true })
      wx.showToast({ title: err.message || '加载失败', icon: 'none' })
    }
  },

  async onStampRead() {
    const n = this.data.novel
    if (!n) return
    wx.showLoading({ title: '记录中…', mask: true })
    try {
      await store.setNovelLastRead(n.id)
      await this.reload()
      wx.hideLoading()
      wx.showToast({ title: '已记下', icon: 'success' })
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: err.message || '失败', icon: 'none' })
    }
  },

  async toggleWant() {
    const n = this.data.novel
    if (!n) return
    wx.showLoading({ title: '保存中…', mask: true })
    try {
      await store.setNovelWant(n.id, !n.wantToRead)
      await this.reload()
      wx.hideLoading()
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: err.message || '失败', icon: 'none' })
    }
  },

  async toggleDislike() {
    const n = this.data.novel
    if (!n) return
    wx.showLoading({ title: '保存中…', mask: true })
    try {
      await store.setNovelDisliked(n.id, !n.disliked)
      await this.reload()
      wx.hideLoading()
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: err.message || '失败', icon: 'none' })
    }
  },

  async togglePin() {
    const n = this.data.novel
    if (!n) return
    const pinned = !n.pinned
    wx.showLoading({ title: pinned ? '置顶中…' : '取消中…', mask: true })
    try {
      await store.setNovelPin(n.id, pinned)
      await this.reload()
      wx.hideLoading()
      wx.showToast({ title: pinned ? '已置顶' : '已取消置顶', icon: 'none' })
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: err.message || '失败', icon: 'none' })
    }
  },

  async toggleRead() {
    const n = this.data.novel
    if (!n) return
    try {
      await store.setNovelRead(n.id, !n.isRead)
      this.reload()
    } catch (err) {
      wx.showToast({ title: err.message || '失败', icon: 'none' })
    }
  },

  async onRate(e) {
    wx.showLoading({ title: '保存中…', mask: true })
    try {
      const n = Number(e.currentTarget.dataset.n) || 0
      await store.setNovelRating(this.data.id, n)
      await this.reload()
      wx.hideLoading()
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: err.message || '失败', icon: 'none' })
    }
  },

  toggleReviewEdit() {
    const n = this.data.novel
    if (!n) return
    const next = !this.data.reviewEditing
    this.setData({
      reviewEditing: next,
      reviewDraft: next ? n.review || '' : this.data.reviewDraft,
    })
  },

  onReviewInput(e) {
    this.setData({ reviewDraft: (e.detail && e.detail.value) || '' })
  },

  async saveReview() {
    const id = this.data.id
    if (!id) return
    wx.showLoading({ title: '保存中…', mask: true })
    try {
      await store.setNovelReview(id, this.data.reviewDraft)
      this.setData({ reviewEditing: false })
      await this.reload()
      wx.hideLoading()
      wx.showToast({ title: '已保存', icon: 'success' })
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: err.message || '保存失败', icon: 'none' })
    }
  },

  goEdit() {
    wx.navigateTo({ url: `/pages/edit/edit?id=${this.data.id}` })
  },

  async openAttach() {
    const n = this.data.novel
    if (!n || !n.attachmentFileID) {
      wx.showToast({ title: '没有附件', icon: 'none' })
      return
    }
    if (store.isTextAttachment(n.attachmentName)) {
      wx.navigateTo({ url: `/pages/reader/reader?id=${n.id}` })
      return
    }
    try {
      wx.showLoading({ title: '打开中…', mask: true })
      const path = await store.downloadAttachment(n.attachmentFileID)
      wx.hideLoading()
      wx.openDocument({
        filePath: path,
        showMenu: true,
        fail: () => wx.showToast({ title: '无法打开该附件', icon: 'none' }),
      })
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: err.message || '打开失败', icon: 'none' })
    }
  },

  onDelete() {
    wx.showModal({
      title: '删除确认',
      content: '删除后不可恢复，确定吗？',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await store.deleteNovel(this.data.id)
          wx.showToast({ title: '已删除', icon: 'success' })
          setTimeout(() => wx.navigateBack(), 400)
        } catch (err) {
          wx.showToast({ title: err.message || '删除失败', icon: 'none' })
        }
      },
    })
  },
})
