/**
 * 界面主题：白天 / 黑夜 / 自定义（背景色、字体色、背景图）
 */

const LOCAL_KEY = 'novel-theme-v1'

const PRESETS = {
  day: {
    mode: 'day',
    label: '白天模式',
    bg: '#f6f4ef',
    ink: '#2a241c',
    muted: '#8a7f72',
    card: '#ffffff',
    teal: '#1f6f5c',
    mint: '#3fb6a0',
    line: '#e7e3d9',
    navFront: '#000000',
    bgImage: '',
    bgImageFileID: '',
    bgImageOpacity: 100,
  },
  night: {
    mode: 'night',
    label: '黑夜模式',
    bg: '#12141a',
    ink: '#edeff5',
    muted: '#9aa1b2',
    card: '#1c1f27',
    teal: '#5fd3b4',
    mint: '#5fd3b4',
    line: '#2c303b',
    navFront: '#ffffff',
    bgImage: '',
    bgImageFileID: '',
    bgImageOpacity: 100,
  },
}

const BG_SWATCHES = [
  '#f6f4ef',
  '#eef3f7',
  '#f7f3ea',
  '#f5f5f5',
  '#e8f0e8',
  '#121418',
  '#1a1a2e',
  '#1c1917',
]


const INK_SWATCHES = [
  '#2a241c',
  '#1f2937',
  '#111827',
  '#eef1f4',
  '#f8fafc',
  '#d6d3d1',
  '#a8a29e',
  '#94a3b8',
]

