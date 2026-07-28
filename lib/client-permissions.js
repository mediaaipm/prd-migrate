// Client-side permission checks. These MUST mirror the server gates in
// lib/require-permission.js (hasPermission) and lib/require-superadmin.js so the
// UI only offers actions the API will actually allow.
//
// Roles: superadmin (everything) > admin a.k.a. "subadmin" (only granted
// permissions) > regular user (read + status of own tasks).

// Perms open to every authenticated user (viewers included). Mirrors
// SELF_SERVICE_PERMS in lib/require-permission.js. Creation is admin-only,
// deletion stays superadmin-only.
const SELF_SERVICE_PERMS = new Set(['task:update'])

// Mirrors hasPermission() in lib/require-permission.js. On the tasks page `user`
// is scoped to the current project (perms already intersected with the project
// policy); elsewhere it is the global-default session user.
export function hasPerm(user, perm) {
  if (!user) return false
  if (user.role === 'superadmin' || (user.isAdmin === true && !user.role)) return true
  if (user.role === 'admin') {
    let perms = user.permissions
    if (typeof perms === 'string') { try { perms = JSON.parse(perms) } catch { perms = [] } }
    return Array.isArray(perms) && perms.includes(perm)
  }
  // Viewer: honor the role-policy set (per-project on the tasks page); fall back
  // to the self-service baseline only for legacy sessions with no set.
  if (user.name) {
    let vp = user.viewerPerms
    if (typeof vp === 'string') { try { vp = JSON.parse(vp) } catch { vp = null } }
    if (Array.isArray(vp)) return vp.includes(perm)
    return SELF_SERVICE_PERMS.has(perm)
  }
  return false
}

// Deletion is superadmin-only by policy. Subadmins can create/edit/assign but never delete.
export function isSuperAdmin(user) {
  if (!user) return false
  return user.role === 'superadmin' || (user.isAdmin === true && !user.role)
}

// Visibility check — same shape as hasPerm, named for intent at the call sites
// that hide nav entries and tabs (`*:view` permissions).
export function canView(user, what) {
  return hasPerm(user, `${what}:view`)
}

// True when the account may open this project at all. `null` assignedProjects
// means every project. Mirrors requireProjectAccess in lib/require-permission.js.
export function canSeeProject(user, slug) {
  if (!user) return false
  if (isSuperAdmin(user)) return true
  let list = user.assignedProjects
  if (typeof list === 'string') { try { list = JSON.parse(list) } catch { list = null } }
  if (!Array.isArray(list)) return true
  return list.includes(slug)
}
