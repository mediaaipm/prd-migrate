const { listProjects, getBoardColumns } = require('../../lib/prd-store')
const { listTasksByVersion } = require('../../lib/task-store')
const { hasPermission, visibleProjects } = require('../../lib/require-permission')
const { getSessionUser } = require('../../lib/session')
const { getTeam } = require('../../lib/team')

// GET /api/my-tasks — every task assigned to the signed-in account, across the
// projects it can see (assignedProjects + project:view + task:view, per project).
// Open tasks are all returned; done ones only from the last DONE_DAYS. Archived never.
//
// ?view=team — the same, for everyone who reports to the caller (lib/team.js), still
// limited to the projects the *caller* can see: a lead never sees a project through
// their team. `team` lists the members; it is empty for someone nobody reports to.
// A Manager's team is every team (lib/team.js allTeams).
const DONE_DAYS = 30
const MAX_DONE = 100

function names(list) {
  return (Array.isArray(list) ? list : []).map(a => (typeof a === 'object' ? a?.name : a)).filter(Boolean)
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const me = getSessionUser(req)
  if (!me?.name) return res.status(401).json({ error: 'Not signed in.' })
  const team = await getTeam(me.name, me.role)
  const view = req.query.view === 'team' ? 'team' : 'mine'
  const who = new Set(view === 'team' ? team.map(m => m.name) : [me.name])

  const projects = await visibleProjects(req, await listProjects())
  const allowed = await Promise.all(projects.map(async p =>
    (await hasPermission(req, 'project:view', p.slug)) && (await hasPermission(req, 'task:view', p.slug))))
  const mine = projects.filter((_, i) => allowed[i])

  const cutoff = Date.now() - DONE_DAYS * 86400000
  const open = []; const done = []
  const out = await Promise.all(mine.map(async p => {
    const [groups, columns] = await Promise.all([listTasksByVersion(p.slug), getBoardColumns(p.slug)])
    return { p, groups, columns }
  }))

  const projectsOut = []
  for (const { p, groups, columns } of out) {
    let count = 0
    for (const { version, tasks } of groups) {
      const byId = new Map(tasks.map(t => [t.id, t]))
      for (const t of tasks) {
        if (t.archived) continue
        const list = names(t.assignees).concat(t.assignee && typeof t.assignee === 'string' ? [t.assignee] : [])
        if (!list.some(n => who.has(n))) continue
        // Walk up to the story (root task) for context and its epic.
        let story = t
        for (let i = 0; story.parentId && byId.has(story.parentId) && i < 50; i++) story = byId.get(story.parentId)
        const item = {
          id: t.id,
          project: p.slug,
          version,
          seq: t.parentId ? null : (t.seq ?? null),
          number: t.number || '',
          title: t.title,
          status: t.status,
          priority: t.priority || '',
          points: t.points ?? null,
          dueDate: t.dueDate || null,
          isStory: !t.parentId,
          story: t.parentId && story !== t ? { id: story.id, title: story.title } : null,
          assignees: list,
          qaNote: t.status === 'need-rework' ? (t.qa?.note || null) : null,
          updatedAt: t.updatedAt || t.createdAt || null,
        }
        if (t.status === 'done') {
          if (Date.parse(item.updatedAt || 0) >= cutoff) done.push(item)
        } else {
          open.push(item)
        }
        count++
      }
    }
    if (count) projectsOut.push({ slug: p.slug, name: p.name || p.slug, prefix: p.taskPrefix || '', columns: columns || null })
  }

  done.sort((a, b) => (Date.parse(b.updatedAt || 0) || 0) - (Date.parse(a.updatedAt || 0) || 0))
  return res.status(200).json({
    view,
    open, done: done.slice(0, MAX_DONE), projects: projectsOut, doneDays: DONE_DAYS,
    team: team.map(m => ({ name: m.name, role: m.role || 'dev', lead: m.lead, direct: m.direct })),
  })
}
