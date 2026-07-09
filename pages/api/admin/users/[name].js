const { Redis } = require('@upstash/redis');
let _kv;
function getKv() { if (!_kv) _kv = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN }); return _kv; }
const { logAudit } = require('../../../../lib/audit-log')
const { requireSuperAdmin } = require('../../../../lib/require-superadmin')
const { ALL_PERMISSIONS } = require('../../../../lib/permissions')
const { renameUser, RenameError } = require('../../../../lib/rename-user')

function existingPerms(profile) {
  if (!profile.permissions) return ALL_PERMISSIONS
  if (Array.isArray(profile.permissions)) return profile.permissions
  try { return JSON.parse(profile.permissions) } catch { return ALL_PERMISSIONS }
}

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
    const { username, password, permissions, assignedProjects, newName } = req.body || {}

    // Rename first so the credential/permission write below lands on the new key,
    // and so project members + task assignments follow the new name.
    let target = name
    if (newName !== undefined) {
      try {
        const result = await renameUser(name, newName)
        target = result.name
        if (result.renamed) await logAudit(req, 'update_admin', 'user', { name: target, renamedFrom: name })
      } catch (err) {
        if (err instanceof RenameError) return res.status(err.status).json({ error: err.message })
        throw err
      }
    }

    const existing = await getKv().hgetall(`user:${target}`) || {}
    const perms = Array.isArray(permissions) ? permissions : existingPerms(existing)
    const newAssigned = assignedProjects !== undefined
      ? JSON.stringify(Array.isArray(assignedProjects) ? assignedProjects : null)
      : (existing.assignedProjects || 'null')
    await getKv().hset(`user:${target}`, {
      username: username !== undefined ? username.trim() : (existing.username || ''),
      password: password && password !== '' ? password : (existing.password || ''),
      role: 'admin',
      permissions: JSON.stringify(perms),
      assignedProjects: newAssigned,
    })
    await logAudit(req, 'update_admin', 'user', { name: target, permissions: perms, assignedProjects: assignedProjects !== undefined ? assignedProjects : undefined })
    return res.json({ ok: true, name: target })
  }

  res.status(405).end()
}
