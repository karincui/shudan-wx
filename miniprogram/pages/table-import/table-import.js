const store = require('../../utils/store')
const { parseTableText } = require('../../utils/csvImport')

var rowKey = 1

function emptyRow() {
  return {
    key: 'r' + rowKey++,
    title: '',
    author: '',
    synopsis: '',
    tags: ['未读'],
    tagsText: '未读',
  }
}

function makeRows(n) {
  var list = []
  for (var i = 0; i < n; i++) list.push(emptyRow())
  return list
}

function countFilled(rows) {
  var n = 0
  ;(rows || []).forEach(function (r) {
    if (r && String(r.title || '').trim()) n += 1
  })
  return n
}

function tagsToText(tags) {
  var list = tags && tags.length ? tags : ['未读']
  return list.join('、')
}

function normalizeTags(tags) {
  var list = []
  var seen = {}
  ;(tags || []).forEach(function (t) {
    var name = String(t || '').trim()
    if (!name || seen[name]) return
    seen[name] = true
    list.push(name)
  })
  if (!list.includes('已读') && !list.includes('未读')) list.unshift('未读')
  if (list.includes('已读') && list.includes('未读')) {
    list = list.filter(function (t) {
      return t !== '未读'
    })
  }
  return list
}

function toMap(tags) {
  var map = {}
  ;(tags || []).forEach(function (t) {
    map[t] = true
  })
  return map
}

function rowsToNovels(rows) {
  var out = []
  ;(rows || []).forEach(function (r) {
    var title = String((r && r.title) || '').trim()
    if (!title) return
    out.push({
      title: title,
      author: String((r && r.author) || '').trim(),
      synopsis: String((r && r.synopsis) || '').trim(),
      tags: normalizeTags(r.tags),
    })
  })
  return out
}

function novelsToGrid(novels) {
  return (novels || []).map(function (n) {
    var tags = normalizeTags(n.tags)
    return {
      key: 'r' + rowKey++,
      title: n.title || '',
      author: n.author || '',
      synopsis: n.synopsis || '',
      tags: tags,
      tagsText: tagsToText(tags),
    }
  })
}

const themeBehavior = require('../../behaviors/themeBehavior')

