// Groups — a named bundle of permissions + project visibility that a superadmin
// can drop users into. A user's effective access is their personal grant merged
// with every group they belong to (see lib/user-access.js).
//
// Redis keys:
//   groups              -> set of group ids
//   group:{id}          -> the group record (JSON string)
//   user-groups:{name}  -> set of group ids that user belongs to (reverse index,
//                          so a permission check costs one smembers, not a scan)
const { Redis } = require('@upstash/redis')
const { ALL_PERMISSIONS } = require('./permissions')
const { slugify } = require('./slugify')

let _kv
function getKv() { if (!_kv) _kv = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN }); return _kv }

const INDEX_KEY = 'groups'
const keyFor = id => `group:${id}`
const userKeyFor = name => `user-groups:${name}`

function sanitizePerms(list) {
  if (!Array.isArray(list)) return []
  return [...new Set(list.filter(p => ALL_PERMISSIONS.includes(p)))]
}

// null means "every project"; an array restricts to those slugs.
function sanitizeProjects(list) {
  if (list === null) return null
  if (!Array.isArray(list)) return null
  return [...new Set(list.map(s => String(s || '').trim()).filter(Boolean))]
}

function sanitizeMembers(list) {
  if (!Array.isArray(list)) return []
  return [...new Set(list.map(s => String(s || '').trim()).filter(Boolean))]
}

function parse(raw) {
  if (raw == null) return null
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) } catch { return null }
  }
  return typeof raw === 'object' ? raw : null
}

function shape(src) {
  const s = src && typeof src === 'object' ? src : {}
  return {
    id: s.id,
    name: s.name || s.id,
    description: s.description || '',
    permissions: sanitizePerms(s.permissions),
    assignedProjects: sanitizeProjects(s.assignedProjects === undefined ? null : s.assignedProjects),
    members: sanitizeMembers(s.members),
    createdAt: s.createdAt || new Date().toISOString(),
    updatedAt: s.updatedAt || new Date().toISOString(),
  }
}

async function getGroup(id) {
  if (!id) return null
  const raw = parse(await getKv().get(keyFor(id)))
  return raw ? shape({ ...raw, id }) : null
}

async function listGroups() {
  const ids = (await getKv().smembers(INDEX_KEY)) || []
  const groups = await Promise.all(ids.map(id => getGroup(id)))
  return groups.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name))
}

// Rewrites the reverse index for the members that joined or left.
async function reindexMembers(id, before, after) {
  const kv = getKv()
  const added = after.filter(m => !before.includes(m))
  const removed = before.filter(m => !after.includes(m))
  await Promise.all([
    ...added.map(m => kv.sadd(userKeyFor(m), id)),
    ...removed.map(m => kv.srem(userKeyFor(m), id)),
  ])
}

class GroupError extends Error {
  constructor(message, status = 400) { super(message); this.status = status }
}

async function createGroup({ name, description, permissions, assignedProjects, members }) {
  const trimmed = String(name || '').trim()
  if (!trimmed) throw new GroupError('name required')
  const id = slugify(trimmed)
  if (!id) throw new GroupError('name must contain at least one letter or digit')
  if (await getKv().sismember(INDEX_KEY, id)) throw new GroupError('A group with that name already exists.', 409)
  const group = shape({ id, name: trimmed, description, permissions, assignedProjects, members })
  await getKv().set(keyFor(id), JSON.stringify(group))
  await getKv().sadd(INDEX_KEY, id)
  await reindexMembers(id, [], group.members)
  return group
}

// Only the fields present in `patch` are touched.
async function updateGroup(id, patch) {
  const existing = await getGroup(id)
  if (!existing) throw new GroupError('Group not found.', 404)
  const next = shape({
    ...existing,
    ...(patch.name !== undefined ? { name: String(patch.name).trim() || existing.name } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.permissions !== undefined ? { permissions: patch.permissions } : {}),
    ...(patch.assignedProjects !== undefined ? { assignedProjects: patch.assignedProjects } : {}),
    ...(patch.members !== undefined ? { members: patch.members } : {}),
    id,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  })
  await getKv().set(keyFor(id), JSON.stringify(next))
  await reindexMembers(id, existing.members, next.members)
  return next
}

async function deleteGroup(id) {
  const existing = await getGroup(id)
  if (!existing) return false
  await reindexMembers(id, existing.members, [])
  await getKv().del(keyFor(id))
  await getKv().srem(INDEX_KEY, id)
  return true
}

// Every group a user belongs to. Falls back to a full scan when the reverse index
// is missing (groups created before the index existed, or a half-applied write).
async function getGroupsForUser(name) {
  if (!name) return []
  let ids = []
  try { ids = (await getKv().smembers(userKeyFor(name))) || [] } catch {}
  if (ids.length) {
    const groups = await Promise.all(ids.map(id => getGroup(id)))
    const found = groups.filter(g => g && g.members.includes(name))
    if (found.length === ids.length) return found
  }
  const all = await listGroups()
  return all.filter(g => g.members.includes(name))
}

// Membership edits that do not disturb the rest of the group record.
async function addMembers(id, names) {
  const existing = await getGroup(id)
  if (!existing) throw new GroupError('Group not found.', 404)
  return updateGroup(id, { members: [...existing.members, ...sanitizeMembers(names)] })
}

async function removeMember(id, name) {
  const existing = await getGroup(id)
  if (!existing) throw new GroupError('Group not found.', 404)
  return updateGroup(id, { members: existing.members.filter(m => m !== name) })
}

// Replace a user's whole group membership in one call (the per-user editor).
async function setUserGroups(name, ids) {
  const want = sanitizeMembers(ids)
  const all = await listGroups()
  await Promise.all(all.map(g => {
    const should = want.includes(g.id)
    const has = g.members.includes(name)
    if (should === has) return null
    return updateGroup(g.id, {
      members: should ? [...g.members, name] : g.members.filter(m => m !== name),
    })
  }).filter(Boolean))
  return want.filter(id => all.some(g => g.id === id))
}

// Called when a user is deleted or renamed so no group points at a ghost.
async function removeUserFromAllGroups(name) {
  const groups = await getGroupsForUser(name)
  await Promise.all(groups.map(g => removeMember(g.id, name)))
  try { await getKv().del(userKeyFor(name)) } catch {}
  return groups.map(g => g.id)
}

module.exports = {
  listGroups,
  getGroup,
  createGroup,
  updateGroup,
  deleteGroup,
  getGroupsForUser,
  addMembers,
  removeMember,
  setUserGroups,
  removeUserFromAllGroups,
  GroupError,
}
