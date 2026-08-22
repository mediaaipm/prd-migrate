// Role policy — the superadmin-defined capability set for the `user` (viewer) and
// `admin` roles, plus the viewer status blocklist. Policies are PER PROJECT:
//   role-policy          -> global default (fallback for any project without one)
//   role-policy:{slug}   -> that project's override (full policy, not a merge)
//
// A project with no override inherits the global default. Enforcement loads the
// effective policy per request in the project-scoped API routes.
const { Redis } = require('@upstash/redis')
const { ALL_PERMISSIONS, VIEW_PERMISSIONS, DEFAULT_ROLE_POLICY } = require('./permissions')

// Bumped when the permission catalogue grows in a way a stored policy could not
// have opted into. v1 policies predate the `*:view` permissions, so applying one
// verbatim would silently blind every user — see upgrade() below.
const POLICY_VERSION = 2

let _kv
function getKv() { if (!_kv) _kv = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN, enableAutoPipelining: true }); return _kv }

const GLOBAL_KEY = 'role-policy'
const keyFor = slug => `role-policy:${slug}`

// Keep only known permission strings, de-duplicated.
function sanitize(list, fallback) {
  if (!Array.isArray(list)) return [...fallback]
  return [...new Set(list.filter(p => ALL_PERMISSIONS.includes(p)))]
}

// Status keys are free-form (custom columns are per-project). Mirrors slugify()
// in components/KanbanBoard.js so a restricted key matches a column's key.
function normStatus(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function sanitizeStatuses(list, fallback) {
  if (!Array.isArray(list)) return [...fallback]
  return [...new Set(list.map(normStatus).filter(Boolean))]
}

function isStatusRestricted(list, status) {
  if (!Array.isArray(list) || !status) return false
  return list.map(normStatus).includes(normStatus(status))
}

// A stored policy with no version predates the visibility permissions. Grant them
// (audit stays admin-only) so an upgrade never takes away access someone had.
function upgrade(shaped, src) {
  if (!src || typeof src !== 'object') return shaped
  if (Number(src.v) >= 2) return shaped
  const views = VIEW_PERMISSIONS.filter(p => p !== 'audit:view')
  return {
    ...shaped,
    user: [...new Set([...shaped.user, ...views])],
    admin: [...new Set([...shaped.admin, ...VIEW_PERMISSIONS])],
  }
}

function shape(src, fallback) {
  const s = src && typeof src === 'object' ? src : {}
  return upgrade({
    v: POLICY_VERSION,
    user: sanitize(s.user, fallback.user),
    admin: sanitize(s.admin, fallback.admin),
    userRestrictedStatuses: sanitizeStatuses(s.userRestrictedStatuses, fallback.userRestrictedStatuses),
  }, src)
}

async function readKey(key) {
  let raw
  try { raw = await getKv().get(key) } catch { raw = null }
  if (raw == null) return null
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) } catch { return null }
  }
  return typeof raw === 'object' ? raw : null
}

// Every permission check resolves a policy, and a single request runs several —
// worse, an image-heavy board fires one media request per attachment, each of which
// read `role-policy` and `role-policy:{slug}` from redis all over again. Memoise the
// in-flight read briefly; writes bust it, so a save in /settings/roles is still
// visible immediately. Mirrors getUserAccess() in lib/user-access.js.
const CACHE_TTL_MS = 2000
const cache = new Map()

function readKeyCached(key) {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.promise
  const promise = readKey(key).catch(err => { cache.delete(key); throw err })
  cache.set(key, { at: Date.now(), promise })
  return promise
}

// The global default (falls back to the built-in DEFAULT_ROLE_POLICY).
async function getGlobalRolePolicy() {
  return shape(await readKeyCached(GLOBAL_KEY), DEFAULT_ROLE_POLICY)
}

// A project's own override, or null if it inherits the global default.
async function getProjectPolicyRaw(slug) {
  if (!slug) return null
  const raw = await readKeyCached(keyFor(slug))
  return raw ? shape(raw, DEFAULT_ROLE_POLICY) : null
}

// What actually applies to a project: its override if set, else the global default.
async function getEffectiveRolePolicy(slug) {
  if (slug) {
    const own = await getProjectPolicyRaw(slug)
    if (own) return own
  }
  return getGlobalRolePolicy()
}

// Writes stamp the current version, so an explicit save may revoke a view
// permission without upgrade() handing it straight back.
async function setGlobalRolePolicy(policy) {
  const clean = shape({ ...policy, v: POLICY_VERSION }, DEFAULT_ROLE_POLICY)
  await getKv().set(GLOBAL_KEY, JSON.stringify(clean))
  cache.delete(GLOBAL_KEY)
  return clean
}

async function setProjectRolePolicy(slug, policy) {
  const clean = shape({ ...policy, v: POLICY_VERSION }, DEFAULT_ROLE_POLICY)
  await getKv().set(keyFor(slug), JSON.stringify(clean))
  cache.delete(keyFor(slug))
  return clean
}

// Drop a project's override so it inherits the global default again.
async function clearProjectRolePolicy(slug) {
  await getKv().del(keyFor(slug))
  cache.delete(keyFor(slug))
}

module.exports = {
  getGlobalRolePolicy,
  getProjectPolicyRaw,
  getEffectiveRolePolicy,
  setGlobalRolePolicy,
  setProjectRolePolicy,
  clearProjectRolePolicy,
  isStatusRestricted,
  normStatus,
}