Page({
  behaviors: [themeBehavior],

  data: {
    rows: makeRows(12),
    filledCount: 0,
    importing: false,
    allTags: ['未读', '已读'],
    tagPickerOpen: false,
    tagPickerIndex: -1,
    tagPickerMap: {},
    pickerNewTag: '',
  },

  noop: function () {},

  onShow: function () {
    var that = this
    store
      .getAllTags()
      .then(function (tags) {
        var all = tags && tags.length ? tags.slice() : ['未读', '已读']
        ;['未读', '已读'].forEach(function (t) {
          if (all.indexOf(t) < 0) all.push(t)
        })
        that.setData({ allTags: all })
      })
      .catch(function () {})
  },

  syncCount: function (rows) {
    this.setData({
      rows: rows,
      filledCount: countFilled(rows),
    })
  },

  onCellInput: function (e) {
    var index = Number(e.currentTarget.dataset.index)
    var field = e.currentTarget.dataset.field
    var value = (e.detail && e.detail.value) || ''
    var key = 'rows[' + index + '].' + field
    var patch = {}
    patch[key] = value
    this.setData(patch)
    this.setData({ filledCount: countFilled(this.data.rows) })
  },

  openTagPicker: function (e) {
    var index = Number(e.currentTarget.dataset.index)
    var row = (this.data.rows || [])[index]
    if (!row) return
    var tags = normalizeTags(row.tags)
    var allTags = (this.data.allTags || []).slice()
    tags.forEach(function (t) {
      if (allTags.indexOf(t) < 0) allTags.push(t)
    })
    this.setData({
      allTags: allTags,
      tagPickerOpen: true,
      tagPickerIndex: index,
      tagPickerMap: toMap(tags),
    })
  },

  closeTagPicker: function () {
    var index = this.data.tagPickerIndex
    var map = this.data.tagPickerMap || {}
    var tags = []
    Object.keys(map).forEach(function (k) {
      if (map[k]) tags.push(k)
    })
    tags = normalizeTags(tags)
    if (index >= 0) {
      var patch = {}
      patch['rows[' + index + '].tags'] = tags
      patch['rows[' + index + '].tagsText'] = tagsToText(tags)
      patch.tagPickerOpen = false
      patch.tagPickerIndex = -1
      patch.tagPickerMap = {}
      patch.pickerNewTag = ''
      this.setData(patch)
    } else {
      this.setData({
        tagPickerOpen: false,
        tagPickerIndex: -1,
        tagPickerMap: {},
        pickerNewTag: '',
      })
    }
  },

  togglePickerTag: function (e) {
    var tag = e.currentTarget.dataset.tag
    if (!tag) return
    var map = Object.assign({}, this.data.tagPickerMap || {})
    var tags = []
    Object.keys(map).forEach(function (k) {
      if (map[k]) tags.push(k)
    })

    if (tag === '已读' || tag === '未读') {
      tags = tags.filter(function (t) {
        return t !== '已读' && t !== '未读'
      })
      tags.unshift(tag)
    } else if (tags.indexOf(tag) >= 0) {
      tags = tags.filter(function (t) {
        return t !== tag
      })
    } else {
      tags.push(tag)
    }
    tags = normalizeTags(tags)
    this.setData({ tagPickerMap: toMap(tags) })
  },

  onPickerNewTag: function (e) {
    this.setData({ pickerNewTag: (e.detail && e.detail.value) || '' })
  },

  addPickerTag: function () {
    var that = this
    var t = String(that.data.pickerNewTag || '').trim()
    if (!t) return
    if (t === '未读' || t === '已读') {
      wx.showToast({ title: '请直接点选状态标签', icon: 'none' })
      return
    }
    store
      .addCustomTag(t)
      .then(function (all) {
        var map = Object.assign({}, that.data.tagPickerMap || {})
        map[t] = true
        var tags = []
        Object.keys(map).forEach(function (k) {
          if (map[k]) tags.push(k)
        })
        tags = normalizeTags(tags)
        var allTags = all && all.length ? all.slice() : that.data.allTags.slice()
        if (allTags.indexOf(t) < 0) allTags.push(t)
        that.setData({
          pickerNewTag: '',
          allTags: allTags,
          tagPickerMap: toMap(tags),
        })
        wx.showToast({ title: '已添加', icon: 'none' })
      })
      .catch(function (err) {
        wx.showToast({ title: (err && err.message) || '添加失败', icon: 'none' })
      })
  },

  addRows: function () {
    this.syncCount((this.data.rows || []).concat(makeRows(5)))
  },

  removeRow: function (e) {
    var index = Number(e.currentTarget.dataset.index)
    var rows = (this.data.rows || []).slice()
    if (rows.length <= 1) rows = makeRows(1)
    else rows.splice(index, 1)
    this.syncCount(rows)
  },

  onClear: function () {
    var that = this
    wx.showModal({
      title: '清空表格',
      content: '确定清空所有格子吗？',
      success: function (res) {
        if (!res.confirm) return
        that.syncCount(makeRows(12))
      },
    })
  },

  onTemplate: function () {
    var csv =
      '书名,作者,简介,标签\n示例书名,作者名,一句话简介,未读、甜宠\n另一本,,,未读'
    wx.setClipboardData({
      data: csv,
      success: function () {
        wx.showToast({ title: '模板已复制到剪贴板', icon: 'none', duration: 2200 })
      },
    })
  },

  onPaste: function () {
    var that = this
    wx.getClipboardData({
      success: function (res) {
        var text = (res && res.data) || ''
        var novels = parseTableText(text)
        if (!novels.length) {
          wx.showToast({ title: '剪贴板里没有可识别的表格', icon: 'none' })
          return
        }
        var grid = novelsToGrid(novels)
        while (grid.length < 5) grid.push(emptyRow())
        that.syncCount(grid)
        wx.showToast({ title: '已粘贴 ' + novels.length + ' 行', icon: 'none' })
      },
      fail: function () {
        wx.showToast({ title: '读剪贴板失败', icon: 'none' })
      },
    })
  },

  async uploadTempFile(filePath, cloudPath) {
    var up = await wx.cloud.uploadFile({
      cloudPath: cloudPath,
      filePath: filePath,
    })
    if (!up.fileID) throw new Error('上传失败')
    return up.fileID
  },

  onUpload: function () {
    var that = this
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['csv', 'txt', 'xlsx', 'xls'],
      success: async function (res) {
        var file = res.tempFiles && res.tempFiles[0]
        if (!file) return
        var name = file.name || 'table.csv'
        var lower = name.toLowerCase()
        try {
          if (/\.(csv|txt)$/.test(lower)) {
            wx.getFileSystemManager().readFile({
              filePath: file.path,
              encoding: 'utf8',
              success: function (r) {
                var novels = parseTableText(String(r.data || ''))
                if (!novels.length) {
                  wx.showToast({ title: '没有解析出书目', icon: 'none' })
                  return
                }
                var grid = novelsToGrid(novels)
                while (grid.length < 5) grid.push(emptyRow())
                that.syncCount(grid)
              },
              fail: function () {
                wx.showToast({ title: '读取失败', icon: 'none' })
              },
            })
            return
          }

          wx.showLoading({ title: '解析 Excel…', mask: true })
          var fileID = await that.uploadTempFile(
            file.path,
            'import-temp/' + Date.now() + '-' + name,
          )
          var cf = await wx.cloud.callFunction({
            name: 'parseTableFile',
            data: { fileID: fileID, fileName: name },
          })
          wx.hideLoading()
          var result = (cf && cf.result) || {}
          if (!result.ok) {
            wx.showToast({
              title: result.errMsg || '解析失败',
              icon: 'none',
              duration: 3000,
            })
            return
          }
          var novels = result.rows || []
          if (!novels.length) {
            wx.showToast({ title: '没有解析出书目', icon: 'none' })
            return
          }
          var grid = novelsToGrid(novels)
          while (grid.length < 5) grid.push(emptyRow())
          that.syncCount(grid)
        } catch (err) {
          wx.hideLoading()
          wx.showToast({
            title: (err && err.message) || '上传失败',
            icon: 'none',
          })
        }
      },
    })
  },

  onImportAll: function () {
    var that = this
    if (that.data.importing) return
    var novels = rowsToNovels(that.data.rows)
    if (!novels.length) {
      wx.showToast({ title: '请先填写书名', icon: 'none' })
      return
    }
    wx.showModal({
      title: '全部入库',
      content: '将导入 ' + novels.length + ' 本到云端（已有的会跳过）',
      success: function (res) {
        if (!res.confirm) return
        that.setData({ importing: true })
        wx.showLoading({ title: '入库中…', mask: true })
        store
          .importNovels(novels)
          .then(function (result) {
            wx.hideLoading()
            that.setData({ importing: false })
            wx.showToast({
              title: '新增 ' + result.added + '，跳过 ' + result.skipped,
              icon: 'none',
              duration: 2500,
            })
          })
          .catch(function (err) {
            wx.hideLoading()
            that.setData({ importing: false })
            wx.showToast({ title: (err && err.message) || '入库失败', icon: 'none' })
          })
      },
    })
  },
})
