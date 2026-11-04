const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

/**
 * 管理员 openid 白名单来源（合并去重）：
 * 1. 下方 DEFAULT_ADMIN_OPENIDS
 * 2. 云函数环境变量 ADMIN_OPENIDS（逗号分隔）
 * 3. 数据库 app_config 文档 admins：{ openIds: ['oXXX', ...] }
 */

// 与 miniprogram/utils/admin.js 保持一致
var DEFAULT_ADMIN_OPENIDS = ['octq45avpkz0W3UasHYrmLLcdiLU']

function uniqIds(list) {
  var seen = {}
  var out = []
  ;(list || []).forEach(function (id) {
    var s = String(id || '').trim()
    if (!s || seen[s]) return
    seen[s] = true
    out.push(s)
  })
  return out
}

async function loadAdminOpenIds(db) {
  var ids = DEFAULT_ADMIN_OPENIDS.slice()

  var fromEnv = String(process.env.ADMIN_OPENIDS || '')
    .split(',')
    .map(function (s) {
      return String(s || '').trim()
    })
    .filter(Boolean)
  ids = ids.concat(fromEnv)

  try {
    var res = await db.collection('app_config').doc('admins').get()
    var fromDb = (res.data && res.data.openIds) || []
    // 兼容控制台误填成单个字符串
    if (typeof fromDb === 'string') fromDb = [fromDb]
    if (Array.isArray(fromDb)) {
      ids = ids.concat(
        fromDb.map(function (s) {
          return String(s || '').trim()
        }),
      )
    }
  } catch (e) {
    /* ignore missing config */
  }

  return uniqIds(ids)
}

async function assertAdmin(db, openid) {
  var ids = await loadAdminOpenIds(db)
  var id = String(openid || '').trim()
  var ok = !!(id && ids.indexOf(id) >= 0)
  return {
    ok: ok,
    adminCount: ids.length,
  }
}

function formatTime(ts) {
  var n = Number(ts) || 0
  if (!n) return ''
  var d = new Date(n)
  var pad = function (x) {
    return x < 10 ? '0' + x : String(x)
  }
  return (
    d.getFullYear() +
    '-' +
    pad(d.getMonth() + 1) +
    '-' +
    pad(d.getDate()) +
    ' ' +
    pad(d.getHours()) +
    ':' +
    pad(d.getMinutes())
  )
}

async function handleGetOpenId(openid) {
  return {
    ok: true,
    openid: openid || '',
  }
}

async function countOpenFeedback(db) {
  try {
    var counted = await db.collection('feedback').where({ status: 'open' }).count()
    return (counted && counted.total) || 0
  } catch (e) {
    /* 无索引或旧数据：回退扫描 */
  }
  try {
    var res = await db.collection('feedback').orderBy('createdAt', 'desc').limit(100).get()
    var rows = (res && res.data) || []
    var n = 0
    rows.forEach(function (row) {
      if ((row.status || 'open') === 'open') n += 1
    })
    return n
  } catch (e2) {
    return 0
  }
}

async function handleCheckAdmin(db, openid) {
  var auth = await assertAdmin(db, openid)
  var openFeedbackCount = 0
  if (auth.ok) {
    openFeedbackCount = await countOpenFeedback(db)
  }
  return {
    ok: true,
    isAdmin: auth.ok,
    hasAdminConfig: auth.adminCount > 0,
    adminCount: auth.adminCount,
    openid: openid || '',
    openFeedbackCount: openFeedbackCount,
  }
}

async function handleListFeedback(db, openid, event) {
  var auth = await assertAdmin(db, openid)
  if (!auth.ok) {
    return { ok: false, errMsg: '无管理员权限', errCode: 'NOT_ADMIN' }
  }

  var status = String((event && event.status) || 'all')
  var limit = Math.max(1, Math.min(50, Number(event && event.limit) || 30))
  // 反馈量通常不大：先按时间取，再内存过滤，避免组合索引
  var res = await db
    .collection('feedback')
    .orderBy('createdAt', 'desc')
    .limit(100)
    .get()
  var rows = (res && res.data) || []
  if (status === 'open' || status === 'done') {
    rows = rows.filter(function (row) {
      return (row.status || 'open') === status
    })
  }
  var list = rows.slice(0, limit).map(function (row) {
    return {
      id: row._id,
      content: row.content || '',
      contact: row.contact || '',
      status: row.status || 'open',
      createdAt: row.createdAt || 0,
      createdAtText: formatTime(row.createdAt),
      openid: row.openid || row._openid || '',
    }
  })
  return { ok: true, list: list }
}

async function handleUpdateFeedback(db, openid, event) {
  var auth = await assertAdmin(db, openid)
  if (!auth.ok) {
    return { ok: false, errMsg: '无管理员权限', errCode: 'NOT_ADMIN' }
  }

  var id = String((event && event.id) || '').trim()
  var status = String((event && event.status) || '').trim()
  if (!id) return { ok: false, errMsg: '缺少反馈 id' }
  if (status !== 'open' && status !== 'done') {
    return { ok: false, errMsg: '状态无效' }
  }

  await db.collection('feedback').doc(id).update({
    data: {
      status: status,
      updatedAt: Date.now(),
    },
  })
  return { ok: true }
}

exports.main = async (event) => {
  var action = String((event && event.action) || '').trim()
  var wxContext = cloud.getWXContext()
  var openid = wxContext.OPENID || ''
  var db = cloud.database()

  try {
    if (action === 'getOpenId') return await handleGetOpenId(openid)
    if (action === 'checkAdmin') return await handleCheckAdmin(db, openid)
    if (action === 'listFeedback') return await handleListFeedback(db, openid, event)
    if (action === 'updateFeedback') return await handleUpdateFeedback(db, openid, event)
    return { ok: false, errMsg: '未知操作' }
  } catch (err) {
    var msg = (err && (err.errMsg || err.message)) || String(err)
    if (/not exist|不存在|COLLECTION_NOT_EXIST|-502005/i.test(msg)) {
      return {
        ok: false,
        errMsg: '请先创建相关集合（feedback / app_config）',
      }
    }
    if (/index|orderBy/i.test(msg)) {
      return {
        ok: false,
        errMsg: '请为 feedback.createdAt 建索引（控制台提示创建即可）',
      }
    }
    return { ok: false, errMsg: msg || '操作失败' }
  }
}
