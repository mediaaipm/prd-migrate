const { Redis } = require('@upstash/redis')
const { getEffectiveRolePolicy } = require('./role-policy')
let _kv;
function getKv() { if (!_kv) _kv = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN, enableAutoPipelining: true }); return _kv; }

function getUser(req) {
  try { return JSON.parse(req.headers['x-user'] || '{}') } catch { return {} }
}

// Permission checks are PER PROJECT: pass the project slug so the effective role
// policy for that project is consulted. Global routes (project:create,
// assignee:manage, snapshot:manage, audit:view) pass no slug -> global default.
//
//   superadmin -> everything
//   admin      -> perm must be in BOTH their personal grant AND the project's
//                 admin policy (the project sets the ceiling; the per-admin
//                 editor can restrict an individual admin further)
//   viewer     -> perm must be in the project's user policy
//
// Async because it reads the policy from Redis.
async function hasPermission(req, perm, slug) {
  const user = getUser(req)
  if (user.role === 'superadmin' || (user.isAdmin === true && !user.role)) return true
  const policy = await getEffectiveRolePolicy(slug)
  if (user.role === 'admin') {
    let perms = user.permissions
    if (typeof perms === 'string') {
      try { perms = JSON.parse(perms) } catch { perms = [] }
    }
    if (!Array.isArray(perms)) perms = []
    return perms.includes(perm) && policy.admin.includes(perm)
  }
  // Viewer (regular user).
  if (user.name) return policy.user.includes(perm)
  return false
}

// True for admin/superadmin sessions — the roles exempt from the viewer-only
// status blocklist. Regular users (and legacy no-role sessions) return false.
function isPrivileged(req) {
  const user = getUser(req)
  return user.role === 'admin' || user.role === 'superadmin' || (user.isAdmin === true && !user.role)
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

async function requireProjectAccess(slug, req, res) {
  try {
    const user = JSON.parse(req.headers['x-user'] || '{}')
    if (user.role === 'superadmin') return true
    if (user.role === 'admin') {
      const profile = await getKv().hgetall('user:' + user.name) || {}
      let assigned = profile.assignedProjects
      if (!assigned) return true
      if (typeof assigned === 'string') {
        try { assigned = JSON.parse(assigned) } catch { assigned = null }
      }
      if (!assigned) return true
      if (Array.isArray(assigned) && assigned.includes(slug)) return true
    } else {
      // regular users always have read access
      return true
    }
  } catch {}
  res.status(403).json({ error: 'Access denied to this project.' })
  return false
}

module.exports = { requirePermission, requireProjectAccess, hasPermission, isAssignee, assigneeStatusAllowed, isPrivileged }
