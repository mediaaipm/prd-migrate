// Server-side session: an HMAC-signed, HttpOnly cookie.
//
// The old scheme trusted an `X-User` request header that the browser built from
// localStorage — i.e. any client could name its own role. Everything below exists
// so the server, and only the server, decides who a request belongs to.
//
// The token is stateless (no Redis round-trip per request):
//   <base64url(payload)>.<base64url(hmac-sha256(payload, AUTH_SECRET))>
// The payload carries the whole user object plus `exp`, so a session reflects the
// permissions held at login time and goes stale after SESSION_TTL_MS at the latest.
const crypto = require('crypto')

const COOKIE_NAME = 'prd_session'
const SESSION_TTL_MS = 12 * 60 * 60 * 1000 // 12h

// Only honoured outside production, and only when explicitly opted in. Lets the
// seed/migration scripts and local curl testing keep using the X-User header.
function headerAuthAllowed() {
  return process.env.NODE_ENV !== 'production' && process.env.ALLOW_HEADER_AUTH === '1'
}

let warnedMissingSecret = false

// Throws in production when unset — failing the login loudly beats signing every
// session with a guessable key.
function getSecret() {
  const secret = process.env.AUTH_SECRET
  if (secret && secret.length >= 16) return secret
  if (process.env.NODE_ENV === 'production') {
    throw new Error('AUTH_SECRET is not set (needs >= 16 chars). Sessions cannot be signed.')
  }
  if (!warnedMissingSecret) {
    warnedMissingSecret = true
    console.warn('[auth] AUTH_SECRET unset — using an insecure development secret. Set it before deploying.')
  }
  return 'dev-only-insecure-secret-do-not-use-in-production'
}

const b64url = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64url = str => Buffer.from(String(str).replace(/-/g, '+').replace(/_/g, '/'), 'base64')

function sign(payloadB64) {
  return b64url(crypto.createHmac('sha256', getSecret()).update(payloadB64).digest())
}

function signSession(user, { ttlMs = SESSION_TTL_MS } = {}) {
  const payload = { ...user, iat: Date.now(), exp: Date.now() + ttlMs }
  const payloadB64 = b64url(JSON.stringify(payload))
  return `${payloadB64}.${sign(payloadB64)}`
}

// Returns the user object, or null for anything that is not a currently valid,
// correctly signed token.
function verifySession(token) {
  if (typeof token !== 'string') return null
  const dot = token.indexOf('.')
  if (dot < 1) return null
  const payloadB64 = token.slice(0, dot)
  const sigB64 = token.slice(dot + 1)

  let expected
  try { expected = sign(payloadB64) } catch { return null } // missing secret in prod

  const a = Buffer.from(sigB64)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null

  let payload
  try { payload = JSON.parse(unb64url(payloadB64).toString('utf8')) } catch { return null }
  if (!payload || typeof payload !== 'object') return null
  if (!payload.exp || Date.now() > payload.exp) return null

  const { iat, exp, ...user } = payload
  return user
}

function parseCookies(header) {
  const out = {}
  if (!header) return out
  for (const part of String(header).split(';')) {
    const eq = part.indexOf('=')
    if (eq < 1) continue
    const k = part.slice(0, eq).trim()
    if (!k || k in out) continue
    try { out[k] = decodeURIComponent(part.slice(eq + 1).trim()) } catch { out[k] = part.slice(eq + 1).trim() }
  }
  return out
}

// THE authentication entry point. Every authorization check must go through this
// and never read `req.headers['x-user']` directly.
function getSessionUser(req) {
  const token = parseCookies(req.headers?.cookie)[COOKIE_NAME]
  const user = verifySession(token)
  if (user) return user
  if (headerAuthAllowed()) {
    try { return JSON.parse(req.headers['x-user'] || 'null') } catch { return null }
  }
  return null
}

function appendCookie(res, value) {
  const prev = res.getHeader('Set-Cookie')
  const list = prev ? (Array.isArray(prev) ? prev : [prev]) : []
  res.setHeader('Set-Cookie', [...list, value])
}

function setSessionCookie(res, user, { ttlMs = SESSION_TTL_MS } = {}) {
  const token = signSession(user, { ttlMs })
  const attrs = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(ttlMs / 1000)}`,
  ]
  if (process.env.NODE_ENV === 'production') attrs.push('Secure')
  appendCookie(res, attrs.join('; '))
  return token
}

function clearSessionCookie(res) {
  const attrs = [`${COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0']
  if (process.env.NODE_ENV === 'production') attrs.push('Secure')
  appendCookie(res, attrs.join('; '))
}

module.exports = {
  COOKIE_NAME, SESSION_TTL_MS,
  signSession, verifySession, getSessionUser,
  setSessionCookie, clearSessionCookie, parseCookies,
}
