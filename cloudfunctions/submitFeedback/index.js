const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const content = String((event && event.content) || '').trim()
  const contact = String((event && event.contact) || '').trim()

  if (!content) {
    return { ok: false, errMsg: '请填写反馈内容' }
  }
  if (content.length > 2000) {
    return { ok: false, errMsg: '内容请控制在 2000 字内' }
  }
  if (contact.length > 80) {
    return { ok: false, errMsg: '联系方式过长' }
  }

  const db = cloud.database()
  const now = Date.now()
  const doc = {
    content: content,
    contact: contact,
    status: 'open',
    createdAt: now,
    updatedAt: now,
    // 云函数写入也会带上调用方 openid；额外存一份便于控制台查看
    openid: wxContext.OPENID || '',
    appid: wxContext.APPID || '',
  }

  try {
    const addRes = await db.collection('feedback').add({ data: doc })
    return {
      ok: true,
      id: addRes._id,
    }
  } catch (err) {
    const msg = (err && (err.errMsg || err.message)) || String(err)
    // 集合不存在时提示去控制台创建
    if (/not exist|不存在|COLLECTION_NOT_EXIST|-502005/i.test(msg)) {
      return {
        ok: false,
        errMsg: '请先在云开发控制台创建 feedback 集合',
      }
    }
    return {
      ok: false,
      errMsg: msg || '提交失败',
    }
  }
}
