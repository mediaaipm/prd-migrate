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

// Nesting floor for regular users — mirrors lib/task-nesting.js. A main task is depth
// 0, its sub-task depth 1, a sub-sub-task depth 2; a capped account may only put a
// task at depth 2 or deeper. Admin and superadmin shape the tree freely; a user who
// holds task:create fills in the work beneath it.
export function isNestingCapped(user) {
  if (!user) return false
  if (user.role === 'superadmin' || user.role === 'admin') return false
  if (user.isAdmin === true && !user.role) return false
  return true
}

// True when `user` may add a task under `parent` — null/undefined parent meaning a
// new main task. A capped account needs a parent that itself has a parent, so the new
// task lands at sub-sub level.
export function canAddUnder(user, parent) {
  if (!isNestingCapped(user)) return true
  return !!(parent && parent.parentId)
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
