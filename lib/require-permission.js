const { Redis } = require('@upstash/redis')
let _kv;
function getKv() { if (!_kv) _kv = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN }); return _kv; }

function getUser(req) {
  try { return JSON.parse(req.headers['x-user'] || '{}') } catch { return {} }
}

// Boolean check, never touches res.
function hasPermission(req, perm) {
  const user = getUser(req)
  if (user.role === 'superadmin') return true
  if (user.role === 'admin') {
    let perms = user.permissions
    if (typeof perms === 'string') {
      try { perms = JSON.parse(perms) } catch { perms = [] }
    }
    if (Array.isArray(perms) && perms.includes(perm)) return true
  }
  return false
}

// True if the logged-in user is listed among a task's assignees.
function isAssignee(req, task) {
  const user = getUser(req)
  if (!user.name) return false
  const list = Array.isArray(task?.assignees) ? task.assignees : (task?.assignee ? [task.assignee] : [])
  return list.some(a => (typeof a === 'object' ? a?.name : a) === user.name)
}

function requirePermission(perm) {
  return function(req, res) {
    if (hasPermission(req, perm)) return true
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

module.exports = { requirePermission, requireProjectAccess, hasPermission, isAssignee }
