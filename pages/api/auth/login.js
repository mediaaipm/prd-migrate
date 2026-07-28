const { Redis } = require('@upstash/redis');
let _kv;
function getKv() { if (!_kv) _kv = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN }); return _kv; }
const { logAudit } = require('../../../lib/audit-log')
const { ALL_PERMISSIONS } = require('../../../lib/permissions')
const { getGlobalRolePolicy } = require('../../../lib/role-policy')
const { findUsersByUsername } = require('../../../lib/user-lookup')
const { getUserAccess } = require('../../../lib/user-access')
const { hashPassword, verifyPassword } = require('../../../lib/password')
const { setSessionCookie } = require('../../../lib/session')
const { checkLoginRateLimit, recordLoginFailure, clearLoginFailures } = require('../../../lib/login-rate-limit')

// `access` is the merged personal + group grant from lib/user-access.js; `policy`
// is the global role policy that caps it.
function buildUser(name, username, profile, access, policy) {
  const role = profile.role || ''
  const ceiling = role === 'admin' ? policy.admin : policy.user
  const granted = access.permissions || ceiling
  const effective = granted.filter(p => ceiling.includes(p))

  const user = {
    name,
    username,
    isAdmin: role === 'admin' || role === 'superadmin',
    role,
    permissions: role === 'superadmin' ? ALL_PERMISSIONS : effective,
    // null means "every project"; an array restricts the project list and every
    // project-scoped route (enforced server-side in requireProjectAccess).
    assignedProjects: access.projects,
    groups: access.groups,
  }
  // Viewers carry their capability set so the client only offers what the server
  // will allow. restrictedStatuses is a UI hint so the board/list hide statuses
  // the server would reject anyway (enforcement lives in the task update handlers).
  if (role !== 'admin' && role !== 'superadmin') {
    user.viewerPerms = effective
    user.restrictedStatuses = policy.userRestrictedStatuses || []
  }
  return user
}

// The break-glass superadmin, configured entirely from the environment.
// Prefer SUPERADMIN_PASSWORD_HASH (generate one with `node scripts/set-superadmin.js`);
// SUPERADMIN_PASSWORD is accepted for convenience in local development.
// With neither set, the built-in account does not exist.
function builtInSuperadminSecret() {
  return process.env.SUPERADMIN_PASSWORD_HASH || process.env.SUPERADMIN_PASSWORD || ''
}

// Upgrade a plaintext (or weakly parameterised) stored password in place, once the
// user has proven they know it. Never blocks the login if it fails.
async function rehashStoredPassword(name, password) {
  try { await getKv().hset(`user:${name}`, { password: hashPassword(password) }) } catch {}
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { username, password, selectedName } = req.body || {}
  if (!username || !password) return res.status(400).json({ error: 'Credentials required.' })

  const throttle = await checkLoginRateLimit(req, username)
  if (throttle.limited) {
    res.setHeader('Retry-After', String(throttle.retryAfter))
    return res.status(429).json({ error: 'Too many failed attempts. Try again later.' })
  }

  // Built-in superadmin account (env-configured).
  const superadminUsername = process.env.SUPERADMIN_USERNAME || 'admin'
  if (username === superadminUsername) {
    const secret = builtInSuperadminSecret()
    if (secret && verifyPassword(password, secret).ok) {
      const adminUser = { name: 'Admin', username: superadminUsername, isAdmin: true, role: 'superadmin' }
      setSessionCookie(res, adminUser)
      await clearLoginFailures(req, username)
      await logAudit(req, 'login', 'auth', { username }, adminUser)
      return res.json({ ok: true, user: adminUser })
    }
    // Falls through: a stored account may legitimately share this username.
  }

  // Global-default capability set for this login. Per-project overrides are
  // applied client-side on the tasks page (and enforced server-side per request).
  const rolePolicy = await getGlobalRolePolicy()

  // Every stored profile with this username whose password matches.
  const matches = await findUsersByUsername(username)
  const valid = []
  for (const m of matches) {
    const { ok, needsRehash } = verifyPassword(password, m.profile.password)
    if (!ok) continue
    if (needsRehash) await rehashStoredPassword(m.name, password)
    valid.push(m)
  }

  if (valid.length === 0) {
    await recordLoginFailure(req, username)
    await logAudit(req, 'login_failed', 'auth', { username })
    return res.status(401).json({ error: 'Invalid username or password.' })
  }

  // Same username shared by multiple accounts — ask which one to sign in as.
  // No session is issued until one is picked.
  if (valid.length > 1) {
    if (selectedName) {
      const chosen = valid.find(m => m.name === selectedName)
      if (!chosen) return res.status(400).json({ error: 'Select a valid account.' })
      const user = buildUser(chosen.name, username, chosen.profile, await getUserAccess(chosen.name), rolePolicy)
      setSessionCookie(res, user)
      await clearLoginFailures(req, username)
      await logAudit(req, 'login', 'auth', { username, selectedName }, user)
      return res.json({ ok: true, user })
    }
    return res.json({
      chooseAccount: true,
      options: valid.map(m => ({ name: m.name, role: m.profile.role || 'user' })),
    })
  }

  const { name, profile } = valid[0]
  const user = buildUser(name, username, profile, await getUserAccess(name), rolePolicy)
  setSessionCookie(res, user)
  await clearLoginFailures(req, username)
  await logAudit(req, 'login', 'auth', { username }, user)
  return res.json({ ok: true, user })
}
