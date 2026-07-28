#!/usr/bin/env node
//
// Read-only inventory of the Upstash store. Writes nothing, deletes nothing.
//
//   node scripts/store-report.js                 # summary by key prefix
//   node scripts/store-report.js --top 20        # plus the largest individual keys
//   node scripts/store-report.js --json out.json # machine-readable, for diffing over time
//
// Sizes come from Redis MEMORY USAGE where the plan allows it and fall back to the
// serialized length of the value. Both are estimates; the ranking is what matters.
//
// Costs one SCAN page per 500 keys plus one sizing call per key, so it is cheap but
// not free on a large store. Run it deliberately, not on a tight schedule.

require('dotenv').config({ path: '.env.local' })
const fs = require('fs')
const { Redis } = require('@upstash/redis')

const kv = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
})

const args = process.argv.slice(2)
const flag = (name, fallback = null) => {
  const i = args.indexOf(name)
  return i === -1 ? fallback : (args[i + 1] || true)
}
const TOP_N = Number(flag('--top', 20))
const JSON_OUT = flag('--json', null)

// `task:slug:id` and `taskhistory:slug:version:id` should roll up to one row each,
// so a prefix is the leading non-identifier segments.
function prefixOf(key) {
  const parts = key.split(':')
  if (parts.length === 1) return key
  return parts[0] + ':*'
}

function human(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

function median(nums) {
  if (!nums.length) return 0
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2)
}

async function scanAll() {
  const keys = []
  let cursor = '0'
  do {
    const [next, batch] = await kv.scan(cursor, { count: 500 })
    cursor = String(next)
    keys.push(...batch)
    if (keys.length % 5000 === 0) process.stderr.write(`  …${keys.length} keys\n`)
  } while (cursor !== '0')
  return keys
}

let memoryUsageSupported = true

async function sizeOf(key) {
  if (memoryUsageSupported) {
    try {
      const n = await kv.memory.usage(key)
      if (typeof n === 'number' && n > 0) return n
    } catch {
      // Not available on this plan — stop asking and fall back for every key.
      memoryUsageSupported = false
    }
  }
  try {
    const type = await kv.type(key)
    let value
    if (type === 'string') value = await kv.get(key)
    else if (type === 'list') value = await kv.lrange(key, 0, -1)
    else if (type === 'set') value = await kv.smembers(key)
    else if (type === 'zset') value = await kv.zrange(key, 0, -1)
    else if (type === 'hash') value = await kv.hgetall(key)
    else return 0
    return Buffer.byteLength(JSON.stringify(value ?? ''), 'utf8')
  } catch {
    return 0
  }
}

// Timestamps embedded in ids are the only write-time signal in the store — redis
// keeps none of its own. snapshot:snap-<ms> and task-<ms>-<rand> both carry one.
function stampOf(key) {
  const m = key.match(/(?:^|[:-])(1\d{12})(?:$|[-:])/)
  return m ? new Date(Number(m[1])).toISOString() : null
}

async function main() {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    console.error('Missing UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN. Set them in .env.local.')
    process.exit(1)
  }

  process.stderr.write('Scanning keys…\n')
  const keys = await scanAll()
  process.stderr.write(`Sizing ${keys.length} keys…\n`)

  const rows = []
  const CONCURRENCY = 16
  for (let i = 0; i < keys.length; i += CONCURRENCY) {
    const chunk = keys.slice(i, i + CONCURRENCY)
    const sizes = await Promise.all(chunk.map(sizeOf))
    chunk.forEach((key, j) => rows.push({ key, bytes: sizes[j], stamp: stampOf(key) }))
  }

  const total = rows.reduce((n, r) => n + r.bytes, 0)

  const byPrefix = new Map()
  for (const r of rows) {
    const p = prefixOf(r.key)
    if (!byPrefix.has(p)) byPrefix.set(p, { prefix: p, count: 0, bytes: 0, sizes: [], oldest: null, newest: null })
    const g = byPrefix.get(p)
    g.count++
    g.bytes += r.bytes
    g.sizes.push(r.bytes)
    if (r.stamp) {
      if (!g.oldest || r.stamp < g.oldest) g.oldest = r.stamp
      if (!g.newest || r.stamp > g.newest) g.newest = r.stamp
    }
  }

  const groups = [...byPrefix.values()]
    .map(g => ({ ...g, median: median(g.sizes), pct: total ? (g.bytes / total) * 100 : 0 }))
    .sort((a, b) => b.bytes - a.bytes)

  console.log(`\nTotal: ${human(total)} across ${rows.length} keys\n`)
  console.log('PREFIX                     COUNT        TOTAL     MEDIAN    %  OLDEST → NEWEST')
  console.log('─'.repeat(100))
  for (const g of groups) {
    const span = g.oldest ? `${g.oldest.slice(0, 10)} → ${g.newest.slice(0, 10)}` : '—'
    console.log(
      g.prefix.padEnd(24) +
      String(g.count).padStart(7) +
      human(g.bytes).padStart(13) +
      human(g.median).padStart(11) +
      (g.pct.toFixed(1) + '%').padStart(7) + '  ' + span
    )
  }

  const top = [...rows].sort((a, b) => b.bytes - a.bytes).slice(0, TOP_N)
  console.log(`\nTop ${top.length} keys by size`)
  console.log('─'.repeat(100))
  for (const r of top) {
    console.log(human(r.bytes).padStart(11) + '  ' + r.key + (r.stamp ? `   (${r.stamp.slice(0, 10)})` : ''))
  }

  if (!memoryUsageSupported) {
    console.log('\nNote: MEMORY USAGE unavailable on this plan — sizes are serialized-value estimates.')
  }

  if (JSON_OUT && typeof JSON_OUT === 'string') {
    fs.writeFileSync(JSON_OUT, JSON.stringify({ totalBytes: total, keyCount: rows.length, groups: groups.map(({ sizes, ...g }) => g), top }, null, 2))
    console.log(`\nWrote ${JSON_OUT}`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
