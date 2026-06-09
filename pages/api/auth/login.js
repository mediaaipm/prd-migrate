const { Redis } = require('@upstash/redis');
let _kv;
function getKv() { if (!_kv) _kv = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN }); return _kv; }
const { logAudit } = require('../../../lib/audit-log')
const { ALL_PERMISSIONS } = require('../../../lib/permissions')

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { username, password } = req.body || {}
  if (!username || !password) return res.status(400).json({ error: 'Credentials required.' })

  // Built-in superadmin account
  if (username === 'admin' && password === 'MasterManesar@99#') {
    const adminUser = { name: 'Admin', username: 'admin', isAdmin: true, role: 'superadmin' }
    req.headers['x-user'] = JSON.stringify(adminUser)
    await logAudit(req, 'login', 'auth', { username })
    return res.json({ ok: true, user: adminUser })
  }

  // Check against stored user profiles
  const members = await getKv().smembers('assignees')
  for (const name of (members || [])) {
    const profile = await getKv().hgetall(`user:${name}`) || {}
    if (profile.username && profile.username === username && profile.password === password) {
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
      const user = { name, username, isAdmin: role === 'admin' || role === 'superadmin', role, permissions, assignedProjects }
      req.headers['x-user'] = JSON.stringify(user)
      await logAudit(req, 'login', 'auth', { username })
      return res.json({ ok: true, user })
    }
  }

  await logAudit(req, 'login_failed', 'auth', { username })
  return res.status(401).json({ error: 'Invalid username or password.' })
}

