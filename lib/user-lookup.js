const { Redis } = require('@upstash/redis');
let _kv;
function getKv() { if (!_kv) _kv = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN }); return _kv; }

// Find every user profile whose username matches (case-insensitive), optionally
// excluding one record by name. Returns [{ name, profile }].
async function findUsersByUsername(username, excludeName = null) {
  const uname = (username || '').trim().toLowerCase()
  if (!uname) return []
  const members = await getKv().smembers('assignees')
  const matches = []
  for (const name of (members || [])) {
    if (excludeName && name === excludeName) continue
    const profile = await getKv().hgetall(`user:${name}`) || {}
    if ((profile.username || '').trim().toLowerCase() === uname) matches.push({ name, profile })
  }
  return matches
}

module.exports = { findUsersByUsername }
