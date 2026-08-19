const { listProjects } = require('../../../lib/prd-store')
const { loadTasks } = require('../../../lib/task-store')
const { addNotifications } = require('../../../lib/notification-store')

// Re-notify assignees of tasks whose due date was pushed back and that are still open.
// Flag is set in the task PUT handler; cleared when the task is done.
//
// Same shape as due-reminders, and for the same reason: `loadTasks` rather than
// `listTasks` (no numbering pass, no write-on-read seq backfill), all projects loaded
// in one pipelined batch, and one notification write per recipient instead of one per
// task.
export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.authorization || ''
    if (auth !== `Bearer ${secret}` && req.headers['x-cron-secret'] !== secret) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
  }

  const projects = await listProjects()
  const lists = await Promise.all(projects.map(p => loadTasks(p.slug, null)))

  const batch = new Map()
  const queue = (name, entry) => {
    if (!name) return
    const cur = batch.get(name)
    if (cur) cur.push(entry)
    else batch.set(name, [entry])
  }

  projects.forEach((p, i) => {
    const link = `/projects/${p.slug}/tasks`
    for (const t of lists[i]) {
      if (t.archived || t.status === 'done' || !t.dueDelayed) continue
      const when = t.dueDate ? new Date(t.dueDate).toLocaleDateString() : ''
      const text = `Reminder: "${t.title}" due date was delayed${when ? ` to ${when}` : ''}`
      for (const name of (Array.isArray(t.assignees) ? t.assignees : [])) {
        queue(name, { type: 'due-delayed', text, link })
      }
    }
  })

  const written = await Promise.all([...batch].map(([name, entries]) => addNotifications(name, entries)))
  const sent = written.reduce((n, made) => n + made.length, 0)
  return res.status(200).json({ ok: true, sent })
}
