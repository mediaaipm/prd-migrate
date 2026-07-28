// Visibility permissions — what a role may SEE. Gated on the GET routes, and
// mirrored client-side so the nav/tabs hide what the API would refuse anyway.
const VIEW_PERMISSIONS = [
  'project:view',
  'version:view',
  'proposal:view',
  'task:view',
  'sprint:view',
  'dashboard:view',
  'audit:view',
]

// Action permissions — what a role may DO.
const ACTION_PERMISSIONS = [
  'project:create',
  'project:update',
  'proposal:create',
  'proposal:update',
  'proposal:delete',
  'proposal:promote',
  'task:create',
  'task:update',
  'assignee:manage',
  'snapshot:manage',
]

const ALL_PERMISSIONS = [...VIEW_PERMISSIONS, ...ACTION_PERMISSIONS]

const PERMISSION_LABELS = {
  'project:view': 'See projects',
  'version:view': 'See PRD versions',
  'proposal:view': 'See proposals',
  'task:view': 'See tasks',
  'sprint:view': 'See sprints',
  'dashboard:view': 'See dashboards',
  'audit:view': 'View audit logs',
  'project:create': 'Create projects',
  'project:update': 'Update projects',
  'proposal:create': 'Create proposals',
  'proposal:update': 'Update proposals',
  'proposal:delete': 'Delete proposals',
  'proposal:promote': 'Promote proposals to versions',
  'task:create': 'Create tasks',
  'task:update': 'Update tasks',
  'assignee:manage': 'Manage team members',
  'snapshot:manage': 'Manage snapshots',
}

// Grouping used by the admin, group and role-policy permission editors.
const PERMISSION_GROUPS = [
  { label: 'Visibility (what they can see)', perms: [...VIEW_PERMISSIONS] },
  { label: 'Projects', perms: ['project:create', 'project:update'] },
  { label: 'Proposals', perms: ['proposal:create', 'proposal:update', 'proposal:delete', 'proposal:promote'] },
  { label: 'Tasks', perms: ['task:create', 'task:update'] },
  { label: 'Other', perms: ['assignee:manage', 'snapshot:manage'] },
]

// Baseline capabilities per role when no global role policy has been saved.
// `user` = viewer role (read everything but the audit log, plus status changes on
// their own tasks); `admin` = full permission list.
// `userRestrictedStatuses` = status keys a regular user may NOT move a task into,
// no matter which project (superadmin-only "gated" statuses).
const DEFAULT_ROLE_POLICY = {
  user: [...VIEW_PERMISSIONS.filter(p => p !== 'audit:view'), 'task:update'],
  admin: [...ALL_PERMISSIONS],
  userRestrictedStatuses: ['in-review', 'need-rework', 'done', 'backlog', 'blocked'],
}

// Stamped on `user:{name}.permsV` whenever a permission list is written. A stored
// list without it predates the `*:view` permissions and would otherwise read as
// "this account may see nothing" — see upgradeLegacyPerms in lib/user-access.js.
const PERMS_VERSION = 2

module.exports = {
  PERMS_VERSION,
  ALL_PERMISSIONS,
  VIEW_PERMISSIONS,
  ACTION_PERMISSIONS,
  PERMISSION_LABELS,
  PERMISSION_GROUPS,
  DEFAULT_ROLE_POLICY,
}
