const { Redis } = require('@upstash/redis');
let _kv;
function getKv() { if (!_kv) _kv = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN }); return _kv; }
const { logAudit } = require('../../../../lib/audit-log')
const { requireSuperAdmin } = require('../../../../lib/require-superadmin')
const { ALL_PERMISSIONS } = require('../../../../lib/permissions')

// Bulk-set the permission list on every secondary admin (role: 'admin') at once.
// Super-admin only. Body may pass `permissions` to apply a specific set;
// omitted/invalid falls back to the full permission list.
export default async function handler(req, res) {
  if (!requireSuperAdmin(req, res)) return
  if (req.method !== 'POST') { res.status(405).end(); return }

  const { permissions } = req.body || {}
  const perms = Array.isArray(permissions) && permissions.length
    ? permissions.filter(p => ALL_PERMISSIONS.includes(p))
    : ALL_PERMISSIONS

  const members = await getKv().smembers('assignees') || []
  let updated = 0
  for (const name of members) {
    const profile = await getKv().hgetall(`user:${name}`) || {}
    if (profile.role !== 'admin') continue
    // Single-field HSET — leaves username/password/assignedProjects untouched.
    await getKv().hset(`user:${name}`, { permissions: JSON.stringify(perms) })
    updated++
  }

  await logAudit(req, 'bulk_update_admin_permissions', 'user', { count: updated, permissions: perms })
  return res.json({ ok: true, updated, permissions: perms })
}
