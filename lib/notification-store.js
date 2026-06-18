const { Redis } = require('@upstash/redis')
let _kv;
function getKv() { if (!_kv) _kv = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN }); return _kv; }

const MAX = 100
function key(name) { return `notifications:${name}` }

// Recipients are keyed by assignee `name` (same identity used across tasks/audit).
async function addNotification(name, { type, text, link } = {}) {
  if (!name) return null
  const list = (await getKv().get(key(name))) || []
  const entry = {
    id: `ntf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: type || 'info',
    text: text || '',
    link: link || null,
    read: false,
    createdAt: new Date().toISOString(),
  }
  list.unshift(entry)
  await getKv().set(key(name), list.slice(0, MAX))
  return entry
}

async function listNotifications(name) {
  if (!name) return []
  return (await getKv().get(key(name))) || []
}

async function markRead(name, id) {
  const list = (await getKv().get(key(name))) || []
  let changed = false
  for (const n of list) if (n.id === id && !n.read) { n.read = true; changed = true }
  if (changed) await getKv().set(key(name), list)
  return changed
}

async function markAllRead(name) {
  const list = (await getKv().get(key(name))) || []
  for (const n of list) n.read = true
  await getKv().set(key(name), list)
  return list
}

// Emit notifications from a task PUT diff (new assignees, @mentions in new comments).
// Mentions are resolved client-side and carried on each comment as `mentions: [name]`.
// Never throws — notifications must not break the main flow.
async function notifyTaskChange(actorName, { slug, version, before, updates } = {}) {
  try {
    if (!before || !updates) return
    const title = updates.title || before.title || 'a task'
    const link = `/projects/${slug}/tasks${version ? `?version=${version}` : ''}`

    if (Array.isArray(updates.assignees)) {
      const prev = new Set(Array.isArray(before.assignees) ? before.assignees : [])
      for (const name of updates.assignees) {
        if (prev.has(name) || name === actorName) continue
        await addNotification(name, { type: 'assigned', text: `${actorName || 'Someone'} assigned you to "${title}"`, link })
      }
    }

    if (Array.isArray(updates.updates)) {
      const beforeIds = new Set((before.updates || []).map(u => u.id))
      const mentioned = new Set()
      for (const u of updates.updates) {
        if (beforeIds.has(u.id)) continue
        (u.mentions || []).forEach(m => mentioned.add(m))
      }
      for (const name of mentioned) {
        if (name === actorName) continue
        await addNotification(name, { type: 'mention', text: `${actorName || 'Someone'} mentioned you on "${title}"`, link })
      }
    }
  } catch {}
}

module.exports = { addNotification, listNotifications, markRead, markAllRead, notifyTaskChange }
