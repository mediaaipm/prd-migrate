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
  'qa:review',
  'assignee:manage',
  'holiday:manage',
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
  'qa:review': 'Pass or send back QA reviews',
  'assignee:manage': 'Manage team members',
  'holiday:manage': 'Manage holiday calendar',
  'snapshot:manage': 'Manage snapshots',
}

// Grouping used by the admin, group and role-policy permission editors.
const PERMISSION_GROUPS = [
  { label: 'Visibility (what they can see)', perms: [...VIEW_PERMISSIONS] },
  { label: 'Projects', perms: ['project:create', 'project:update'] },
  { label: 'Proposals', perms: ['proposal:create', 'proposal:update', 'proposal:delete', 'proposal:promote'] },
  { label: 'Tasks', perms: ['task:create', 'task:update'] },
  { label: 'QA', perms: ['qa:review'] },
  { label: 'Other', perms: ['assignee:manage', 'holiday:manage', 'snapshot:manage'] },
]

// Baseline capabilities per role bucket when no global role policy has been saved
// (buckets and roles: lib/roles.js).
// `user` = the Dev role: read everything but the audit log, edit tasks, and add
//   sub-tasks — task:create, which lib/task-nesting.js limits to children, never a story
// `qa` = Dev + the QA verdict. `teamlead` = Dev + QA verdict + project:update (plan
//   sprints, epics). `manager` = all but
//   snapshots and the audit log; `admin` = the full list
// `userRestrictedStatuses` = status keys a dev or QA may NOT move a task into by hand
//   (leads are exempt). `in-review` is not on it: a dev hands a story to QA by moving
//   it there. Rework and Done come from the QA verdict (/api/projects/{slug}/qa).
const DEV_PERMISSIONS = [...VIEW_PERMISSIONS.filter(p => p !== 'audit:view'), 'task:update', 'task:create']
const DEFAULT_ROLE_POLICY = {
  user: DEV_PERMISSIONS,
  qa: [...DEV_PERMISSIONS, 'qa:review'],
  teamlead: [...DEV_PERMISSIONS, 'qa:review', 'project:update'],
  // Everything but snapshots and the audit log — those stay with admins.
  manager: ALL_PERMISSIONS.filter(p => p !== 'snapshot:manage' && p !== 'audit:view'),
  admin: [...ALL_PERMISSIONS],
  userRestrictedStatuses: ['need-rework', 'done', 'backlog', 'blocked'],
}

// Stamped on `user:{name}.permsV` whenever a permission list is written. A stored
// list without it predates the `*:view` permissions and would otherwise read as
// "this account may see nothing" — see upgradeLegacyPerms in lib/user-access.js.
const PERMS_VERSION = 3

module.exports = {
  PERMS_VERSION,
  ALL_PERMISSIONS,
  VIEW_PERMISSIONS,
  ACTION_PERMISSIONS,
  PERMISSION_LABELS,
  PERMISSION_GROUPS,
  DEFAULT_ROLE_POLICY,
}
