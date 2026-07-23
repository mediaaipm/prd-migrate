const { Redis } = require('@upstash/redis');
const { withTaskLock } = require('./task-store');
const { hashPassword } = require('./password');
let _kv;
function getKv() { if (!_kv) _kv = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN }); return _kv; }

const ASSIGNEES = 'assignees'

class RenameError extends Error {
  constructor(message, status) { super(message); this.status = status || 400 }
}

// Every redis list that holds tasks for a project (root list + one per version).
async function taskListKeys(slug) {
  const versions = (await getKv().smembers(`versions:${slug}`)) || []
  return [...versions.map(v => `tasks:${slug}:${v}`), `tasks:${slug}:__root`]
}

function renameInTask(task, oldName, newName) {
  let changed = false
  const out = { ...task }
  if (Array.isArray(task.assignees) && task.assignees.includes(oldName)) {
    out.assignees = task.assignees.map(a => (a === oldName ? newName : a))
    changed = true
  }
  if (task.assignee === oldName) { out.assignee = newName; changed = true }
  if (task.assignedBy === oldName) { out.assignedBy = newName; changed = true }
  if (task.createdBy === oldName) { out.createdBy = newName; changed = true }
  return changed ? out : task
}

// Rewrite every stored reference to `oldName` — project members and task
// assignments across all versions — plus the user's own notification list.
async function cascadeRename(oldName, newName) {
  const kv = getKv()
  const slugs = (await kv.smembers('projects')) || []

  for (const slug of slugs) {
    const meta = await kv.get(`project:${slug}`)
    if (meta && Array.isArray(meta.members) && meta.members.includes(oldName)) {
      await kv.set(`project:${slug}`, {
        ...meta,
        members: meta.members.map(m => (m === oldName ? newName : m)),
      })
    }

    for (const key of await taskListKeys(slug)) {
      const suffix = key.slice(`tasks:${slug}:`.length)
      const version = suffix === '__root' ? null : suffix
      // Same load→save cycle the task store uses, so a rename can't overwrite a task
      // someone is creating at that moment.
      await withTaskLock(slug, version, async () => {
        const tasks = await kv.get(key)
        if (!Array.isArray(tasks) || !tasks.length) return
        let changed = false
        const next = tasks.map(t => {
          const updated = renameInTask(t, oldName, newName)
          if (updated !== t) changed = true
          return updated
        })
        if (changed) await kv.set(key, next)
      })
    }
  }

  const notifications = await kv.get(`notifications:${oldName}`)
  if (notifications) {
    await kv.set(`notifications:${newName}`, notifications)
    await kv.del(`notifications:${oldName}`)
  }
}

// Rename a user (any role) and cascade the new name to every reference.
// Optionally updates credentials in the same write. Throws RenameError.
async function renameUser(oldName, newName, { username, password } = {}) {
  const kv = getKv()
  const trimmed = (newName || '').trim()
  if (!trimmed) throw new RenameError('New name required.')

  const members = (await kv.smembers(ASSIGNEES)) || []
  if (!members.includes(oldName)) throw new RenameError('User not found.', 404)
  if (trimmed !== oldName && members.includes(trimmed)) {
    throw new RenameError('A user with that name already exists.', 409)
  }

  const existing = (await kv.hgetall(`user:${oldName}`)) || {}
  const profile = {
    ...existing,
    username: username !== undefined ? (username || '').trim() : (existing.username || ''),
    // A blank field means "keep current"; anything else is hashed before storage.
    password: password !== undefined && password !== '' ? hashPassword(password) : (existing.password || ''),
  }

  if (trimmed === oldName) {
    await kv.hset(`user:${oldName}`, profile)
    return { name: oldName, renamed: false }
  }

  await kv.sadd(ASSIGNEES, trimmed)
  await kv.hset(`user:${trimmed}`, profile)
  await kv.srem(ASSIGNEES, oldName)
  await kv.del(`user:${oldName}`)
  await cascadeRename(oldName, trimmed)

  return { name: trimmed, renamed: true }
}

module.exports = { renameUser, RenameError }
