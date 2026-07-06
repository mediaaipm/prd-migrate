// Client-side permission checks. These MUST mirror the server gates in
// lib/require-permission.js (hasPermission) and lib/require-superadmin.js so the
// UI only offers actions the API will actually allow.
//
// Roles: superadmin (everything) > admin a.k.a. "subadmin" (only granted
// permissions) > regular user (read + status of own tasks).

export function hasPerm(user, perm) {
  if (!user) return false
  if (user.role === 'superadmin') return true
  if (user.role === 'admin') {
    let perms = user.permissions
    if (typeof perms === 'string') { try { perms = JSON.parse(perms) } catch { perms = [] } }
    return Array.isArray(perms) && perms.includes(perm)
  }
  return false
}

// Deletion is superadmin-only by policy. Subadmins can create/edit/assign but never delete.
export function isSuperAdmin(user) {
  if (!user) return false
  return user.role === 'superadmin' || (user.isAdmin === true && !user.role)
}
