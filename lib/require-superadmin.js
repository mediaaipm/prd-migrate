function requireSuperAdmin(req, res) {
  try {
    const user = JSON.parse(req.headers['x-user'] || '{}')
    if (user.role === 'superadmin') return true
    if (user.isAdmin === true && !user.role) return true
  } catch {}
  res.status(403).json({ error: 'Super admin access required.' })
  return false
}

module.exports = { requireSuperAdmin }
