// The session user carries global-default permissions; a project's role policy can
// cap them further. Every page that hands a user object to a board or list scopes it
// through here first, so the UI only offers what the server will accept in *this*
// project. Superadmin (and a legacy admin with no role) is unaffected — hasPerm
// short-circuits on role.
//
// `access` is the body of GET /api/projects/{slug}/access; null until it lands, in
// which case the unscoped user is returned rather than a stripped one (offering too
// little is as wrong as offering too much, and the server is the real gate either way).
export function scopeUserToProject(currentUser, access) {
  if (!currentUser || !access) return currentUser
  if (currentUser.role === 'superadmin' || (currentUser.isAdmin && !currentUser.role)) return currentUser
  const u = { ...currentUser }
  // `effective` is what the server computed for THIS caller in THIS project
  // (personal + group grant, capped by the project policy).
  const effective = Array.isArray(access.effective) ? access.effective : null
  if (currentUser.role === 'admin') {
    const personal = Array.isArray(currentUser.permissions) ? currentUser.permissions : []
    u.permissions = effective || personal.filter(p => (access.admin || []).includes(p))
  } else {
    u.viewerPerms = effective || access.user || []
  }
  u.restrictedStatuses = access.userRestrictedStatuses || []
  return u
}
