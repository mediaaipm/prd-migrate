/**
 * One-time: grant the full permission list to every secondary admin (role: 'admin').
 * The single primary admin (role: 'superadmin') is unaffected — it bypasses all checks.
 *
 * Run: node scripts/grant-all-admin-permissions.js
 * Requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (from .env.local).
 */
require('dotenv').config({ path: '.env.local' });

const { Redis } = require('@upstash/redis');
const { ALL_PERMISSIONS } = require('../lib/permissions');

const kv = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

async function run() {
  const members = (await kv.smembers('assignees')) || [];
  let updated = 0;
  for (const name of members) {
    const profile = (await kv.hgetall(`user:${name}`)) || {};
    if (profile.role !== 'admin') continue;
    await kv.hset(`user:${name}`, { permissions: JSON.stringify(ALL_PERMISSIONS) });
    console.log(`  ✓ ${name} -> ${ALL_PERMISSIONS.length} permissions`);
    updated++;
  }
  console.log(`Done. Updated ${updated} secondary admin(s).`);
}

run().catch(e => { console.error(e); process.exit(1); });
