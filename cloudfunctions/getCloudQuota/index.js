const cloud = require('wx-server-sdk')
const tencentcloud = require('tencentcloud-sdk-nodejs')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

var TcbClient = tencentcloud.tcb.v20180608.Client

/** 免费版常见配额参考（以控制台为准） */
var FREE_REF = {
  StorageSizepkg: { label: '云存储', unit: 'MB', quota: 5 * 1024 },
  DbSizepkg: { label: '数据库容量', unit: 'MB', quota: 2 * 1024 },
  CDNFluxpkg: { label: 'CDN 流量', unit: 'MB', quota: 5 * 1024, fromBytes: true },
  FunctionInvocationpkg: { label: '云函数调用', unit: '次', quota: 200000 },
  DbReadpkg: { label: '数据库读', unit: '次/日', quota: 50000 },
  DbWritepkg: { label: '数据库写', unit: '次/日', quota: 30000 },
}

function createClient() {
  var secretId = process.env.TENCENTCLOUD_SECRETID
  var secretKey = process.env.TENCENTCLOUD_SECRETKEY
  var token = process.env.TENCENTCLOUD_SESSIONTOKEN
  if (!secretId || !secretKey) return null
  return new TcbClient({
    credential: {
      secretId: secretId,
      secretKey: secretKey,
      token: token,
    },
    region: 'ap-shanghai',
    profile: {
      httpProfile: { endpoint: 'tcb.tencentcloudapi.com' },
    },
  })
}

function resolveEnvId(event) {
  if (event && event.envId) return String(event.envId)
  return (
    process.env.TCB_ENV ||
    process.env.SCF_NAMESPACE ||
    cloud.DYNAMIC_CURRENT_ENV ||
    ''
  )
}

async function queryMetric(client, envId, metricName) {
  var res = await client.DescribeQuotaData({
    EnvId: envId,
    MetricName: metricName,
  })
  return {
    metric: metricName,
    value: Number(res.Value) || 0,
    subValue: res.SubValue != null && res.SubValue !== '' ? Number(res.SubValue) : null,
  }
}

async function estimateFromDb() {
  var db = cloud.database()
  var countRes = await db.collection('novels').count()
  var total = Number(countRes.total) || 0
  var storageBytes = 0
  var skip = 0
  while (skip < total) {
    var batch = await db
      .collection('novels')
      .field({ attachmentSize: true })
      .skip(skip)
      .limit(100)
      .get()
    var rows = (batch && batch.data) || []
    if (!rows.length) break
    rows.forEach(function (row) {
      storageBytes += Number(row.attachmentSize) || 0
    })
    skip += rows.length
  }
  return {
    novels: total,
    storageBytes: storageBytes,
    storageMB: Math.round((storageBytes / (1024 * 1024)) * 100) / 100,
  }
}

function buildItems(quotaRows, estimate) {
  var items = []
  var map = {}
  ;(quotaRows || []).forEach(function (row) {
    map[row.metric] = row
  })

  Object.keys(FREE_REF).forEach(function (key) {
    var ref = FREE_REF[key]
    var hit = map[key]
    var used = hit ? hit.value : null
    if (used != null && ref.fromBytes) {
      used = Math.round((used / (1024 * 1024)) * 100) / 100
    }
    if (used == null && key === 'StorageSizepkg' && estimate) {
      used = estimate.storageMB
    }
    var quota =
      hit && hit.subValue != null && Number.isFinite(hit.subValue) && hit.subValue > 0
        ? hit.subValue
        : ref.quota
    if (hit && hit.subValue != null && ref.fromBytes) {
      // SubValue 若也是字节则换算；多数场景 SubValue 为配额容量字符串，按 MB 处理
      var sub = Number(hit.subValue)
      if (sub > ref.quota * 100) quota = Math.round(sub / (1024 * 1024))
      else quota = sub || ref.quota
    }
    var pct = quota > 0 && used != null ? Math.min(100, Math.round((used / quota) * 1000) / 10) : 0
    items.push({
      key: key,
      label: ref.label,
      unit: ref.unit,
      used: used,
      quota: quota,
      percent: pct,
      usedText: used == null ? '—' : formatNum(used) + ' ' + ref.unit,
      quotaText: formatNum(quota) + ' ' + ref.unit,
      remainText:
        used == null ? '—' : formatNum(Math.max(0, quota - used)) + ' ' + ref.unit,
    })
  })
  return items
}

function formatNum(n) {
  var x = Number(n)
  if (!Number.isFinite(x)) return '—'
  if (Math.abs(x) >= 1000) return String(Math.round(x))
  return String(Math.round(x * 100) / 100)
}

exports.main = async (event) => {
  var envId = resolveEnvId(event)
  var estimate = null
  try {
    estimate = await estimateFromDb()
  } catch (e) {
    estimate = { novels: 0, storageBytes: 0, storageMB: 0 }
  }

  var quotaRows = []
  var source = 'estimate'
  var errMsg = ''
  var client = createClient()
  if (client && envId && envId !== true) {
    try {
      var names = Object.keys(FREE_REF)
      for (var i = 0; i < names.length; i++) {
        try {
          quotaRows.push(await queryMetric(client, envId, names[i]))
        } catch (e1) {
          /* skip one metric */
        }
      }
      if (quotaRows.length) source = 'quota'
    } catch (err) {
      errMsg = (err && err.message) || String(err)
    }
  } else {
    errMsg = '云函数未拿到临时密钥，已改用书架估算'
  }

  var items = buildItems(quotaRows, estimate)
  return {
    ok: true,
    source: source,
    envId: envId,
    novels: estimate.novels,
    storageBytes: estimate.storageBytes,
    items: items,
    tip:
      source === 'quota'
        ? '数据来自云开发配额接口，可能有数小时延迟'
        : '小程序无法直接读官方账单；下列为书架附件估算 + 免费额度参考。精确余量请到：开发者工具 → 云开发 → 资源监控',
    errMsg: errMsg,
  }
}
