const { Redis } = require('@upstash/redis')
let _kv;
// Auto-pipelining: commands issued in the same tick leave as one HTTP request. That is
// what makes the Promise.all in listAdmins() a single round trip instead of N, and it
// matches the client task-store already builds.
function getKv() { if (!_kv) _kv = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN, enableAutoPipelining: true }); return _kv; }

const MAX = 100
function key(name) { return `notifications:${name}` }

// A batch mints several entries inside the same millisecond, so the timestamp alone no
// longer separates them. The counter does.
let minted = 0

function makeEntry({ type, text, link } = {}) {
  minted = (minted + 1) % 1679616
  return {
    id: `ntf-${Date.now()}-${minted.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    type: type || 'info',
    text: text || '',
    link: link || null,
    read: false,
    createdAt: new Date().toISOString(),
  }
}

// Prepend several notifications to one recipient's list in a single read-modify-write.
//
// The list is one redis value, so every write is a GET of all 100 entries, a parse, an
// unshift, a stringify and a SET. The due-date crons called that once per task per
// assignee — a few hundred sequential round trips, and a few hundred parse/stringify
// pairs, to produce what is really one update per person. Callers that know their full
// set of recipients up front should group by recipient and come here instead.
//
// `entries` are given oldest-first; the stored list is newest-first.
async function addNotifications(name, entries) {
  if (!name || !entries || !entries.length) return []
  const built = entries.map(makeEntry)
  const list = (await getKv().get(key(name))) || []
  list.unshift(...built.slice().reverse())
  await getKv().set(key(name), list.slice(0, MAX))
  return built
}

// Recipients are keyed by assignee `name` (same identity used across tasks/audit).
async function addNotification(name, entry) {
  const [made] = await addNotifications(name, [entry])
  return made || null
}

// Names of all admin / super-admin users (role stored on the user:{name} hash).
async function listAdmins() {
  const kv = getKv()
  const names = (await kv.smembers('assignees')) || []
  // Issued together, not in a for-await loop: this was an N+1 that grew a round trip
  // with every user on the instance, on a path both crons hit first thing.
  const profiles = await Promise.all(names.map(n => kv.hgetall(`user:${n}`).catch(() => null)))
  return names.filter((_, i) => {
    const role = profiles[i] && profiles[i].role
    return role === 'admin' || role === 'superadmin'
  })
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

    // Collected per recipient, written once each at the end. A single edit can reach the
    // same person from all three branches below — newly assigned, due date moved, and
    // mentioned in the comment explaining why — and each of those was its own full
    // read-modify-write of their list.
    const batch = new Map()
    const queue = (name, entry) => {
      if (!name || name === actorName) return
      const cur = batch.get(name)
      if (cur) cur.push(entry)
      else batch.set(name, [entry])
    }

    if (Array.isArray(updates.assignees)) {
      const prev = new Set(Array.isArray(before.assignees) ? before.assignees : [])
      for (const name of updates.assignees) {
        if (prev.has(name)) continue
        queue(name, { type: 'assigned', text: `${actorName || 'Someone'} assigned you to "${title}"`, link })
      }
    }

    // Due-date pushed later → tell the assignees. Repeated every 4h by the delayed-reminders cron.
    if (updates.dueDate && before.dueDate && new Date(updates.dueDate) > new Date(before.dueDate)) {
      const when = new Date(updates.dueDate).toLocaleDateString()
      const recipients = Array.isArray(updates.assignees) ? updates.assignees : (before.assignees || [])
      for (const name of recipients) {
        queue(name, { type: 'due-delayed', text: `Due date for "${title}" was delayed to ${when}`, link })
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
        queue(name, { type: 'mention', text: `${actorName || 'Someone'} mentioned you on "${title}"`, link })
      }
    }

    await Promise.all([...batch].map(([name, entries]) => addNotifications(name, entries)))
  } catch {}
}

module.exports = { addNotification, addNotifications, listNotifications, listAdmins, markRead, markAllRead, notifyTaskChange }
