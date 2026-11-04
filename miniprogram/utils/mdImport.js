/**
 * 解析网页版「导出 MD / beifen.md」格式
 * ## 书名 / 作者： / 标签： / 简介
 */
function parseWishlistMarkdown(md) {
  const text = String(md || '').replace(/^\uFEFF/, '').trim()
  if (!text) return []

  const chunks = text.split(/\n\s*---\s*\n/)
  const out = []

  for (const chunk of chunks) {
    const lines = chunk.split(/\r?\n/).map((l) => l.trimEnd())
    let title = ''
    let author = ''
    let tags = []
    let review = ''
    const synopsisLines = []

    for (const raw of lines) {
      const line = raw.trim()
      if (!line) {
        if (title) synopsisLines.push('')
        continue
      }
      const titleMatch = line.match(/^##\s+(.+)$/)
      if (titleMatch && !title) {
        title = titleMatch[1].trim()
        continue
      }
      const authorMatch = line.match(/^作者[：:]\s*(.+)$/)
      if (authorMatch) {
        author = authorMatch[1].trim()
        continue
      }
      const tagMatch = line.match(/^标签[：:]\s*(.+)$/)
      if (tagMatch) {
        tags = tagMatch[1]
          .split(/[,，、]/)
          .map((t) => t.trim())
          .filter(Boolean)
        continue
      }
      const reviewMatch = line.match(/^短评[：:]\s*(.+)$/)
      if (reviewMatch) {
        review = reviewMatch[1].trim()
        continue
      }
      if (title) synopsisLines.push(line)
    }

    if (!title) continue
    if (!tags.length) tags = ['未读']
    out.push({
      title,
      author,
      synopsis: synopsisLines.join('\n').trim(),
      review,
      tags,
    })
  }

  return out
}

module.exports = {
  parseWishlistMarkdown,
}
