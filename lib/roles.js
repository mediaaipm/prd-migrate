// Account roles. One list, shared by the server gates and the UI.
//
//   superadmin  everything (built-in account + any account given the role)
//   admin       admin pages + whatever the admin ceiling allows
//   manager     leads a team: full task/sprint work, QA verdicts — no admin pages
//   teamlead    adds stories, plans sprints, QA verdicts
//   dev         the regular member (was the unnamed "user" role). Adds sub-tasks only
//   qa          a dev's rights plus the QA verdict (pass / send back for rework)
//   designlead  a team lead for design: adds stories, plans sprints, leads designers
//   designer    a dev's rights, for design work. Adds sub-tasks only
//
// Stored as `user:{name}.role`. A regular account written before roles existed has
// no role at all — it reads as `dev`, so nobody's access changed when roles arrived.
//
// Each role is capped by its own bucket in the role policy (lib/role-policy.js). The
// dev bucket keeps its historic key `user` so stored policies stay valid.

const ROLES = [
  { key: 'superadmin', label: 'Super admin' },
  { key: 'admin', label: 'Admin' },
  { key: 'manager', label: 'Manager' },
  { key: 'teamlead', label: 'Team lead' },
  { key: 'designlead', label: 'Design lead' },
  { key: 'dev', label: 'Dev' },
  { key: 'designer', label: 'Designer' },
  { key: 'qa', label: 'QA' },
]

// Roles an admin assigns to a team member. Admin and superadmin are made elsewhere
// (Admin → Admins, superadmin only).
const MEMBER_ROLES = ['manager', 'teamlead', 'designlead', 'dev', 'designer', 'qa']

// Policy buckets, in the order the role-policy page shows them.
const POLICY_BUCKETS = [
  { key: 'admin', role: 'admin', label: 'Admin' },
  { key: 'manager', role: 'manager', label: 'Manager' },
  { key: 'teamlead', role: 'teamlead', label: 'Team lead' },
  { key: 'user', role: 'dev', label: 'Dev' },
  { key: 'qa', role: 'qa', label: 'QA' },
  { key: 'designlead', role: 'designlead', label: 'Design lead' },
  { key: 'designer', role: 'designer', label: 'Designer' },
]

// '' / 'user' / anything unknown → dev. Never widens access: an unknown string lands
// on the most limited member role.
function normRole(role) {
  const r = typeof role === 'string' ? role.trim().toLowerCase() : ''
  if (r === 'user' || r === 'viewer' || r === '') return 'dev'
  return ROLES.some(x => x.key === r) ? r : 'dev'
}

function roleLabel(role) {
  const r = normRole(role)
  return ROLES.find(x => x.key === r).label
}

// The policy bucket that caps this role.
function ceilingKey(role) {
  const r = normRole(role)
  if (r === 'dev') return 'user'
  if (r === 'superadmin') return 'admin'
  return r
}

function ceilingFor(policy, role) {
  if (!policy) return []
  return policy[ceilingKey(role)] || policy.user || []
}

// Leads shape the work: they add stories (no nesting floor) and are exempt from the
// status blocklist that holds back devs and QA. Admin and superadmin included.
function isLeadRole(role) {
  const r = normRole(role)
  return r === 'superadmin' || r === 'admin' || r === 'manager' || r === 'teamlead' || r === 'designlead'
}

// Same, for a session user. A legacy superadmin session carries isAdmin with no role.
function isLeadUser(user) {
  if (!user) return false
  if (user.isAdmin === true && !user.role) return true
  return isLeadRole(user.role)
}

// Reports-to ladder (lib/team.js): Dev/QA/Designer → Team lead or Design lead → Manager. A lead must sit
// above the person (a Manager may also report to another Manager, the top rung);
// admins sit outside teams. Shared by the server check and the Admin picker.
const TEAM_RANK = { dev: 0, qa: 0, designer: 0, teamlead: 1, designlead: 1, manager: 2 }
function canLead(leadRole, role) {
  const l = TEAM_RANK[normRole(leadRole)]
  const r = TEAM_RANK[normRole(role)]
  if (l == null || r == null || l === 0) return false
  return l > r || (l === 2 && r === 2)
}

// Whether to show a name as a link to /people/{name} (components/PersonLink.js). A
// hint only — the server (canViewPerson in lib/team.js) decides; a team lead clicking
// someone outside their team gets the page's "no access" message.
function canOpenProfile(user, name) {
  if (!user?.name || !name) return false
  if (user.name === name) return true
  const role = user.role || (user.isAdmin ? 'admin' : '')
  return ['superadmin', 'admin', 'manager', 'teamlead', 'designlead'].includes(role)
}

module.exports = { ROLES, MEMBER_ROLES, POLICY_BUCKETS, normRole, roleLabel, ceilingKey, ceilingFor, isLeadRole, isLeadUser, canLead, canOpenProfile }