function hexToRgb(hex) {
  const h = String(hex || '').replace('#', '')
  if (h.length !== 6) return null
  const n = parseInt(h, 16)
  if (!Number.isFinite(n)) return null
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

function isDarkColor(hex) {
  const rgb = hexToRgb(hex)
  if (!rgb) return false
  const y = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255
  return y < 0.55
}

function normalizeHex(input, fallback) {
  var s = String(input || '').trim()
  if (!s) return fallback
  if (s.charAt(0) !== '#') s = '#' + s
  if (!/^#[0-9a-fA-F]{6}$/.test(s)) return fallback
  return s.toLowerCase()
}

/** 背景图透明度 10–100，默认 100 */
function clampBgImageOpacity(v, fallback) {
  var n = Number(v)
  if (!Number.isFinite(n)) n = fallback != null ? Number(fallback) : 100
  if (!Number.isFinite(n)) n = 100
  if (n < 10) n = 10
  if (n > 100) n = 100
  return Math.round(n)
}

function rgbaOfHex(hex, alpha) {
  const rgb = hexToRgb(hex) || { r: 246, g: 244, b: 239 }
  var a = Number(alpha)
  if (!Number.isFinite(a)) a = 0
  if (a < 0) a = 0
  if (a > 1) a = 1
  return 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + a + ')'
}

function buildCustom(partial) {
  const day = PRESETS.day
  const bg = normalizeHex(partial && partial.bg, day.bg)
  const ink = normalizeHex(partial && partial.ink, day.ink)
  const hasImage = !!(partial && (partial.bgImage || partial.bgImageFileID))
  // 有背景图时默认按深色底处理卡片对比度，字体仍尊重用户选择
  const dark = hasImage ? true : isDarkColor(bg)
  return {
    mode: 'custom',
    label: '自定义',
    bg: bg,
    ink: ink,
    muted: dark ? '#9aa3ad' : '#8a7f72',
    // 列表左滑按钮在卡片下方：卡片必须用不透明色，避免透出
    card: hasImage
      ? dark
        ? 'rgba(30, 36, 44, 0.92)'
        : 'rgba(255, 255, 255, 0.92)'
      : dark
        ? '#1e242c'
        : '#ffffff',
    teal: dark ? '#5fd3b4' : '#1f6f5c',
    mint: dark ? '#5fd3b4' : '#3fb6a0',
    line: dark ? '#2c303b' : '#e7e3d9',
    navFront: dark || isDarkColor(bg) ? '#ffffff' : '#000000',
    bgImage: (partial && partial.bgImage) || '',
    bgImageFileID: (partial && partial.bgImageFileID) || '',
    bgImageOpacity: clampBgImageOpacity(partial && partial.bgImageOpacity, 100),
  }
}

function normalizeTheme(raw) {
  if (!raw || typeof raw !== 'object') return Object.assign({}, PRESETS.day)
  if (raw.mode === 'night') return Object.assign({}, PRESETS.night)
  if (raw.mode === 'custom') return buildCustom(raw)
  return Object.assign({}, PRESETS.day)
}

function cssUrl(path) {
  const p = String(path || '').trim()
  if (!p) return ''
  // 内联样式里的 url 需要引号，并转义反斜杠/引号
  return '"' + p.replace(/\\/g, '/').replace(/"/g, '\\"') + '"'
}

function buildBgImageLayers(theme) {
  const t = normalizeTheme(theme)
  if (!t.bgImage) return ''
  const opacity = clampBgImageOpacity(t.bgImageOpacity, 100) / 100
  // 用背景色半透明层叠在图上，实现「降低背景图透明度」
  const veil = rgbaOfHex(t.bg, 1 - opacity)
  return (
    'linear-gradient(' +
    veil +
    ',' +
    veil +
    '),url(' +
    cssUrl(t.bgImage) +
    ')'
  )
}

function buildPageStyle(theme) {
  const t = normalizeTheme(theme)
  const parts = [
    '--bg:' + t.bg,
    '--ink:' + t.ink,
    '--muted:' + t.muted,
    '--card:' + t.card,
    '--teal:' + t.teal,
    '--mint:' + (t.mint || t.teal),
    '--line:' + t.line,
    'color:' + t.ink,
    'background-color:' + t.bg,
  ]
  if (t.bgImage) {
    parts.push('background-image:' + buildBgImageLayers(t))
    parts.push('background-size:cover')
    parts.push('background-position:center')
    parts.push('background-repeat:no-repeat')
    parts.push('background-attachment:fixed')
  } else {
    parts.push('background-image:none')
  }
  return parts.join(';')
}

function persistable(theme) {
  const t = normalizeTheme(theme)
  return {
    mode: t.mode,
    bg: t.bg,
    ink: t.ink,
    bgImage: t.bgImage || '',
    bgImageFileID: t.bgImageFileID || '',
    bgImageOpacity: clampBgImageOpacity(t.bgImageOpacity, 100),
  }
}

function readLocal() {
  try {
    const raw = wx.getStorageSync(LOCAL_KEY)
    if (raw && typeof raw === 'object') return normalizeTheme(raw)
  } catch (e) {
    /* ignore */
  }
  return Object.assign({}, PRESETS.day)
}

function writeLocal(theme) {
  try {
    wx.setStorageSync(LOCAL_KEY, persistable(theme))
  } catch (e) {
    /* ignore */
  }
}

function applyChrome(theme) {
  const t = normalizeTheme(theme)
  try {
    wx.setNavigationBarColor({
      frontColor: t.navFront,
      backgroundColor: t.bg,
      animation: { duration: 0, timingFunc: 'linear' },
    })
  } catch (e) {
    /* ignore */
  }
  try {
    wx.setBackgroundColor({
      backgroundColor: t.bg,
      backgroundColorTop: t.bg,
      backgroundColorBottom: t.bg,
    })
  } catch (e) {
    /* ignore */
  }
}

/** 当前内存主题（启动时先读本地） */
let activeTheme = readLocal()

function getActiveTheme() {
  return normalizeTheme(activeTheme)
}

function setActiveTheme(theme) {
  activeTheme = normalizeTheme(theme)
  writeLocal(activeTheme)
  applyChrome(activeTheme)
  return activeTheme
}

/**
 * 把云 fileID 解析成可展示的临时链接（保留本地路径作 fallback）
 */
function resolveThemeForDisplay(theme) {
  const t = normalizeTheme(theme)
  if (!t.bgImageFileID) {
    return Promise.resolve(t)
  }
  if (!wx.cloud || !wx.cloud.getTempFileURL) {
    return Promise.resolve(t)
  }
  return wx.cloud
    .getTempFileURL({ fileList: [t.bgImageFileID] })
    .then(function (res) {
      const item = res.fileList && res.fileList[0]
      const url = item && (item.tempFileURL || item.download_url)
      if (url) t.bgImage = url
      return t
    })
    .catch(function () {
      return t
    })
}

function getPresets() {
  return {
    day: Object.assign({}, PRESETS.day),
    night: Object.assign({}, PRESETS.night),
  }
}

module.exports = {
  PRESETS: PRESETS,
  BG_SWATCHES: BG_SWATCHES,
  INK_SWATCHES: INK_SWATCHES,
  normalizeTheme: normalizeTheme,
  buildCustom: buildCustom,
  buildPageStyle: buildPageStyle,
  buildBgImageLayers: buildBgImageLayers,
  clampBgImageOpacity: clampBgImageOpacity,
  persistable: persistable,
  getActiveTheme: getActiveTheme,
  setActiveTheme: setActiveTheme,
  applyChrome: applyChrome,
  resolveThemeForDisplay: resolveThemeForDisplay,
  getPresets: getPresets,
  readLocal: readLocal,
  isDarkColor: isDarkColor,
  normalizeHex: normalizeHex,
}
