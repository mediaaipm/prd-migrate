const { listProjects } = require('../../../lib/prd-store')
const { listTasks } = require('../../../lib/task-store')
const { addNotification } = require('../../../lib/notification-store')

// Every 4h (see vercel.json): re-notify assignees of tasks whose due date was pushed back
// and that are still open. Flag is set in the task PUT handler; cleared when the task is done.
export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.authorization || ''
    if (auth !== `Bearer ${secret}` && req.headers['x-cron-secret'] !== secret) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
  }

  let sent = 0
  const projects = await listProjects()
  for (const p of projects) {
    const tasks = await listTasks(p.slug, null)
    for (const t of tasks) {
      if (t.archived || t.status === 'done' || !t.dueDelayed) continue
      const when = t.dueDate ? new Date(t.dueDate).toLocaleDateString() : ''
      const link = `/projects/${p.slug}/tasks`
      const text = `Reminder: "${t.title}" due date was delayed${when ? ` to ${when}` : ''}`
      for (const name of (Array.isArray(t.assignees) ? t.assignees : [])) {
        await addNotification(name, { type: 'due-delayed', text, link })
        sent++
      }
    }
  }
  return res.status(200).json({ ok: true, sent })
}
