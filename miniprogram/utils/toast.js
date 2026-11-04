/**
 * 统一自定义 Toast / Loading。app.js 会劫持
 * wx.showToast / wx.hideToast / wx.showLoading / wx.hideLoading。
 * 页面根节点需放置：<mint-toast id="mintToast" />
 */

function resolvePage() {
  try {
    var pages = getCurrentPages()
    if (!pages || !pages.length) return null
    return pages[pages.length - 1]
  } catch (e) {
    return null
  }
}

function resolveToast(page) {
  if (!page || typeof page.selectComponent !== 'function') return null
  return page.selectComponent('#mintToast')
}

function show(options) {
  var opts = options
  if (typeof options === 'string') {
    opts = { title: options }
  }
  opts = opts || {}

  var title = opts.title != null ? String(opts.title) : ''
  var icon = opts.icon || 'none'
  var duration = opts.duration || 2000
  var type = icon === 'success' ? 'success' : icon === 'loading' ? 'loading' : 'none'

  var page = resolvePage()
  var comp = resolveToast(page)
  if (comp && typeof comp.show === 'function') {
    var main = title
    var sub = opts.sub || ''
    if (type === 'success' && !sub) {
      if (title === '已提交，谢谢反馈') {
        main = '已提交'
        sub = '谢谢你的反馈'
      } else if (title.indexOf('，') > 0 && title.length > 8) {
        var parts = title.split('，')
        main = parts[0]
        sub = parts.slice(1).join('，')
      }
    }
    comp.show({
      type: type,
      title: main,
      sub: sub,
      duration: type === 'loading' ? 0 : duration,
      mask: opts.mask !== false,
    })
    if (typeof opts.success === 'function') {
      try {
        opts.success({ errMsg: 'showToast:ok' })
      } catch (e) {
        /* ignore */
      }
    }
    if (typeof opts.complete === 'function') {
      try {
        opts.complete({ errMsg: 'showToast:ok' })
      } catch (e) {
        /* ignore */
      }
    }
    return
  }

  if (typeof wx.__rawShowToast === 'function') {
    return wx.__rawShowToast.call(wx, opts)
  }
}

function hide() {
  var page = resolvePage()
  var comp = resolveToast(page)
  if (comp && typeof comp.hide === 'function') {
    comp.hide()
    return
  }
  if (typeof wx.__rawHideToast === 'function') {
    return wx.__rawHideToast.call(wx)
  }
}

function showLoading(options) {
  var opts = options
  if (typeof options === 'string') {
    opts = { title: options }
  }
  opts = opts || {}
  var title = opts.title != null ? String(opts.title) : '加载中…'
  var page = resolvePage()
  var comp = resolveToast(page)
  if (comp && typeof comp.show === 'function') {
    comp.show({
      type: 'loading',
      title: title,
      duration: 0,
      mask: opts.mask !== false,
    })
    if (typeof opts.success === 'function') {
      try {
        opts.success({ errMsg: 'showLoading:ok' })
      } catch (e) {
        /* ignore */
      }
    }
    if (typeof opts.complete === 'function') {
      try {
        opts.complete({ errMsg: 'showLoading:ok' })
      } catch (e) {
        /* ignore */
      }
    }
    return
  }
  if (typeof wx.__rawShowLoading === 'function') {
    return wx.__rawShowLoading.call(wx, opts)
  }
}

function hideLoading() {
  var page = resolvePage()
  var comp = resolveToast(page)
  if (comp && typeof comp.hide === 'function' && comp.data && comp.data.type === 'loading') {
    comp.hide()
    return
  }
  if (typeof wx.__rawHideLoading === 'function') {
    return wx.__rawHideLoading.call(wx)
  }
}

function install() {
  if (wx.__mintToastInstalled) return
  wx.__mintToastInstalled = true
  wx.__rawShowToast = wx.showToast.bind(wx)
  wx.__rawHideToast = wx.hideToast.bind(wx)
  wx.__rawShowLoading = wx.showLoading.bind(wx)
  wx.__rawHideLoading = wx.hideLoading.bind(wx)
  wx.showToast = show
  wx.hideToast = hide
  wx.showLoading = showLoading
  wx.hideLoading = hideLoading
}

module.exports = {
  show: show,
  hide: hide,
  showLoading: showLoading,
  hideLoading: hideLoading,
  install: install,
}
