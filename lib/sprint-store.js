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

module.exports = { getSprints, saveSprint, deleteSprint }
