const { Redis } = require('@upstash/redis');
let _kv;
function getKv() { if (!_kv) _kv = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN }); return _kv; }
const { logAudit } = require('../../../../lib/audit-log')
const { requireSuperAdmin } = require('../../../../lib/require-superadmin')
const { ALL_PERMISSIONS } = require('../../../../lib/permissions')
const { findUsersByUsername } = require('../../../../lib/user-lookup')

export default async function handler(req, res) {
  if (!requireSuperAdmin(req, res)) return

  const { name } = req.query

  if (req.method === 'DELETE') {
    await getKv().srem('assignees', name)
    await getKv().del(`user:${name}`)
    await logAudit(req, 'delete_admin', 'user', { name })
    return res.status(204).end()
  }

  if (req.method === 'PUT') {
    const { username, password, permissions, assignedProjects } = req.body || {}
    if (username !== undefined) {
      const dupes = await findUsersByUsername(username, name)
      if (dupes.length) return res.status(409).json({ error: 'Username already in use.' })
    }
    const existing = await getKv().hgetall(`user:${name}`) || {}
    const perms = Array.isArray(permissions) ? permissions : ALL_PERMISSIONS
    const newAssigned = assignedProjects !== undefined
      ? JSON.stringify(Array.isArray(assignedProjects) ? assignedProjects : null)
      : (existing.assignedProjects || 'null')
    await getKv().hset(`user:${name}`, {
      username: username !== undefined ? username.trim() : (existing.username || ''),
      password: password && password !== '' ? password : (existing.password || ''),
      role: 'admin',
      permissions: JSON.stringify(perms),
      assignedProjects: newAssigned,
    })
    await logAudit(req, 'update_admin', 'user', { name, permissions: perms, assignedProjects: assignedProjects !== undefined ? assignedProjects : undefined })
    return res.json({ ok: true })
  }

  res.status(405).end()
}
