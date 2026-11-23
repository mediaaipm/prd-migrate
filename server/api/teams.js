const { listProjects } = require('../../lib/prd-store')
const { listTasksByVersion } = require('../../lib/task-store')
const { hasPermission, visibleProjects } = require('../../lib/require-permission')
const { getSessionUser } = require('../../lib/session')
const { allProfiles, teamOf, seesAllTeams } = require('../../lib/team')
const { assigneesOf, blank: blankStats, count, finish } = require('../../lib/person-stats')
const blank = () => blankStats(WEEKS)

// GET /api/teams — team details and insights (views/teams.js).
//
// Who sees which teams (lib/team.js):
//   manager, admin, superadmin    every team (seesAllTeams)
//   anyone     the teams they lead, and the teams of leads under them
// A team is a lead plus their direct reports. Numbers come only from projects the
// *caller* can see (assignedProjects + project:view + task:view), so a team never
// opens a project to someone who could not already see it. Stats: lib/person-stats.js.
const WEEKS = 8

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const me = getSessionUser(req)
  if (!me?.name) return res.status(401).json({ error: 'Not signed in.' })

  const profiles = await allProfiles()
  const leadNames = new Set(profiles.filter(p => p.lead).map(p => p.lead))
  let leads
  if (seesAllTeams(me)) {
    leads = [...leadNames]
  } else {
    const under = teamOf(profiles, me.name).map(p => p.name)
    leads = [me.name, ...under].filter(n => leadNames.has(n))
  }
  const byName = new Map(profiles.map(p => [p.name, p]))
  const teams = leads.sort((a, b) => a.localeCompare(b)).map(lead => ({
    lead,
    leadRole: byName.get(lead)?.role || '',
    leadOf: byName.get(lead)?.lead || '',
    members: [lead, ...profiles.filter(p => p.lead === lead).map(p => p.name).sort((a, b) => a.localeCompare(b))],
  }))
  if (!teams.length) return res.status(200).json({ teams: [], projects: [], weeks: WEEKS })

  const people = new Set(teams.flatMap(t => t.members))
  const projects = await visibleProjects(req, await listProjects())
  const allowed = await Promise.all(projects.map(async p =>
    (await hasPermission(req, 'project:view', p.slug)) && (await hasPermission(req, 'task:view', p.slug))))
  const visible = projects.filter((_, i) => allowed[i])

  const now = Date.now()
  const perPerson = new Map([...people].map(n => [n, { ...blank(), projects: new Set() }]))
  // Team totals count a task once even when two members share it.
  const perTeam = new Map(teams.map(t => [t.lead, { stats: blank(), seen: new Set(), projects: new Set() }]))
  const memberTeams = new Map()
  for (const t of teams) for (const m of t.members) memberTeams.set(m, [...(memberTeams.get(m) || []), t.lead])

  const lists = await Promise.all(visible.map(async p => ({ p, groups: await listTasksByVersion(p.slug) })))
  for (const { p, groups } of lists) {
    for (const { version, tasks } of groups) {
      for (const t of tasks) {
        if (t.archived) continue
        const who = assigneesOf(t).filter(n => people.has(n))
        if (!who.length) continue
        const key = `${p.slug}:${version || ''}:${t.id}`
        const touched = new Set()
        for (const n of new Set(who)) {
          const s = perPerson.get(n)
          count(s, t, now); s.projects.add(p.slug)
          for (const lead of memberTeams.get(n) || []) touched.add(lead)
        }
        for (const lead of touched) {
          const tt = perTeam.get(lead)
          if (tt.seen.has(key)) continue
          tt.seen.add(key); tt.projects.add(p.slug)
          count(tt.stats, t, now)
        }
      }
    }
  }

  const strip = s => { const { projects: pr, ...rest } = finish(s); return { ...rest, projects: pr ? pr.size : undefined } }
  return res.status(200).json({
    weeks: WEEKS,
    projects: visible.filter(p => [...perTeam.values()].some(t => t.projects.has(p.slug))).map(p => ({ slug: p.slug, name: p.name || p.slug })),
    teams: teams.map(t => {
      const tt = perTeam.get(t.lead)
      return {
        lead: t.lead,
        leadRole: t.leadRole,
        leadOf: t.leadOf,
        stats: { ...finish(tt.stats), projects: tt.projects.size },
        members: t.members.map(n => ({
          name: n,
          role: byName.get(n)?.role || 'dev',
          isLead: n === t.lead,
          stats: strip(perPerson.get(n)),
        })),
      }
    }),
  })
}
