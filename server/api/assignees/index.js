const { Redis } = require('@upstash/redis');
let _kv;
function getKv() { if (!_kv) _kv = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN, enableAutoPipelining: true }); return _kv; }
const { logAudit } = require('../../../lib/audit-log')
const { requirePermission } = require('../../../lib/require-permission')
const { hashPassword } = require('../../../lib/password')
const { getSessionUser } = require('../../../lib/session')
const { sendJsonConfig } = require('../../../lib/etag')
const { MEMBER_ROLES } = require('../../../lib/roles')

const KEY = 'assignees'

export default async function handler(req, res) {
  if (req.method === 'GET') {
    if (!getSessionUser(req)) return res.status(401).json({ error: 'Not signed in.' })
    const members = await getKv().smembers(KEY)
    const names = (members || []).sort()
    const profiles = await Promise.all(names.map(async name => {
      const profile = await getKv().hgetall(`user:${name}`) || {}
      return { name, username: profile.username || '', hasPassword: !!profile.password, role: profile.role || '', lead: profile.lead || '' }
    }))
    // Browser-cached for a minute; readers use assigneesUrl() (lib/config-cache.js),
    // which the admin page re-keys whenever it reloads users.
    return sendJsonConfig(res, profiles)
  }

  if (req.method === 'POST') {
    if (!await requirePermission('assignee:manage')(req, res)) return
    const { name, username, password, role } = req.body || {}
    if (!name || !name.trim()) return res.status(400).json({ error: 'name required' })
    const trimName = name.trim()
    // New members are Dev unless a team role is picked. Manager needs an admin;
    // admin/superadmin are never created here.
    const wanted = typeof role === 'string' && role ? role.trim().toLowerCase() : 'dev'
    if (!MEMBER_ROLES.includes(wanted)) return res.status(400).json({ error: 'Unknown role.' })
    const me = getSessionUser(req) || {}
    const meAdmin = me.role === 'admin' || me.role === 'superadmin' || (me.isAdmin === true && !me.role)
    if (wanted === 'manager' && !meAdmin) return res.status(403).json({ error: 'Only an admin can make someone a Manager.' })
    // Adding a name that already exists must not overwrite that account (an admin's
    // role and password included).
    if (await getKv().sismember(KEY, trimName)) return res.status(409).json({ error: `"${trimName}" already exists.` })
    await getKv().sadd(KEY, trimName)
    await getKv().hset(`user:${trimName}`, {
      username: username?.trim() || '',
      password: password ? hashPassword(password) : '',
      role: wanted,
    })
    await logAudit(req, 'create_user', 'user', { name: trimName })
    return res.status(201).json({ name: trimName })
  }

  res.status(405).end()
}
