const { Redis } = require('@upstash/redis');
let _kv;
function getKv() { if (!_kv) _kv = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN }); return _kv; }
const { logAudit } = require('../../../../lib/audit-log')
const { requireSuperAdmin } = require('../../../../lib/require-superadmin')
const { ALL_PERMISSIONS, PERMS_VERSION } = require('../../../../lib/permissions')
const { getGlobalRolePolicy } = require('../../../../lib/role-policy')
const { hashPassword } = require('../../../../lib/password')

export default async function handler(req, res) {
  if (!requireSuperAdmin(req, res)) return

  if (req.method === 'GET') {
    const members = await getKv().smembers('assignees')
    const names = (members || []).sort()
    const profiles = await Promise.all(names.map(async name => {
      const profile = await getKv().hgetall(`user:${name}`) || {}
      let permissions = ALL_PERMISSIONS
      if (profile.permissions) {
        try {
          permissions = Array.isArray(profile.permissions)
            ? profile.permissions
            : JSON.parse(profile.permissions)
        } catch {}
      }
      let assignedProjects = null
      if (profile.assignedProjects) {
        if (Array.isArray(profile.assignedProjects)) {
          assignedProjects = profile.assignedProjects
        } else {
          try { assignedProjects = JSON.parse(profile.assignedProjects) } catch {}
        }
      }
      return { name, username: profile.username || '', hasPassword: !!profile.password, role: profile.role || '', permissions, assignedProjects }
    }))
    return res.json(profiles.filter(p => p.role === 'admin' || p.role === 'superadmin'))
  }

  if (req.method === 'POST') {
    const { name, username, password, permissions } = req.body || {}
    if (!name || !name.trim()) return res.status(400).json({ error: 'name required' })
    if (!username || !username.trim()) return res.status(400).json({ error: 'username required' })
    if (!password) return res.status(400).json({ error: 'password required' })
    const trimName = name.trim()
    // Explicit list wins; otherwise seed from the global admin role policy.
    const perms = Array.isArray(permissions) ? permissions : (await getGlobalRolePolicy()).admin
    const { assignedProjects } = req.body || {}
    await getKv().sadd('assignees', trimName)
    await getKv().hset(`user:${trimName}`, {
      username: username.trim(),
      password: hashPassword(password),
      role: 'admin',
      permissions: JSON.stringify(perms),
      permsV: String(PERMS_VERSION),
      assignedProjects: JSON.stringify(Array.isArray(assignedProjects) ? assignedProjects : null),
    })
    await logAudit(req, 'create_admin', 'user', { name: trimName })
    return res.status(201).json({ name: trimName, username: username.trim(), role: 'admin', permissions: perms, assignedProjects: Array.isArray(assignedProjects) ? assignedProjects : null })
  }

  res.status(405).end()
}
