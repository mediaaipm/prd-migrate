const ALL_PERMISSIONS = [
  'project:create',
  'project:update',
  'proposal:create',
  'proposal:update',
  'proposal:delete',
  'proposal:promote',
  'task:create',
  'task:update',
  'task:delete',
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
  'task:delete': 'Delete tasks',
  'assignee:manage': 'Manage team members',
  'snapshot:manage': 'Manage snapshots',
  'audit:view': 'View audit logs',
}

module.exports = { ALL_PERMISSIONS, PERMISSION_LABELS }
