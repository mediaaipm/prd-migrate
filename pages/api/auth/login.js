const { Redis } = require('@upstash/redis');
let _kv;
function getKv() { if (!_kv) _kv = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN }); return _kv; }
const { logAudit } = require('../../../lib/audit-log')
const { ALL_PERMISSIONS } = require('../../../lib/permissions')
const { findUsersByUsername } = require('../../../lib/user-lookup')

function buildUser(name, username, profile) {
  const role = profile.role || ''
  let permissions = ALL_PERMISSIONS
  if (role === 'admin' && profile.permissions) {
    try {
      permissions = Array.isArray(profile.permissions)
        ? profile.permissions
        : JSON.parse(profile.permissions)
    } catch { permissions = ALL_PERMISSIONS }
  }
  let assignedProjects = null
  if (role === 'admin' && profile.assignedProjects) {
    if (Array.isArray(profile.assignedProjects)) {
      assignedProjects = profile.assignedProjects
    } else {
      try { assignedProjects = JSON.parse(profile.assignedProjects) } catch {}
    }
  }
  return { name, username, isAdmin: role === 'admin' || role === 'superadmin', role, permissions, assignedProjects }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { username, password, selectedName } = req.body || {}
  if (!username || !password) return res.status(400).json({ error: 'Credentials required.' })

  // Built-in superadmin account
  if (username === 'admin' && password === 'MasterManesar@99#') {
    const adminUser = { name: 'Admin', username: 'admin', isAdmin: true, role: 'superadmin' }
    req.headers['x-user'] = JSON.stringify(adminUser)
    await logAudit(req, 'login', 'auth', { username })
    return res.json({ ok: true, user: adminUser })
  }

  // Every stored profile with this username whose password matches.
  const matches = await findUsersByUsername(username)
  const valid = matches.filter(m => m.profile.password === password)

  if (valid.length === 0) {
    await logAudit(req, 'login_failed', 'auth', { username })
    return res.status(401).json({ error: 'Invalid username or password.' })
  }

  // Same username shared by multiple accounts — ask which one to sign in as.
  if (valid.length > 1) {
    if (selectedName) {
      const chosen = valid.find(m => m.name === selectedName)
      if (!chosen) return res.status(400).json({ error: 'Select a valid account.' })
      const user = buildUser(chosen.name, username, chosen.profile)
      req.headers['x-user'] = JSON.stringify(user)
      await logAudit(req, 'login', 'auth', { username, selectedName })
      return res.json({ ok: true, user })
    }
    return res.json({
      chooseAccount: true,
      options: valid.map(m => ({ name: m.name, role: m.profile.role || 'user' })),
    })
  }

  const { name, profile } = valid[0]
  const user = buildUser(name, username, profile)
  req.headers['x-user'] = JSON.stringify(user)
  await logAudit(req, 'login', 'auth', { username })
  return res.json({ ok: true, user })
}
