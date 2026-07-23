// Fixed-window login throttle, keyed by username AND by client IP.
//
// Without it the login route is an unlimited password oracle: usernames are
// guessable (they show up in the assignee lists) and nothing else slows a
// scripted attempt down.
const { Redis } = require('@upstash/redis')
let _kv
function getKv() { if (!_kv) _kv = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN }); return _kv }

const WINDOW_SEC = 15 * 60
const MAX_PER_USERNAME = 10
const MAX_PER_IP = 30

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for']
  if (fwd) return String(fwd).split(',')[0].trim()
  return req.socket?.remoteAddress || 'unknown'
}

function keys(req, username) {
  return [
    `loginfail:user:${String(username || '').trim().toLowerCase()}`,
    `loginfail:ip:${clientIp(req)}`,
  ]
}

// -> { limited: boolean, retryAfter: seconds }
// Fails OPEN: if Redis is unreachable the throttle must not lock everyone out.
async function checkLoginRateLimit(req, username) {
  const [userKey, ipKey] = keys(req, username)
  try {
    const [userCount, ipCount] = await Promise.all([getKv().get(userKey), getKv().get(ipKey)])
    if (Number(userCount) >= MAX_PER_USERNAME || Number(ipCount) >= MAX_PER_IP) {
      const ttl = await getKv().ttl(userKey).catch(() => WINDOW_SEC)
      return { limited: true, retryAfter: ttl > 0 ? ttl : WINDOW_SEC }
    }
  } catch {}
  return { limited: false, retryAfter: 0 }
}

async function recordLoginFailure(req, username) {
  const kv = getKv()
  await Promise.all(keys(req, username).map(async key => {
    try {
      const n = await kv.incr(key)
      if (n === 1) await kv.expire(key, WINDOW_SEC)
    } catch {}
  }))
}

async function clearLoginFailures(req, username) {
  const kv = getKv()
  await Promise.all(keys(req, username).map(key => kv.del(key).catch(() => {})))
}

module.exports = { checkLoginRateLimit, recordLoginFailure, clearLoginFailures, WINDOW_SEC }
