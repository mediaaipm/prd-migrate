const { listProjects } = require('../../../lib/prd-store')
const { loadTasks } = require('../../../lib/task-store')
const { addNotifications, listAdmins } = require('../../../lib/notification-store')

// Daily scan: notify assignees of tasks that are overdue or due within 24h.
// Runs once/day (see vercel.json) so each task yields at most one notification per day.
//
// This is one of the most CPU-dense invocations in the app — it touches every task of
// every project — so it reads with `loadTasks`, not `listTasks`. listTasks runs
// computeNumbers() over the whole list (a deep copy plus a recursive sort) to build
// `number`/`autoNumber` that nothing below reads, and it can trigger the lazy seq
// backfill, which is a WRITE. Neither belongs on a scan that only wants dueDate,
// status and assignees.
export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.authorization || ''
    if (auth !== `Bearer ${secret}` && req.headers['x-cron-secret'] !== secret) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
  }

  const now = new Date()
  const soon = new Date(now)
  soon.setDate(now.getDate() + 1)

  const [admins, projects] = await Promise.all([listAdmins(), listProjects()])

  // Independent GETs, so they go out together — the task-store client pipelines them
  // into one request rather than one round trip per project.
  const lists = await Promise.all(projects.map(p => loadTasks(p.slug, null)))

  // recipient -> pending entries. Flushed once per person at the end: a notification
  // list is a single redis value, so writing them one at a time re-read and re-wrote
  // every recipient's whole list for each task they own.
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
      if (t.archived || t.status === 'done' || !t.dueDate) continue
      const due = new Date(t.dueDate)
      const overdue = due < now
      const dueSoon = !overdue && due <= soon
      if (!overdue && !dueSoon) continue
      const assignees = Array.isArray(t.assignees) ? t.assignees : []
      const text = overdue ? `Task "${t.title}" is overdue` : `Task "${t.title}" is due soon`
      for (const name of assignees) {
        queue(name, { type: 'due', text, link })
      }
      // Flag overdue tasks to admins so they can follow up with whoever owns them.
      if (overdue) {
        const who = assignees.length ? assignees.join(', ') : 'nobody'
        const adminText = `Overdue: "${t.title}" (${who}) passed its due date`
        for (const admin of admins) {
          if (assignees.includes(admin)) continue // already notified above
          queue(admin, { type: 'due', text: adminText, link })
        }
      }
    }
  })

  const written = await Promise.all([...batch].map(([name, entries]) => addNotifications(name, entries)))
  const sent = written.reduce((n, made) => n + made.length, 0)
  return res.status(200).json({ ok: true, sent })
}
