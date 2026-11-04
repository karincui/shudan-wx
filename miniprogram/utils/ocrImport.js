/** 把 OCR 行文本整理成书目 */

var NOISE = /^(未读|已读|很想看|不喜欢|我不喜欢|标签|作者|简介|书名|分享|搜索|编辑|删除|确定|取消|\d+\/\d+)$/

function parseOcrTexts(texts) {
  var list = (texts || [])
    .map(function (t) {
      return String(t || '').replace(/\s+/g, ' ').trim()
    })
    .filter(function (t) {
      if (!t || t.length < 2 || t.length > 60) return false
      if (NOISE.test(t)) return false
      if (/^[\d.\s]+$/.test(t)) return false
      return true
    })

  var rows = []
  var seen = {}
  for (var i = 0; i < list.length; i++) {
    var title = list[i]
    var key = title.toLowerCase()
    if (seen[key]) continue
    seen[key] = true
    rows.push({
      title: title,
      author: '',
      synopsis: '',
      tags: ['未读'],
    })
  }
  return rows
}

module.exports = {
  parseOcrTexts: parseOcrTexts,
}
