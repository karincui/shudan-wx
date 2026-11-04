/** 管理员 OpenID 白名单（与云函数 adminApi 保持一致，仅用于前端入口显示） */
var ADMIN_OPENIDS = ['octq45avpkz0W3UasHYrmLLcdiLU']

function isAdminOpenId(openid) {
  var id = String(openid || '').trim()
  if (!id) return false
  return ADMIN_OPENIDS.indexOf(id) >= 0
}

module.exports = {
  ADMIN_OPENIDS: ADMIN_OPENIDS,
  isAdminOpenId: isAdminOpenId,
}
