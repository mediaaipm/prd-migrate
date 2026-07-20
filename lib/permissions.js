const ALL_PERMISSIONS = [
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
  'audit:view',
]

const PERMISSION_LABELS = {
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
  'audit:view': 'View audit logs',
}

// Grouping used by the admin + role-policy permission editors.
const PERMISSION_GROUPS = [
  { label: 'Projects', perms: ['project:create', 'project:update'] },
  { label: 'Proposals', perms: ['proposal:create', 'proposal:update', 'proposal:delete', 'proposal:promote'] },
  { label: 'Tasks', perms: ['task:create', 'task:update'] },
  { label: 'Other', perms: ['assignee:manage', 'snapshot:manage', 'audit:view'] },
]

// Baseline capabilities per role when no global role policy has been saved.
// `user` = viewer role (self-service only); `admin` = full permission list.
// `userRestrictedStatuses` = status keys a regular user may NOT move a task into,
// no matter which project (superadmin-only "gated" statuses).
const DEFAULT_ROLE_POLICY = {
  user: ['task:update'],
  admin: [...ALL_PERMISSIONS],
  userRestrictedStatuses: ['in-review', 'need-rework', 'done', 'backlog', 'blocked'],
}

module.exports = { ALL_PERMISSIONS, PERMISSION_LABELS, PERMISSION_GROUPS, DEFAULT_ROLE_POLICY }
