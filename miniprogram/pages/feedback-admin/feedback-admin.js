var themeBehavior = require('../../behaviors/themeBehavior.js')

Page({
  behaviors: [themeBehavior],

  data: {
    loading: true,
    loadingText: '加载反馈…',
    status: 'open',
    list: [],
    denied: false,
  },

  onShow: function () {
    this.loadList()
  },

  onStatusTab: function (e) {
    var status = e.currentTarget.dataset.status
    if (!status || status === this.data.status) return
    this.setData({ status: status })
    this.loadList()
  },

  loadList: function () {
    var that = this
    this.setData({
      loading: true,
      loadingText: '加载反馈…',
      denied: false,
    })
    wx.cloud
      .callFunction({
        name: 'adminApi',
        data: {
          action: 'listFeedback',
          status: this.data.status,
          limit: 50,
        },
      })
      .then(function (res) {
        var result = (res && res.result) || {}
        if (result.errCode === 'NOT_ADMIN' || result.errMsg === '无管理员权限') {
          that.setData({
            loading: false,
            denied: true,
            list: [],
          })
          return
        }
        if (!result.ok) {
          that.setData({ loading: false, list: [] })
          wx.showToast({ title: result.errMsg || '加载失败', icon: 'none' })
          return
        }
        that.setData({
          loading: false,
          denied: false,
          list: result.list || [],
        })
      })
      .catch(function (err) {
        that.setData({ loading: false, list: [] })
        wx.showToast({
          title: (err && err.message) || '加载失败',
          icon: 'none',
        })
      })
  },

  markDone: function (e) {
    this.updateStatus(e.currentTarget.dataset.id, 'done')
  },

  markOpen: function (e) {
    this.updateStatus(e.currentTarget.dataset.id, 'open')
  },

  updateStatus: function (id, status) {
    var that = this
    if (!id) return
    wx.showLoading({ title: '更新中…', mask: true })
    wx.cloud
      .callFunction({
        name: 'adminApi',
        data: {
          action: 'updateFeedback',
          id: id,
          status: status,
        },
      })
      .then(function (res) {
        wx.hideLoading()
        var result = (res && res.result) || {}
        if (!result.ok) {
          wx.showToast({ title: result.errMsg || '更新失败', icon: 'none' })
          return
        }
        that.loadList()
      })
      .catch(function (err) {
        wx.hideLoading()
        wx.showToast({
          title: (err && err.message) || '更新失败',
          icon: 'none',
        })
      })
  },
})
