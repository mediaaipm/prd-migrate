// Teams: who reports to whom. `user:{name}.lead` holds the name of the person's team
// lead (blank = nobody). A lead's team is everyone who reports to them, directly or
// through another lead. Managers and admins see every team (allTeams, seesAllTeams).
//
// Set in Admin → Users (PUT /api/assignees/{name} { lead }, assignee:manage). The lead
// must sit above the person on the ladder Dev/QA → Team lead → Manager (`canLead` in
// lib/roles.js; Manager → Manager is allowed). A role change re-checks both the
// person's own link and their reports' (`brokenLinks`). Read by GET /api/my-tasks?view=team.
const { Redis } = require('@upstash/redis')
const { canLead, roleLabel } = require('./roles')

let _kv
function getKv() { if (!_kv) _kv = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN, enableAutoPipelining: true }); return _kv }

const TEAM_LEAD_ROLES = ['teamlead', 'manager']
const MAX_DEPTH = 10

// [{ name, role, lead }] for every account in the assignee set.
async function allProfiles() {
  const kv = getKv()
  const names = (await kv.smembers('assignees')) || []
  const profiles = await Promise.all(names.map(n => kv.hgetall(`user:${n}`).catch(() => null)))
  return names.map((name, i) => ({ name, role: profiles[i]?.role || '', lead: profiles[i]?.lead || '' }))
}

// Everyone under `leadName`: [{ name, role, lead, direct }], direct reports first.
function teamOf(profiles, leadName) {
  const out = []
  const seen = new Set([leadName])
  let frontier = [leadName]
  for (let depth = 0; frontier.length && depth < MAX_DEPTH; depth++) {
    const next = profiles.filter(p => p.lead && frontier.includes(p.lead) && !seen.has(p.name))
    for (const p of next) { seen.add(p.name); out.push({ ...p, direct: depth === 0 }) }
    frontier = next.map(p => p.name)
  }
  return out
}

// Managers see every team: anyone who reports to someone, plus each team lead who has
// people under them. Their own reports stay `direct`. Everyone else sees their own tree.
function allTeams(profiles, managerName) {
  const leads = new Set(profiles.filter(p => p.lead).map(p => p.lead))
  return profiles
    .filter(p => p.name !== managerName && p.role !== 'admin' && p.role !== 'superadmin' && (p.lead || leads.has(p.name)))
    .map(p => ({ ...p, direct: p.lead === managerName }))
    // Each team together, its lead first: sort by the lead's name, then lead, then name.
    .sort((a, b) => {
      const ta = leads.has(a.name) ? a.name : a.lead
      const tb = leads.has(b.name) ? b.name : b.lead
      return ta.localeCompare(tb) || (leads.has(b.name) - leads.has(a.name)) || a.name.localeCompare(b.name)
    })
}

// Managers and admins see every team (Teams page, My tasks → My team); everyone else
// sees the people under them.
function seesAllTeams(user) {
  const role = user?.role || (user?.isAdmin ? 'admin' : '')
  return role === 'manager' || role === 'admin' || role === 'superadmin'
}

async function getTeam(name, role) {
  const profiles = await allProfiles()
  return seesAllTeams({ role }) ? allTeams(profiles, name) : teamOf(profiles, name)
}

// Why `lead` cannot be `name`'s lead, or null. Walks up from the proposed lead: if it
// reaches `name`, the change would make a loop.
function leadError(profiles, name, lead) {
  if (lead === name) return 'Someone cannot be their own team lead.'
  const target = profiles.find(p => p.name === lead)
  if (!target) return 'That team lead does not exist.'
  if (!TEAM_LEAD_ROLES.includes(target.role)) return 'Only a Team lead or Manager can lead a team.'
  const self = profiles.find(p => p.name === name)
  if (self && !canLead(target.role, self.role)) {
    return self.role === 'manager'
      ? 'A Manager can only report to another Manager.'
      : `A ${roleLabel(self.role)} cannot report to a ${roleLabel(target.role)} — the lead must be above them.`
  }
  let cur = target
  for (let i = 0; cur && cur.lead && i < MAX_DEPTH; i++) {
    if (cur.lead === name) return `${lead} already reports to ${name} — that would make a loop.`
    cur = profiles.find(p => p.name === cur.lead)
  }
  return null
}

// After `name`'s role becomes `role`: the links that no longer fit the ladder — their
// own lead, and any direct report they can no longer lead. Names whose lead to clear.
function brokenLinks(profiles, name, role) {
  const self = profiles.find(p => p.name === name)
  const out = []
  if (self?.lead) {
    const lead = profiles.find(p => p.name === self.lead)
    if (!lead || !canLead(lead.role, role)) out.push(name)
  }
  for (const p of profiles) if (p.lead === name && !canLead(role, p.role)) out.push(p.name)
  return out
}

// Whose performance page (/people/{name}) `viewer` (session user) may open: their own;
// everyone for managers and admins; a team lead (or anyone with reports) for the people
// under them, directly or through another lead. Mirrored for links by canOpenProfile()
// in lib/roles.js — this is the check that counts.
function canViewPerson(profiles, viewer, name) {
  if (!viewer?.name) return false
  if (viewer.name === name) return true
  if (seesAllTeams(viewer)) return true
  return teamOf(profiles, viewer.name).some(p => p.name === name)
}

module.exports = { TEAM_LEAD_ROLES, allProfiles, teamOf, allTeams, getTeam, leadError, brokenLinks, canViewPerson, seesAllTeams }
