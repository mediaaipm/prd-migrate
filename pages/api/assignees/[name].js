const { Redis } = require('@upstash/redis');
let _kv;
function getKv() { if (!_kv) _kv = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN }); return _kv; }
const { logAudit } = require('../../../lib/audit-log')
const { requirePermission } = require('../../../lib/require-permission')
const { requireSuperAdmin } = require('../../../lib/require-superadmin')
const { renameUser, RenameError } = require('../../../lib/rename-user')
const { hashPassword } = require('../../../lib/password')
const { getSessionUser } = require('../../../lib/session')
const { removeUserFromAllGroups } = require('../../../lib/group-store')

const KEY = 'assignees'

export default async function handler(req, res) {
  const { name } = req.query

  if (req.method === 'DELETE') {
    if (!await requirePermission('assignee:manage')(req, res)) return
    await getKv().srem(KEY, name)
    await getKv().del(`user:${name}`)
    await removeUserFromAllGroups(name)
    await logAudit(req, 'delete_user', 'user', { name })
    return res.status(204).end()
  }

  if (req.method === 'PUT') {
    const { username, password, newName } = req.body || {}

    // Rename is superadmin-only, and works for any role (user, admin, superadmin).
    // Existing project members and task assignments are cascaded to the new name.
    if (newName !== undefined) {
      if (!requireSuperAdmin(req, res)) return
      try {
        const result = await renameUser(name, newName, { username, password })
        if (result.renamed) {
          await logAudit(req, 'update_user_credentials', 'user', { name: result.name, renamedFrom: name })
          return res.json({ ok: true, name: result.name })
        }
      } catch (err) {
        if (err instanceof RenameError) return res.status(err.status).json({ error: err.message })
        throw err
      }
    }

    // This branch rewrites credentials, so it needs its own gate — the rename check
    // above only covers requests that carry a newName. Without this, any signed-in
    // user could set anyone's password, including a superadmin's.
    const session = getSessionUser(req) || {}
    if (session.name !== name && !await requirePermission('assignee:manage')(req, res)) return

    const existing = await getKv().hgetall(`user:${name}`) || {}
    await getKv().hset(`user:${name}`, {
      username: username !== undefined ? username.trim() : (existing.username || ''),
      // A blank field means "keep current"; anything else is hashed before storage.
      password: password !== undefined && password !== '' ? hashPassword(password) : (existing.password || ''),
    })
    await logAudit(req, 'update_user_credentials', 'user', { name, changedFields: [username !== undefined && 'username', password ? 'password' : null].filter(Boolean) })
    return res.json({ ok: true })
  }

  res.status(405).end()
}
