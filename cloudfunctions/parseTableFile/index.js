const cloud = require('wx-server-sdk')
const XLSX = require('xlsx')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

function looksLikeHeader(cols) {
  const joined = cols
    .map(function (c) {
      return String(c || '').toLowerCase()
    })
    .join('|')
  return /书名|title|作品|小说名/.test(joined)
}

function rowFromCols(cols) {
  const title = String((cols && cols[0]) || '').trim()
  if (!title) return null
  const tagsRaw = String((cols && cols[3]) || '').trim()
  const tags = tagsRaw
    ? tagsRaw.split(/[,，、|/]/).map(function (t) {
        return t.trim()
      }).filter(Boolean)
    : ['未读']
  return {
    title: title,
    author: String((cols && cols[1]) || '').trim(),
    synopsis: String((cols && cols[2]) || '').trim(),
    tags: tags,
  }
}

function parseSheetMatrix(matrix) {
  const rows = []
  if (!matrix || !matrix.length) return rows
  let start = 0
  if (looksLikeHeader(matrix[0] || [])) start = 1
  for (let i = start; i < matrix.length; i++) {
    const item = rowFromCols(matrix[i] || [])
    if (item) rows.push(item)
  }
  return rows
}

function parseCsvText(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '').trim()
  if (!raw) return []
  const lines = raw.split(/\r?\n/).filter(function (l) {
    return l.trim()
  })
  const matrix = lines.map(function (line) {
    const out = []
    let cur = ''
    let inQuote = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (inQuote) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            cur += '"'
            i += 1
          } else inQuote = false
        } else cur += ch
      } else if (ch === '"') {
        inQuote = true
      } else if (ch === ',' || ch === '\t') {
        out.push(cur)
        cur = ''
      } else cur += ch
    }
    out.push(cur)
    return out.map(function (s) {
      return String(s || '').trim()
    })
  })
  return parseSheetMatrix(matrix)
}

exports.main = async (event) => {
  const fileID = event && event.fileID
  const fileName = String((event && event.fileName) || '').toLowerCase()
  if (!fileID) {
    return { ok: false, errMsg: '缺少文件 fileID' }
  }
  try {
    const dl = await cloud.downloadFile({ fileID })
    const buffer = dl.fileContent
    if (!buffer || !buffer.length) {
      return { ok: false, errMsg: '文件为空' }
    }

    let rows = []
    if (/\.xlsx?$/.test(fileName) || /\.xlsx?$/.test(String(fileID).toLowerCase())) {
      const wb = XLSX.read(buffer, { type: 'buffer' })
      const sheetName = wb.SheetNames[0]
      const sheet = wb.Sheets[sheetName]
      const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
      rows = parseSheetMatrix(matrix)
    } else {
      const text = Buffer.from(buffer).toString('utf8')
      rows = parseCsvText(text)
    }

    return { ok: true, rows: rows, count: rows.length }
  } catch (err) {
    return {
      ok: false,
      errMsg: (err && (err.message || err.errMsg)) || '表格解析失败',
    }
  }
}
