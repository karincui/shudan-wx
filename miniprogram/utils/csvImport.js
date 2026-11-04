/** 简单 CSV / 制表符表格导入：书名,作者,简介,标签 */

function parseCsvLine(line) {
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
  return out.map((s) => s.trim())
}

function parseTableText(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '').trim()
  if (!raw) return []
  const lines = raw.split(/\r?\n/).filter((l) => l.trim())
  if (!lines.length) return []

  let start = 0
  const first = parseCsvLine(lines[0]).map((x) => x.toLowerCase())
  if (first.some((c) => c.includes('书名') || c === 'title')) start = 1

  const rows = []
  for (let i = start; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i])
    const title = (cols[0] || '').trim()
    if (!title) continue
    const tagsRaw = cols[3] || ''
    const tags = tagsRaw
      ? tagsRaw.split(/[,，、|/]/).map((t) => t.trim()).filter(Boolean)
      : ['未读']
    rows.push({
      title,
      author: (cols[1] || '').trim(),
      synopsis: (cols[2] || '').trim(),
      tags,
    })
  }
  return rows
}

module.exports = { parseTableText }
