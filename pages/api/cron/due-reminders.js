const { listProjects } = require('../../../lib/prd-store')
const { listTasks } = require('../../../lib/task-store')
const { addNotification } = require('../../../lib/notification-store')

// Daily scan: notify assignees of tasks that are overdue or due within 24h.
// Runs once/day (see vercel.json) so each task yields at most one notification per day.
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

  let sent = 0
  const projects = await listProjects()
  for (const p of projects) {
    const tasks = await listTasks(p.slug, null)
    for (const t of tasks) {
      if (t.archived || t.status === 'done' || !t.dueDate) continue
      const due = new Date(t.dueDate)
      const overdue = due < now
      const dueSoon = !overdue && due <= soon
      if (!overdue && !dueSoon) continue
      const link = `/projects/${p.slug}/tasks`
      const text = overdue ? `Task "${t.title}" is overdue` : `Task "${t.title}" is due soon`
      for (const name of (Array.isArray(t.assignees) ? t.assignees : [])) {
        await addNotification(name, { type: 'due', text, link })
        sent++
      }
    }
  }
  return res.status(200).json({ ok: true, sent })
}
