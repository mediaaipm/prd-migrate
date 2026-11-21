// Re-checks a signed session against the account it names, once per API request.
//
// The cookie is signed, so nobody can forge one — but it is also a 12-hour snapshot.
// On its own it would let a superadmin who was demoted or deleted keep full power
// until it expired, because `isSuper()` and every role check read `role` straight
// from it. This runs in lib/route-adapter.js before the handler, and getSessionUser()
// then returns the live result, so every existing sync caller sees the current role
// without being rewritten.
//
//   stored account   → must still exist under the same username; its `role` is read
//                      from Redis (overriding the cookie); `sessV` must match the
//                      cookie's `sv` (bumped when the password changes — signs out
//                      every other session).
//   built-in admin   → the env account still has to be configured, and the cookie's
//                      fingerprint must match the current secret, so rotating
//                      SUPERADMIN_PASSWORD(_HASH) signs those sessions out.
const crypto = require('crypto')
const { isLeadRole } = require('./roles')
const { Redis } = require('@upstash/redis')
const { readSessionCookie, headerAuthAllowed } = require('./session')

let _kv
function getKv() { if (!_kv) _kv = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN, enableAutoPipelining: true }); return _kv }

function builtInSuperadminSecret() {
  return process.env.SUPERADMIN_PASSWORD_HASH || process.env.SUPERADMIN_PASSWORD || ''
}

function builtInUsername() {
  return process.env.SUPERADMIN_USERNAME || 'admin'
}

// A short, one-way tag of the env credential. Changes whenever the secret does.
function builtInFingerprint() {
  const secret = builtInSuperadminSecret()
  return secret ? crypto.createHash('sha256').update(secret).digest('base64url').slice(0, 16) : ''
}

async function liveUser(user) {
  if (user.builtIn) {
    const fp = builtInFingerprint()
    if (!fp || user.sv !== fp || user.username !== builtInUsername()) return null
    return user
  }
  if (!user.name) return null

  // Fails closed: if the account cannot be read, the request is not authenticated.
  let profile
  try { profile = await getKv().hgetall(`user:${user.name}`) } catch { return null }
  if (!profile || !Object.keys(profile).length) return null // deleted (or renamed)
  if ((profile.username || '') !== (user.username || '')) return null
  if ((Number(profile.sessV) || 0) !== (Number(user.sv) || 0)) return null

  const role = profile.role || ''
  return { ...user, role, isAdmin: role === 'admin' || role === 'superadmin', isLead: isLeadRole(role) }
}

// The current user for this request, or null.
async function resolveSessionUser(req) {
  const user = readSessionCookie(req)
  if (user) return liveUser(user)
  // Dev-only header auth (seed scripts, curl) is taken as given — see lib/session.js.
  if (headerAuthAllowed()) {
    try { return JSON.parse(req.headers['x-user'] || 'null') } catch { return null }
  }
  return null
}

module.exports = { resolveSessionUser, builtInFingerprint }
