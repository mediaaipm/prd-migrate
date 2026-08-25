const { Redis } = require('@upstash/redis')
let _kv;
function getKv() { if (!_kv) _kv = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN }); return _kv; }

function sprintKey(slug) {
  return `sprint:${slug}`
}

async function getSprints(slug) {
  const data = await getKv().get(sprintKey(slug))
  if (!data) return []
  if (Array.isArray(data)) return data
  return [data] // migrate from old single-sprint format
}

async function saveSprints(slug, sprints) {
  await getKv().set(sprintKey(slug), sprints)
}

async function saveSprint(slug, sprint) {
  const sprints = await getSprints(slug)
  const idx = sprints.findIndex(s => s.id === sprint.id)
  if (idx >= 0) sprints[idx] = sprint
  else sprints.push(sprint)
  await saveSprints(slug, sprints)
  return sprint
}

async function deleteSprint(slug, sprintId) {
  const sprints = await getSprints(slug)
  await saveSprints(slug, sprints.filter(s => s.id !== sprintId))
}

async function getSprint(slug, sprintId) {
  const sprints = await getSprints(slug)
  return sprints.find(s => s.id === sprintId) || null
}

// The sprint analytics endpoint defaults to whatever the team is working on now, and
// falls back to the most recent one when nothing is active — so an archive of finished
// sprints still opens on something rather than an empty state.
function pickFocusSprint(sprints, sprintId) {
  const list = Array.isArray(sprints) ? sprints : []
  if (!list.length) return null
  if (sprintId) return list.find(s => s.id === sprintId) || null
  const active = list.find(s => s.status === 'active')
  if (active) return active
  return sortSprintsByDate(list)[0] || null
}

// Newest first. startDate is the intent, createdAt the fallback for sprints that never
// got one.
function sortSprintsByDate(sprints) {
  const key = s => String((s && (s.startDate || s.createdAt)) || '')
  return (Array.isArray(sprints) ? sprints : []).slice().sort((a, b) => {
    const ka = key(a)
    const kb = key(b)
    if (ka === kb) return 0
    return ka < kb ? 1 : -1
  })
}

module.exports = { getSprints, getSprint, saveSprint, saveSprints, deleteSprint, pickFocusSprint, sortSprintsByDate }
