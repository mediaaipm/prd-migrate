const { Redis } = require('@upstash/redis')
let _kv;
function getKv() { if (!_kv) _kv = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN, enableAutoPipelining: true }); return _kv; }

const { getSessionUser } = require('./session')

const KEY = 'audit:logs'
const MAX_LOGS = 2000

function getAuditUser(req) {
  return getSessionUser(req)
}

// `explicitUser` is for the login route, which establishes the identity in the
// same request that creates the session — there is no cookie to read yet.
async function logAudit(req, action, resource, details = {}, explicitUser = null) {
  try {
    const user = explicitUser || getAuditUser(req)
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      user: user ? { name: user.name, username: user.username } : null,
      action,
      resource,
      details,
      ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null,
    }
    const score = Date.now()
    const [, count] = await Promise.all([
      getKv().zadd(KEY, { score, member: JSON.stringify(entry) }),
      getKv().zcard(KEY),
    ])
    if (count > MAX_LOGS) {
      await getKv().zremrangebyrank(KEY, 0, count - MAX_LOGS - 1)
    }
  } catch {
    // Never let audit logging break the main flow
  }
}

async function getAuditLogs({ limit = 100, offset = 0 } = {}) {
  try {
    const total = await getKv().zcard(KEY)
    const raw = await getKv().zrange(KEY, offset, offset + limit - 1, { rev: true })
    const logs = (raw || []).map(entry => {
      try { return typeof entry === 'string' ? JSON.parse(entry) : entry } catch { return null }
    }).filter(Boolean)
    return { logs, total }
  } catch {
    return { logs: [], total: 0 }
  }
}

async function clearAuditLogs() {
  await getKv().del(KEY)
}

module.exports = { getAuditUser, logAudit, getAuditLogs, clearAuditLogs }
