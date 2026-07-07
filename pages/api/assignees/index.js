const { Redis } = require('@upstash/redis');
let _kv;
function getKv() { if (!_kv) _kv = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN }); return _kv; }
const { logAudit } = require('../../../lib/audit-log')
const { requirePermission } = require('../../../lib/require-permission')

const KEY = 'assignees'

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const members = await getKv().smembers(KEY)
    const names = (members || []).sort()
    const profiles = await Promise.all(names.map(async name => {
      const profile = await getKv().hgetall(`user:${name}`) || {}
      return { name, username: profile.username || '', hasPassword: !!profile.password, role: profile.role || '' }
    }))
    return res.json(profiles)
  }

  if (req.method === 'POST') {
    if (!requirePermission('assignee:manage')(req, res)) return
    const { name, username, password } = req.body || {}
    if (!name || !name.trim()) return res.status(400).json({ error: 'name required' })
    const trimName = name.trim()
    await getKv().sadd(KEY, trimName)
    await getKv().hset(`user:${trimName}`, {
      username: username?.trim() || '',
      password: password || '',
    })
    await logAudit(req, 'create_user', 'user', { name: trimName })
    return res.status(201).json({ name: trimName })
  }

  res.status(405).end()
}
