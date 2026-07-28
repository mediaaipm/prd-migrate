// Effective access for one account: their personal grant merged with every group
// they belong to. This is the single place that answers "what may this person do,
// and which projects may they see" before the role policy ceiling is applied.
//
// Personal fields live on `user:{name}`:
//   permissions      -> JSON array. Absent = unset (fall back to the role policy).
//   assignedProjects -> JSON array of slugs, or the literal `null` for "all
//                       projects". Absent = unset.
//
// Merge rules:
//   permissions: union of every source that defines one; null when nobody does.
//   projects:    null (= all) if any source says all or nobody restricts;
//                otherwise the union of the restricted lists.
const { Redis } = require('@upstash/redis')
const { getGroupsForUser } = require('./group-store')
const { VIEW_PERMISSIONS, PERMS_VERSION } = require('./permissions')

let _kv
function getKv() { if (!_kv) _kv = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN, enableAutoPipelining: true }); return _kv }

// undefined = the field was never set; null = set to "all"; array = a list.
function parseField(value) {
  if (value === undefined || value === null || value === '') return undefined
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (parsed === null) return null
      return Array.isArray(parsed) ? parsed : undefined
    } catch { return undefined }
  }
  return undefined
}

// A permission list stored before the visibility permissions existed says nothing
// about them — reading it literally would lock the account out of every page. Grant
// the view perms (audit stays where it was) until the list is re-saved.
function upgradeLegacyPerms(perms, profile) {
  if (!Array.isArray(perms)) return perms
  if (Number(profile.permsV) >= PERMS_VERSION) return perms
  const views = VIEW_PERMISSIONS.filter(p => p !== 'audit:view')
  return [...new Set([...perms, ...views])]
}

async function getProfile(name) {
  if (!name) return {}
  try { return (await getKv().hgetall(`user:${name}`)) || {} } catch { return {} }
}

// A single request runs several permission checks (project access, then one per
// resource), so the same lookup would hit Redis three or four times. Memoise the
// in-flight promise briefly — short enough that an access change still lands
// within a couple of seconds.
const CACHE_TTL_MS = 2000
const cache = new Map()

// { permissions: string[]|null, projects: string[]|null, groups: [{id,name}],
//   personal: { permissions, projects } }
function getUserAccess(name) {
  if (!name) return Promise.resolve({ permissions: null, projects: null, groups: [], personal: { permissions: undefined, projects: undefined } })
  const hit = cache.get(name)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.promise
  const promise = loadUserAccess(name).catch(err => { cache.delete(name); throw err })
  cache.set(name, { at: Date.now(), promise })
  return promise
}

async function loadUserAccess(name) {
  const [profile, groups] = await Promise.all([getProfile(name), getGroupsForUser(name)])

  const personalPerms = upgradeLegacyPerms(parseField(profile.permissions), profile)
  const personalProjects = parseField(profile.assignedProjects)

  const permSources = []
  if (Array.isArray(personalPerms)) permSources.push(personalPerms)
  // A group that grants nothing is a pure project-scoping group — it must not
  // count as a source, or it would zero out someone who otherwise inherits.
  for (const g of groups) if (Array.isArray(g.permissions) && g.permissions.length) permSources.push(g.permissions)
  const permissions = permSources.length ? [...new Set(permSources.flat())] : null

  // A single "all projects" source wins — access is additive, never subtractive.
  let projects
  const projectSources = [personalProjects, ...groups.map(g => g.assignedProjects)]
    .filter(p => p !== undefined)
  if (!projectSources.length || projectSources.some(p => p === null)) {
    projects = null
  } else {
    projects = [...new Set(projectSources.flat())]
  }

  return {
    permissions,
    projects,
    groups: groups.map(g => ({ id: g.id, name: g.name })),
    personal: { permissions: personalPerms, projects: personalProjects },
  }
}

function canSeeProject(access, slug) {
  if (!access || access.projects === null) return true
  return access.projects.includes(slug)
}

module.exports = { getUserAccess, canSeeProject, parseField }
