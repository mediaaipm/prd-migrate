const { listProjects } = require('../../../lib/prd-store')
const { applyCadence } = require('../../../lib/sprint-store')
const { notifySprintEvents } = require('../../../lib/sprint-notify')

// Daily: for every project, close an active sprint whose end date has passed (carrying
// its unfinished stories into the next sprint) and start the next planned sprint once
// its start date arrives. The sprint GET applies the same rule on read, so this is the
// guarantee for projects nobody opens, not the only trigger.
//
// Fails closed: without CRON_SECRET this endpoint refuses every caller, because it
// mutates every project.
export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.authorization || ''
  if (!secret || (auth !== `Bearer ${secret}` && req.headers['x-cron-secret'] !== secret)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const projects = await listProjects()
  const results = []
  for (const p of projects) {
    if (p.status === 'archived') continue
    try {
      const { events } = await applyCadence(p.slug)
      if (events.length) await notifySprintEvents(p.slug, events, null)
      results.push({ slug: p.slug, events: events.map(e => e.type) })
    } catch (e) {
      results.push({ slug: p.slug, error: e.message })
    }
  }
  res.status(200).json({ ok: true, results })
}
