// Role policy — the superadmin-defined capability set for the `user` (viewer) and
// `admin` roles, plus the viewer status blocklist. Policies are PER PROJECT:
//   role-policy          -> global default (fallback for any project without one)
//   role-policy:{slug}   -> that project's override (full policy, not a merge)
//
// A project with no override inherits the global default. Enforcement loads the
// effective policy per request in the project-scoped API routes.
const { Redis } = require('@upstash/redis')
const { ALL_PERMISSIONS, DEFAULT_ROLE_POLICY } = require('./permissions')

let _kv
function getKv() { if (!_kv) _kv = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN }); return _kv }

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

function shape(src, fallback) {
  const s = src && typeof src === 'object' ? src : {}
  return {
    user: sanitize(s.user, fallback.user),
    admin: sanitize(s.admin, fallback.admin),
    userRestrictedStatuses: sanitizeStatuses(s.userRestrictedStatuses, fallback.userRestrictedStatuses),
  }
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

// The global default (falls back to the built-in DEFAULT_ROLE_POLICY).
async function getGlobalRolePolicy() {
  return shape(await readKey(GLOBAL_KEY), DEFAULT_ROLE_POLICY)
}

// A project's own override, or null if it inherits the global default.
async function getProjectPolicyRaw(slug) {
  if (!slug) return null
  const raw = await readKey(keyFor(slug))
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

async function setGlobalRolePolicy(policy) {
  const clean = shape(policy, DEFAULT_ROLE_POLICY)
  await getKv().set(GLOBAL_KEY, JSON.stringify(clean))
  return clean
}

async function setProjectRolePolicy(slug, policy) {
  const clean = shape(policy, DEFAULT_ROLE_POLICY)
  await getKv().set(keyFor(slug), JSON.stringify(clean))
  return clean
}

// Drop a project's override so it inherits the global default again.
async function clearProjectRolePolicy(slug) {
  await getKv().del(keyFor(slug))
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
