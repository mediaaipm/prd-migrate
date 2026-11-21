const { getSprintConfig, setSprintConfig, cadenceDates, todayISO } = require('../../../../lib/sprint-store')
const { logAudit } = require('../../../../lib/audit-log')
const { requirePermission, requireProjectAccess } = require('../../../../lib/require-permission')

// The project's sprint cadence: length in weeks, the weekday a sprint starts on and the
// weekday it ends on, and whether the daily rollover closes / starts sprints by itself.
export default async function handler(req, res) {
  const { slug } = req.query
  if (!await requireProjectAccess(slug, req, res)) return

  if (req.method === 'GET') {
    if (!await requirePermission('sprint:view', slug)(req, res)) return
    const config = await getSprintConfig(slug)
    return res.status(200).json({ config, preview: cadenceDates(config, todayISO()) })
  }
  if (req.method === 'PUT') {
    if (!await requirePermission('project:update', slug)(req, res)) return
    const config = await setSprintConfig(slug, req.body || {})
    await logAudit(req, 'update_sprint_config', 'sprint', { slug, ...config })
    return res.status(200).json({ config, preview: cadenceDates(config, todayISO()) })
  }
  res.status(405).json({ error: 'Method not allowed' })
}
