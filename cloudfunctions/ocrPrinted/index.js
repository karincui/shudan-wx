const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event) => {
  const fileID = event && event.fileID
  if (!fileID) {
    return { ok: false, errMsg: '缺少图片 fileID' }
  }
  try {
    const dl = await cloud.downloadFile({ fileID })
    const buffer = dl.fileContent
    if (!buffer || !buffer.length) {
      return { ok: false, errMsg: '图片为空' }
    }
    if (buffer.length > 2 * 1024 * 1024) {
      return { ok: false, errMsg: '图片需小于 2MB' }
    }
    const name = String(fileID).toLowerCase()
    let contentType = 'image/jpeg'
    if (name.indexOf('.png') >= 0) contentType = 'image/png'
    else if (name.indexOf('.webp') >= 0) contentType = 'image/webp'
    else if (name.indexOf('.gif') >= 0) contentType = 'image/gif'

    const result = await cloud.openapi.ocr.printedText({
      img: {
        contentType: contentType,
        value: buffer,
      },
    })
    const items = (result && result.items) || []
    return {
      ok: true,
      items: items,
      texts: items.map(function (it) {
        return (it && it.text) || ''
      }).filter(Boolean),
    }
  } catch (err) {
    return {
      ok: false,
      errMsg: (err && (err.errMsg || err.message)) || 'OCR 识别失败',
      errCode: err && err.errCode,
    }
  }
}
