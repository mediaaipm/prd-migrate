const { getEffectiveRolePolicy } = require('./role-policy')
const { getSessionUser } = require('./session')
const { getUserAccess, canSeeProject } = require('./user-access')

// Identity comes from the signed session cookie only — never from a request header
// the browser could set. See lib/session.js.
function getUser(req) {
  return getSessionUser(req) || {}
}

function isSuper(user) {
  return user.role === 'superadmin' || (user.isAdmin === true && !user.role)
}

// Permission checks are PER PROJECT: pass the project slug so the effective role
// policy for that project is consulted. Global routes (project:create,
// assignee:manage, snapshot:manage, audit:view) pass no slug -> global default.
//
//   superadmin -> everything
//   admin      -> perm must be in BOTH their grant (personal + groups) AND the
//                 project's admin policy (the policy sets the ceiling)
//   user       -> perm must be in BOTH their grant (personal + groups, defaulting
//                 to the whole user policy when nobody set one) AND the project's
//                 user policy
//
// Async because it reads the policy and the grant from Redis.
async function hasPermission(req, perm, slug) {
  const user = getUser(req)
  if (isSuper(user)) return true
  if (!user.name) return false

  const [policy, access] = await Promise.all([
    getEffectiveRolePolicy(slug),
    getUserAccess(user.name),
  ])
  const ceiling = user.role === 'admin' ? policy.admin : policy.user
  const granted = access.permissions || ceiling
  return granted.includes(perm) && ceiling.includes(perm)
}

// True for admin/superadmin sessions — the roles exempt from the viewer-only
// status blocklist. Regular users (and legacy no-role sessions) return false.
function isPrivileged(req) {
  const user = getUser(req)
  return user.role === 'admin' || isSuper(user)
}

// True if the logged-in user is listed among a task's assignees.
function isAssignee(req, task) {
  const user = getUser(req)
  if (!user.name) return false
  const list = Array.isArray(task?.assignees) ? task.assignees : (task?.assignee ? [task.assignee] : [])
  return list.some(a => (typeof a === 'object' ? a?.name : a) === user.name)
}

// Project-level ACL gate for the assignee status-change path.
// taskAcl shape: { assigneeCanChangeStatus?: boolean, assigneeStatuses?: string[]|null }
// Missing taskAcl / missing fields => permissive (assignees may set any status).
function assigneeStatusAllowed(taskAcl, status) {
  if (!taskAcl) return true
  if (taskAcl.assigneeCanChangeStatus === false) return false
  const list = taskAcl.assigneeStatuses
  if (!Array.isArray(list)) return true
  return list.includes(status)
}

function requirePermission(perm, slug) {
  return async function(req, res) {
    if (await hasPermission(req, perm, slug)) return true
    res.status(403).json({ error: `Permission denied: ${perm}` })
    return false
  }
}

// Two gates in one: the project must be visible to this account (personal or
// group assignment), and the account must hold `project:view` in this project.
async function requireProjectAccess(slug, req, res) {
  try {
    const user = getUser(req)
    if (!user.name) {
      res.status(401).json({ error: 'Not signed in.' })
      return false
    }
    if (isSuper(user)) return true

    const access = await getUserAccess(user.name)
    if (!canSeeProject(access, slug)) {
      res.status(403).json({ error: 'Access denied to this project.' })
      return false
    }
    if (await hasPermission(req, 'project:view', slug)) return true
  } catch {}
  res.status(403).json({ error: 'Access denied to this project.' })
  return false
}

// Filters a project list down to what this account may see. Superadmins see all.
async function visibleProjects(req, projects) {
  const user = getUser(req)
  if (isSuper(user)) return projects
  if (!user.name) return []
  const access = await getUserAccess(user.name)
  if (access.projects === null) return projects
  return projects.filter(p => access.projects.includes(p.slug))
}

module.exports = {
  requirePermission,
  requireProjectAccess,
  hasPermission,
  isAssignee,
  assigneeStatusAllowed,
  isPrivileged,
  visibleProjects,
}
