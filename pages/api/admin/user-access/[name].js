// Per-user access: the personal permission grant, the project visibility list and
// group membership for ONE account — the same knobs the Admins tab exposes for
// admins, but usable on any user. Superadmin only.
//
// Field encoding on `user:{name}` (see lib/user-access.js):
//   ''          -> unset: inherit the role policy / let groups decide
//   'null'      -> explicitly "all projects"
//   '["a","b"]' -> that list
const { Redis } = require('@upstash/redis')
let _kv
function getKv() { if (!_kv) _kv = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN }); return _kv }

const { requireSuperAdmin } = require('../../../../lib/require-superadmin')
const { ALL_PERMISSIONS, PERMS_VERSION } = require('../../../../lib/permissions')
const { getGlobalRolePolicy } = require('../../../../lib/role-policy')
const { getUserAccess } = require('../../../../lib/user-access')
const { setUserGroups } = require('../../../../lib/group-store')
const { logAudit } = require('../../../../lib/audit-log')

const INHERIT = 'inherit'

function encodePerms(value) {
  if (value === INHERIT || value === null) return ''
  if (!Array.isArray(value)) return undefined
  return JSON.stringify([...new Set(value.filter(p => ALL_PERMISSIONS.includes(p)))])
}

function encodeProjects(value) {
  if (value === INHERIT) return ''
  if (value === null) return 'null'
  if (!Array.isArray(value)) return undefined
  return JSON.stringify([...new Set(value.map(s => String(s || '').trim()).filter(Boolean))])
}

export default async function handler(req, res) {
  if (!requireSuperAdmin(req, res)) return
  const { name } = req.query

  const profile = (await getKv().hgetall(`user:${name}`)) || {}
  if (!profile || Object.keys(profile).length === 0) {
    const known = await getKv().sismember('assignees', name)
    if (!known) return res.status(404).json({ error: 'User not found.' })
  }

  if (req.method === 'GET') {
    const [access, policy] = await Promise.all([getUserAccess(name), getGlobalRolePolicy()])
    const role = profile.role || ''
    const ceiling = role === 'admin' ? policy.admin : policy.user
    return res.json({
      name,
      role,
      // What the superadmin explicitly set on this account (undefined = inherit).
      personal: {
        permissions: access.personal.permissions === undefined ? null : access.personal.permissions,
        permissionsInherited: access.personal.permissions === undefined,
        assignedProjects: access.personal.projects === undefined ? null : access.personal.projects,
        projectsInherited: access.personal.projects === undefined,
      },
      groups: access.groups,
      // What actually applies right now: grant ∩ role-policy ceiling.
      effective: {
        permissions: (access.permissions || ceiling).filter(p => ceiling.includes(p)),
        projects: access.projects,
      },
      ceiling,
    })
  }

  if (req.method === 'PUT') {
    const { permissions, assignedProjects, groups } = req.body || {}
    const patch = {}
    if (permissions !== undefined) {
      const encoded = encodePerms(permissions)
      if (encoded === undefined) return res.status(400).json({ error: 'permissions must be an array, null, or "inherit"' })
      patch.permissions = encoded
      patch.permsV = String(PERMS_VERSION)
    }
    if (assignedProjects !== undefined) {
      const encoded = encodeProjects(assignedProjects)
      if (encoded === undefined) return res.status(400).json({ error: 'assignedProjects must be an array, null, or "inherit"' })
      patch.assignedProjects = encoded
    }
    if (Object.keys(patch).length) await getKv().hset(`user:${name}`, patch)
    if (Array.isArray(groups)) await setUserGroups(name, groups)

    await logAudit(req, 'update_user_access', 'user', { name, permissions, assignedProjects, groups })
    const access = await getUserAccess(name)
    return res.json({ ok: true, name, groups: access.groups, effective: { permissions: access.permissions, projects: access.projects } })
  }

  res.status(405).end()
}
