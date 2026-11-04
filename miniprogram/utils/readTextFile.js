/** 读取本地文本文件：兼容 UTF-8 / UTF-16 / GBK，规避部分机型 utf8 读空 */

var GBK = require('./gbk.js')

function toUint8(data) {
  if (!data) return new Uint8Array(0)
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (typeof data === 'string') {
    // encoding: 'binary' 得到的是按字节展开的字符串
    var u8 = new Uint8Array(data.length)
    for (var i = 0; i < data.length; i++) u8[i] = data.charCodeAt(i) & 0xff
    return u8
  }
  return new Uint8Array(0)
}

function readBytes(filePath) {
  var fs = wx.getFileSystemManager()
  // 部分基础库不传 encoding 会得到空 ArrayBuffer，优先 binary
  try {
    var bin = fs.readFileSync(filePath, 'binary')
    var fromBin = toUint8(bin)
    if (fromBin.length) return fromBin
  } catch (e) {
    /* fall through */
  }
  try {
    var buf = fs.readFileSync(filePath)
    var fromBuf = toUint8(buf)
    if (fromBuf.length) return fromBuf
  } catch (e2) {
    /* fall through */
  }
  try {
    var utf = fs.readFileSync(filePath, 'utf8')
    if (typeof utf === 'string' && utf.length) {
      // 已是字符串时再转回字节意义不大，直接包一层标记
      return { __text: utf }
    }
  } catch (e3) {
    /* ignore */
  }
  return new Uint8Array(0)
}

function decodeUtf8(u8) {
  if (typeof TextDecoder !== 'undefined') {
    try {
      return new TextDecoder('utf-8').decode(u8)
    } catch (e) {
      /* fall through */
    }
  }
  var out = ''
  var i = 0
  while (i < u8.length) {
    var c = u8[i++]
    if (c < 0x80) {
      out += String.fromCharCode(c)
    } else if ((c & 0xe0) === 0xc0 && i < u8.length) {
      var c2 = u8[i++]
      out += String.fromCharCode(((c & 0x1f) << 6) | (c2 & 0x3f))
    } else if ((c & 0xf0) === 0xe0 && i + 1 < u8.length) {
      var d2 = u8[i++]
      var d3 = u8[i++]
      out += String.fromCharCode(((c & 0x0f) << 12) | ((d2 & 0x3f) << 6) | (d3 & 0x3f))
    } else if ((c & 0xf8) === 0xf0 && i + 2 < u8.length) {
      var e2 = u8[i++]
      var e3 = u8[i++]
      var e4 = u8[i++]
      var cp =
        ((c & 0x07) << 18) | ((e2 & 0x3f) << 12) | ((e3 & 0x3f) << 6) | (e4 & 0x3f)
      cp -= 0x10000
      out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff))
    } else {
      out += '\ufffd'
    }
  }
  return out
}

function decodeUtf16LE(u8, offset) {
  offset = offset || 0
  var out = ''
  for (var i = offset; i + 1 < u8.length; i += 2) {
    out += String.fromCharCode(u8[i] | (u8[i + 1] << 8))
  }
  return out
}

function decodeUtf16BE(u8, offset) {
  offset = offset || 0
  var out = ''
  for (var i = offset; i + 1 < u8.length; i += 2) {
    out += String.fromCharCode((u8[i] << 8) | u8[i + 1])
  }
  return out
}

function replacementRatio(str) {
  if (!str || !str.length) return 1
  var bad = 0
  var sample = Math.min(str.length, 4000)
  for (var i = 0; i < sample; i++) {
    if (str.charCodeAt(i) === 0xfffd) bad += 1
  }
  return bad / sample
}

function looksMostlyBinary(str) {
  if (!str || !str.length) return true
  var ctrl = 0
  var sample = Math.min(str.length, 2000)
  for (var i = 0; i < sample; i++) {
    var c = str.charCodeAt(i)
    if (c === 0 || (c < 32 && c !== 9 && c !== 10 && c !== 13)) ctrl += 1
  }
  return ctrl / sample > 0.08
}

function utf8InvalidRatio(u8) {
  if (!u8 || !u8.length) return 1
  var i = 0
  var bad = 0
  var total = 0
  var limit = Math.min(u8.length, 8000)
  while (i < limit) {
    total += 1
    var c = u8[i]
    if (c < 0x80) {
      i += 1
      continue
    }
    if ((c & 0xe0) === 0xc0 && i + 1 < u8.length && (u8[i + 1] & 0xc0) === 0x80) {
      i += 2
      continue
    }
    if (
      (c & 0xf0) === 0xe0 &&
      i + 2 < u8.length &&
      (u8[i + 1] & 0xc0) === 0x80 &&
      (u8[i + 2] & 0xc0) === 0x80
    ) {
      i += 3
      continue
    }
    if (
      (c & 0xf8) === 0xf0 &&
      i + 3 < u8.length &&
      (u8[i + 1] & 0xc0) === 0x80 &&
      (u8[i + 2] & 0xc0) === 0x80 &&
      (u8[i + 3] & 0xc0) === 0x80
    ) {
      i += 4
      continue
    }
    bad += 1
    i += 1
  }
  return total ? bad / total : 1
}

function decodeBytes(u8) {
  if (u8 && u8.__text) return String(u8.__text)
  if (!u8 || !u8.length) return ''

  // BOM
  if (u8.length >= 3 && u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) {
    return decodeUtf8(u8.subarray(3)).replace(/^\ufeff/, '')
  }
  if (u8.length >= 2 && u8[0] === 0xff && u8[1] === 0xfe) {
    return decodeUtf16LE(u8, 2)
  }
  if (u8.length >= 2 && u8[0] === 0xfe && u8[1] === 0xff) {
    return decodeUtf16BE(u8, 2)
  }

  var invalidUtf8 = utf8InvalidRatio(u8)
  var utf8 = decodeUtf8(u8).replace(/^\ufeff/, '')
  var utf8Bad =
    invalidUtf8 > 0.01 ||
    !utf8 ||
    replacementRatio(utf8) > 0.02 ||
    looksMostlyBinary(utf8)

  var gbk = ''
  try {
    gbk = GBK.decode(u8)
  } catch (e) {
    gbk = ''
  }
  var gbkBad = !gbk || replacementRatio(gbk) > 0.15 || looksMostlyBinary(gbk)

  // 非空缓冲但 UTF-8 无效/空：优先 GBK（国内 txt 常见）
  if (utf8Bad && gbk && !gbkBad) return gbk
  if (utf8 && !utf8Bad) return utf8
  if (gbk) return gbk
  return utf8 || ''
}

function readTextFile(filePath) {
  var bytes = readBytes(filePath)
  var text = decodeBytes(bytes)
  return String(text || '')
}

module.exports = {
  readTextFile: readTextFile,
  decodeBytes: decodeBytes,
}
