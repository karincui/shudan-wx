const store = require('../../utils/store')
const { tagTone } = require('../../utils/tagColors')
const themeBehavior = require('../../behaviors/themeBehavior')

const STATUS = { 未读: true, 已读: true }

Page({
  behaviors: [themeBehavior],

  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    name: '',
    canAdd: false,
    query: '',
    items: [],
    filtered: [],
    adding: false,
    loading: false,
    loadingText: '加载中…',
    dragging: false,
    dragIndex: -1,
    dragItem: null,
    dragTop: 0,
    dragLeft: 0,
    dragWidth: 0,
  },

  _lastTouch: null,
  _pressIndex: -1,
  _listTop: 0,
  _rowHeight: 64,
  _grabOffsetY: 0,
  _moving: false,
  _orderDirty: false,

  onLoad() {
    this.initNavMetrics()
  },

  onShow() {
    this.reload('加载标签…')
  },

  goBack() {
    wx.navigateBack({
      fail: function () {
        wx.switchTab({ url: '/pages/me/me' })
      },
    })
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

  decorate(tags) {
    const presets = new Set(store.getPresetTags() || [])
    return (tags || []).map((name) => {
      const tone = tagTone(name)
      let kind = 'custom'
      if (STATUS[name]) kind = 'status'
      else if (presets.has(name)) kind = 'preset'
      return {
        name,
        bg: tone.bg,
        fg: tone.fg,
        kind,
        canDelete: !STATUS[name],
      }
    })
  },

  applyFilter(items, query) {
    const q = String(query || '')
      .trim()
      .toLowerCase()
    if (!q) return items
    return items.filter((it) => String(it.name).toLowerCase().indexOf(q) >= 0)
  },

  async reload(loadingText) {
    this.setData({
      loading: true,
      loadingText: loadingText || '加载中…',
      dragging: false,
      dragIndex: -1,
      dragItem: null,
    })
    try {
      const tags = await store.getAllTags()
      const items = this.decorate(tags)
      this.setData({
        items,
        filtered: this.applyFilter(items, this.data.query),
        loading: false,
      })
    } catch (err) {
      this.setData({ loading: false })
      wx.showToast({ title: err.message || '加载失败', icon: 'none' })
    }
  },

  onInput(e) {
    const name = (e.detail && e.detail.value) || ''
    this.setData({ name, canAdd: !!String(name).trim() })
  },

  clearName() {
    this.setData({ name: '', canAdd: false })
  },

  onQuery(e) {
    if (this.data.dragging) return
    const query = (e.detail && e.detail.value) || ''
    this.setData({
      query,
      filtered: this.applyFilter(this.data.items, query),
    })
  },

  clearQuery() {
    if (this.data.dragging) return
    this.setData({
      query: '',
      filtered: this.data.items,
    })
  },

  async onAdd() {
    const name = (this.data.name || '').trim()
    if (!name || this.data.adding || this.data.loading || this.data.dragging) return
    if (STATUS[name]) {
      wx.showToast({ title: '状态标签已存在', icon: 'none' })
      return
    }
    this.setData({
      adding: true,
      loading: true,
      loadingText: '添加中…',
    })
    try {
      await store.addCustomTag(name)
      this.setData({ name: '', canAdd: false, adding: false })
      await this.reload('刷新标签…')
      wx.showToast({ title: '已添加', icon: 'success' })
    } catch (err) {
      this.setData({ adding: false, loading: false })
      wx.showToast({ title: err.message || '失败', icon: 'none' })
    }
  },

  onRowTouchStart(e) {
    if (this.data.query || this.data.loading) return
    const touch = e.touches && e.touches[0]
    if (!touch) return
    this._lastTouch = { x: touch.clientX, y: touch.clientY }
    this._pressIndex = Number(e.currentTarget.dataset.index)
  },

  onRowLongPress(e) {
    if (this.data.query || this.data.loading || this.data.dragging || this._moving) return
    const index = Number(e.currentTarget.dataset.index)
    if (!Number.isFinite(index) || index < 0) return
    this.startDrag(index)
  },

  onRowTouchMove(e) {
    const touch = e.touches && e.touches[0]
    if (!touch) return
    this._lastTouch = { x: touch.clientX, y: touch.clientY }
    if (!this.data.dragging) return
    this.updateDragPosition(touch.clientY)
  },

  onDragLayerMove(e) {
    const touch = e.touches && e.touches[0]
    if (!touch || !this.data.dragging) return
    this._lastTouch = { x: touch.clientX, y: touch.clientY }
    this.updateDragPosition(touch.clientY)
  },

  onRowTouchEnd() {
    if (!this.data.dragging) return
    this.finishDrag()
  },

  startDrag(index) {
    const items = this.data.filtered || []
    const item = items[index]
    if (!item) return
    const that = this
    const touch = this._lastTouch || { x: 0, y: 0 }

    wx.createSelectorQuery()
      .select('#tagList')
      .boundingClientRect()
      .selectAll('.tag-list > .tag-row')
      .boundingClientRect()
      .exec(function (res) {
        const listRect = res && res[0]
        const rows = (res && res[1]) || []
        const rowRect = rows[index]
        if (!listRect || !rowRect) return

        that._listTop = listRect.top
        // 含行间距，拖拽换位才准
        that._rowHeight =
          rows.length > 1 && rows[1] && rows[0]
            ? Math.max(1, rows[1].top - rows[0].top)
            : rowRect.height || 64
        that._grabOffsetY = Math.max(0, touch.y - rowRect.top)
        that._orderDirty = false

        try {
          wx.vibrateShort({ type: 'medium' })
        } catch (err) {
          /* ignore */
        }

        that.setData({
          dragging: true,
          dragIndex: index,
          dragItem: item,
          dragTop: rowRect.top,
          dragLeft: rowRect.left,
          dragWidth: rowRect.width,
        })
      })
  },

  updateDragPosition(clientY) {
    if (!this.data.dragging) return
    const items = (this.data.items || []).slice()
    if (!items.length) return

    const rowH = this._rowHeight || 64
    const listTop = this._listTop || 0
    let next = Math.floor((clientY - listTop) / rowH)
    if (next < 0) next = 0
    if (next > items.length - 1) next = items.length - 1

    const dragTop = clientY - (this._grabOffsetY || rowH / 2)
    const cur = this.data.dragIndex
    if (next !== cur && cur >= 0 && cur < items.length) {
      const moved = items.splice(cur, 1)[0]
      items.splice(next, 0, moved)
      this._orderDirty = true
      this.setData({
        items: items,
        filtered: items,
        dragIndex: next,
        dragItem: moved,
        dragTop: dragTop,
      })
      return
    }

    this.setData({ dragTop: dragTop })
  },

  async finishDrag() {
    if (!this.data.dragging || this._moving) return
    const orderDirty = this._orderDirty
    const names = (this.data.items || []).map(function (it) {
      return it.name
    })
    this.setData({
      dragging: false,
      dragIndex: -1,
      dragItem: null,
    })
    this._orderDirty = false
    if (!orderDirty || !names.length) return

    this._moving = true
    try {
      const tags = await store.setTagOrder(names)
      const next = this.decorate(tags)
      this.setData({
        items: next,
        filtered: this.applyFilter(next, this.data.query),
      })
    } catch (err) {
      wx.showToast({ title: err.message || '排序失败', icon: 'none' })
      this.reload('加载标签…')
    } finally {
      this._moving = false
    }
  },

  onDelete(e) {
    const tag = e.currentTarget.dataset.tag
    if (!tag || STATUS[tag] || this.data.loading || this.data.dragging) return
    wx.showModal({
      title: '删除标签',
      content: `确定删除「${tag}」？会从所有书上移除该标签。`,
      success: async (res) => {
        if (!res.confirm) return
        this.setData({ loading: true, loadingText: '删除中…' })
        try {
          const r = await store.deleteTag(tag)
          await this.reload('刷新标签…')
          wx.showToast({
            title: r.removedFromNovels ? `已从 ${r.removedFromNovels} 本移除` : '已删除',
            icon: 'none',
          })
        } catch (err) {
          this.setData({ loading: false })
          wx.showToast({ title: err.message || '失败', icon: 'none' })
        }
      },
    })
  },

  noop() {},
})
