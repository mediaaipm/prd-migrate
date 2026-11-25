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
const { ROLES, MEMBER_ROLES, roleLabel } = require('../../../lib/roles')
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
    //  - nobody changes their own role (so a super admin can never demote the last one: themselves)
    //  - a super admin may set any role on anyone, admins included
    //  - everyone else (assignee:manage): team-member roles only, and never on an admin
    //    account (that would be a silent demotion); only an admin hands out Manager
    //  - crossing the admin / team-member line clears the personal permission list, so
    //    the person gets the whole policy of the new role (lib/user-access.js) instead of
    //    a list chosen for the old one. Project access and groups stay.
    if (role !== undefined) {
      if (!await requirePermission('assignee:manage')(req, res)) return
      const session = getSessionUser(req) || {}
      const sessionIsSuper = session.role === 'superadmin' || (session.isAdmin === true && !session.role)
      const allowed = sessionIsSuper ? ROLES.map(r => r.key) : MEMBER_ROLES
      const next = typeof role === 'string' ? role.trim().toLowerCase() : ''
      if (!allowed.includes(next)) return res.status(400).json({ error: `Role must be one of: ${allowed.map(roleLabel).join(', ')}.` })
      if (session.name === name) return res.status(403).json({ error: 'You cannot change your own role.' })
      const existing = await getKv().hgetall(`user:${name}`) || {}
      const known = Object.keys(existing).length > 0 || await getKv().sismember(KEY, name)
      if (!known) return res.status(404).json({ error: 'User not found.' })
      const wasAdmin = existing.role === 'admin' || existing.role === 'superadmin'
      if (wasAdmin && !sessionIsSuper) return res.status(403).json({ error: 'Only a super admin can change an admin’s role.' })
      const sessionIsAdmin = session.role === 'admin' || sessionIsSuper
      if (next === 'manager' && !sessionIsAdmin) return res.status(403).json({ error: 'Only an admin can make someone a Manager.' })
      const from = existing.role || 'dev'
      if (next === from) return res.json({ ok: true, role: next, clearedLeads: [] })
      // Read live on every request (lib/session-live.js): the change applies at once.
      await getKv().hset(`user:${name}`, { role: next })
      const isAdmin = next === 'admin' || next === 'superadmin'
      const resetPerms = wasAdmin !== isAdmin && existing.permissions !== undefined
      if (resetPerms) await getKv().hdel(`user:${name}`, 'permissions', 'permsV')
      // Links the new role breaks (lib/team.js): cleared, never left pointing up the wrong way.
      const cleared = brokenLinks(await allProfiles(), name, next)
      await Promise.all(cleared.map(n => getKv().hset(`user:${n}`, { lead: '' })))
      await logAudit(req, 'update_user_role', 'user', { name, from, to: next, ...(cleared.length ? { clearedLeads: cleared } : {}), ...(resetPerms ? { permissionsReset: true } : {}) })
      return res.json({ ok: true, role: next, clearedLeads: cleared, permissionsReset: resetPerms })
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
