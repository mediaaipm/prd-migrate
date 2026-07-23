/**
 * One-time migration: rewrite plaintext `user:{name}.password` values in Redis as
 * scrypt hashes.
 *
 *   node scripts/hash-passwords.js --dry-run   # report only
 *   node scripts/hash-passwords.js             # write
 *
 * Safe to re-run: already-hashed records are skipped. Logins keep working during
 * and after the migration — the login route verifies both formats and upgrades a
 * plaintext record itself on next successful sign-in — so this script just
 * finishes the job for accounts that have not logged in yet.
 */
require('dotenv').config({ path: '.env.local' })

const { Redis } = require('@upstash/redis')
const { hashPassword, isHashed } = require('../lib/password')

const kv = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
})

const dryRun = process.argv.includes('--dry-run')

async function main() {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    console.error('UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not set (.env.local).')
    process.exit(1)
  }

  const names = (await kv.smembers('assignees')) || []
  let hashed = 0, skipped = 0, empty = 0

  for (const name of names) {
    const profile = (await kv.hgetall(`user:${name}`)) || {}
    const pw = profile.password
    if (!pw) { empty++; continue }
    if (isHashed(pw)) { skipped++; continue }

    if (dryRun) {
      console.log(`would hash: ${name}`)
    } else {
      await kv.hset(`user:${name}`, { password: hashPassword(String(pw)) })
      console.log(`hashed: ${name}`)
    }
    hashed++
  }

  console.log('')
  console.log(`${dryRun ? '[dry run] ' : ''}${hashed} hashed, ${skipped} already hashed, ${empty} with no password, ${names.length} users total.`)
}

main().catch(e => { console.error(e); process.exit(1) })
