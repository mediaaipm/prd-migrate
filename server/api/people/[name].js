const { listProjects, getBoardColumns } = require('../../../lib/prd-store')
const { listTasksByVersion } = require('../../../lib/task-store')
const { hasPermission, visibleProjects } = require('../../../lib/require-permission')
const { getSessionUser } = require('../../../lib/session')
const { allProfiles, canViewPerson } = require('../../../lib/team')
const { DAY, assigneesOf, parseDue, doneAt, blank, count, finish } = require('../../../lib/person-stats')

// GET /api/people/{name}[?project=slug] — one person's performance (views/people/[name].js).
//
// Who may look (lib/team.js canViewPerson): yourself; a team lead for anyone under them;
// managers and admins for everyone. Numbers come only from projects the *caller* can see
// (assignedProjects + project:view + task:view), as on the Teams page. The name need not
// be a current account: work assigned to a removed person still counts.
const WEEKS = 12
const LIST_MAX = 50

function item(t, slug, version, byId) {
  let story = t
  for (let i = 0; story.parentId && byId.has(story.parentId) && i < 50; i++) story = byId.get(story.parentId)
  return {
    id: t.id, project: slug, version,
    seq: t.parentId ? null : (t.seq ?? null),
    title: t.title, status: t.status, priority: t.priority || '',
    points: t.points ?? null, dueDate: t.dueDate || null, isStory: !t.parentId,
    story: t.parentId && story !== t ? { id: story.id, title: story.title } : null,
    doneAt: t.status === 'done' ? new Date(doneAt(t)).toISOString() : null,
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const me = getSessionUser(req)
  if (!me?.name) return res.status(401).json({ error: 'Not signed in.' })
  const name = String(req.query.name || '').trim()
  if (!name) return res.status(400).json({ error: 'Name required.' })

  const profiles = await allProfiles()
  if (!canViewPerson(profiles, me, name)) {
    return res.status(403).json({ error: 'You can see your own performance, and a team lead can see their team. Managers and admins can see everyone.' })
  }
  const profile = profiles.find(p => p.name === name) || null

  const projects = await visibleProjects(req, await listProjects())
  const allowed = await Promise.all(projects.map(async p =>
    (await hasPermission(req, 'project:view', p.slug)) && (await hasPermission(req, 'task:view', p.slug))))
  const only = typeof req.query.project === 'string' ? req.query.project : ''
  const visible = projects.filter((p, i) => allowed[i] && (!only || p.slug === only))

  const now = Date.now()
  const cutoff = now - 30 * DAY
  const stats = blank(WEEKS)
  // Not about their own tasks: comments they wrote, QA verdicts they gave.
  const extra = { comments30: 0, reviewed30: { pass: 0, rework: 0 } }
  const byProject = []
  const open = []; const done = []

  const lists = await Promise.all(visible.map(async p => ({ p, groups: await listTasksByVersion(p.slug), columns: await getBoardColumns(p.slug) })))
  for (const { p, groups, columns } of lists) {
    const ps = blank(WEEKS)
    for (const { version, tasks } of groups) {
      const byId = new Map(tasks.map(t => [t.id, t]))
      for (const t of tasks) {
        if (t.archived) continue
        // Work they reviewed and comments they wrote count even on tasks they don't own.
        for (const l of (t.qa?.log || [])) {
          if (l.by === name && Date.parse(l.at || 0) >= cutoff) extra.reviewed30[l.verdict === 'pass' ? 'pass' : 'rework']++
        }
        for (const u of (Array.isArray(t.updates) ? t.updates : [])) {
          if (u?.author === name && Date.parse(u.createdAt || 0) >= cutoff) extra.comments30++
        }
        if (!assigneesOf(t).includes(name)) continue
        count(stats, t, now); count(ps, t, now)
        if (t.status === 'done') {
          if (doneAt(t) >= cutoff && done.length < LIST_MAX) done.push(item(t, p.slug, version, byId))
        } else {
          open.push(item(t, p.slug, version, byId))
        }
      }
    }
    if (ps.open || ps.done30 || ps.weekly.some(Boolean)) {
      byProject.push({ slug: p.slug, name: p.name || p.slug, prefix: p.taskPrefix || '', columns: columns || null, open: ps.open, overdue: ps.overdue, done30: ps.done30, points30: ps.points30, openPoints: ps.openPoints })
    }
  }

  done.sort((a, b) => Date.parse(b.doneAt) - Date.parse(a.doneAt))
  open.sort((a, b) => (parseDue(a.dueDate) ?? Infinity) - (parseDue(b.dueDate) ?? Infinity))
  return res.status(200).json({
    name,
    exists: !!profile,
    role: profile?.role || (profile ? 'dev' : ''),
    lead: profile?.lead || '',
    reports: profiles.filter(p => p.lead === name).map(p => p.name).sort((a, b) => a.localeCompare(b)),
    weeks: WEEKS,
    project: only || null,
    projects: visible.map(p => ({ slug: p.slug, name: p.name || p.slug })),
    stats: finish(stats),
    comments30: extra.comments30,
    reviewed30: extra.reviewed30,
    byProject: byProject.sort((a, b) => b.open + b.done30 - (a.open + a.done30)),
    open: open.slice(0, LIST_MAX),
    openTotal: open.length,
    done,
  })
}
