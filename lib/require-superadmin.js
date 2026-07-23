const { getSessionUser } = require('./session')

function requireSuperAdmin(req, res) {
  const user = getSessionUser(req) || {}
  if (user.role === 'superadmin') return true
  if (user.isAdmin === true && !user.role) return true
  res.status(403).json({ error: 'Super admin access required.' })
  return false
}

module.exports = { requireSuperAdmin }
