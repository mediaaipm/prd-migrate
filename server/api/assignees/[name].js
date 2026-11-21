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
const { MEMBER_ROLES, roleLabel } = require('../../../lib/roles')
const { allProfiles, leadError, brokenLinks } = require('../../../lib/team')

const KEY = 'assignees'

export default async function handler(req, res) {
  const { name } = req.query

  if (req.method === 'DELETE') {
    if (!await requirePermission('assignee:manage')(req, res)) return
    await getKv().srem(KEY, name)
    await getKv().del(`user:${name}`)
    await removeUserFromAllGroups(name)
    // Their reports are left without a lead rather than pointing at a deleted account.
    const reports = (await allProfiles()).filter(p => p.lead === name)
    await Promise.all(reports.map(p => getKv().hset(`user:${p.name}`, { lead: '' })))
    await logAudit(req, 'delete_user', 'user', { name })
    return res.status(204).end()
  }

  if (req.method === 'PUT') {
    const { username, password, newName, role, lead } = req.body || {}

    // Team lead (lib/team.js). Its own request, like role. '' clears it.
    if (lead !== undefined) {
      if (!await requirePermission('assignee:manage')(req, res)) return
      const next = typeof lead === 'string' ? lead.trim() : ''
      const profiles = await allProfiles()
      const me = profiles.find(p => p.name === name)
      if (!me) return res.status(404).json({ error: 'User not found.' })
      if (me.role === 'admin' || me.role === 'superadmin') return res.status(400).json({ error: 'Admins do not report to a team lead.' })
      if (next) {
        const err = leadError(profiles, name, next)
        if (err) return res.status(400).json({ error: err })
      }
      await getKv().hset(`user:${name}`, { lead: next })
      await logAudit(req, 'update_user_lead', 'user', { name, from: me.lead || null, to: next || null })
      return res.json({ ok: true, lead: next })
    }

    // Role change (lib/roles.js). Its own request: never mixed with credentials.
    //  - team-member roles only; admin/superadmin are made and unmade under Admin → Admins
    //  - an admin account cannot be moved here (that would be a silent demotion)
    //  - nobody changes their own role
    //  - only an admin/superadmin may hand out Manager (a manager may not mint peers)
    if (role !== undefined) {
      if (!await requirePermission('assignee:manage')(req, res)) return
      const next = typeof role === 'string' ? role.trim().toLowerCase() : ''
      if (!MEMBER_ROLES.includes(next)) return res.status(400).json({ error: `Role must be one of: ${MEMBER_ROLES.map(roleLabel).join(', ')}.` })
      const session = getSessionUser(req) || {}
      if (session.name === name) return res.status(403).json({ error: 'You cannot change your own role.' })
      const existing = await getKv().hgetall(`user:${name}`) || {}
      const known = Object.keys(existing).length > 0 || await getKv().sismember(KEY, name)
      if (!known) return res.status(404).json({ error: 'User not found.' })
      if (existing.role === 'admin' || existing.role === 'superadmin') {
        return res.status(403).json({ error: 'Admins are managed under Admin → Admins.' })
      }
      const sessionIsAdmin = session.role === 'admin' || session.role === 'superadmin' || (session.isAdmin === true && !session.role)
      if (next === 'manager' && !sessionIsAdmin) return res.status(403).json({ error: 'Only an admin can make someone a Manager.' })
      // Read live on every request (lib/session-live.js): the change applies at once.
      await getKv().hset(`user:${name}`, { role: next })
      // Links the new role breaks (lib/team.js): cleared, never left pointing up the wrong way.
      const cleared = brokenLinks(await allProfiles(), name, next)
      await Promise.all(cleared.map(n => getKv().hset(`user:${n}`, { lead: '' })))
      await logAudit(req, 'update_user_role', 'user', { name, from: existing.role || 'dev', to: next, ...(cleared.length ? { clearedLeads: cleared } : {}) })
      return res.json({ ok: true, role: next, clearedLeads: cleared })
    }

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
      // A new password signs out every existing session of this account.
      sessV: password !== undefined && password !== '' ? String((Number(existing.sessV) || 0) + 1) : String(existing.sessV || 0),
    })
    await logAudit(req, 'update_user_credentials', 'user', { name, changedFields: [username !== undefined && 'username', password ? 'password' : null].filter(Boolean) })
    return res.json({ ok: true })
  }

  res.status(405).end()
}
