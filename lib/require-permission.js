const { Redis } = require('@upstash/redis')
let _kv;
function getKv() { if (!_kv) _kv = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN }); return _kv; }

function requirePermission(perm) {
  return function(req, res) {
    try {
      const user = JSON.parse(req.headers['x-user'] || '{}')
      if (user.role === 'superadmin') return true
      if (user.role === 'admin') {
        let perms = user.permissions
        if (typeof perms === 'string') {
          try { perms = JSON.parse(perms) } catch { perms = [] }
        }
        if (Array.isArray(perms) && perms.includes(perm)) return true
      }
    } catch {}
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

module.exports = { requirePermission, requireProjectAccess }
