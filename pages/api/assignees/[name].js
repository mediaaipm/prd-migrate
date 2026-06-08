const { Redis } = require('@upstash/redis');
let _kv;
function getKv() { if (!_kv) _kv = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN }); return _kv; }
const { logAudit } = require('../../../lib/audit-log')
const { requirePermission } = require('../../../lib/require-permission')

const KEY = 'assignees'

export default async function handler(req, res) {
  const { name } = req.query

  if (req.method === 'DELETE') {
    if (!requirePermission('assignee:manage')(req, res)) return
    await getKv().srem(KEY, name)
    await getKv().del(`user:${name}`)
    await logAudit(req, 'delete_user', 'user', { name })
    return res.status(204).end()
  }

  if (req.method === 'PUT') {
    const { username, password } = req.body || {}
    const existing = await getKv().hgetall(`user:${name}`) || {}
    await getKv().hset(`user:${name}`, {
      username: username !== undefined ? username.trim() : (existing.username || ''),
      password: password !== undefined && password !== '' ? password : (existing.password || ''),
    })
    await logAudit(req, 'update_user_credentials', 'user', { name, changedFields: [username !== undefined && 'username', password ? 'password' : null].filter(Boolean) })
    return res.json({ ok: true })
  }

  res.status(405).end()
}
