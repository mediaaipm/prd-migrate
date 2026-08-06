#!/usr/bin/env node
//
// One-off: move inline base64 attachments out of the task lists and into one key
// per attachment (`taskatt:{slug}:{version}:{taskId}:{attId}`).
//
// Why: a project's tasks are a single redis value. Inlined images grew one list to
// 10.00 MB — Upstash's exact max-request-size ceiling — so every subsequent write,
// including every task create, failed with an opaque 500.
//
//   node scripts/migrate-task-media.js              # dry run, reports only
//   node scripts/migrate-task-media.js --apply      # actually migrate
//
// Safe to re-run: lists with nothing inline are skipped. Byte keys are written
// before the slimmed list is saved, so an interrupted run leaves unreferenced keys
// at worst, never a task pointing at bytes that were never stored.
//
// Runs against a live app, so each list is rewritten under the same write lock the
// API uses — otherwise a task someone edits mid-migration is silently rolled back.

require('dotenv').config({ path: '.env.local' })
const { Redis } = require('@upstash/redis')
const { offloadTasksMedia, attKey, COVER_ATT_ID } = require('../lib/task-media')
const { withTaskLock } = require('../lib/task-store')

const kv = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
})

const APPLY = process.argv.includes('--apply')
const MB = 1048576

function isDataUrl(v) { return typeof v === 'string' && v.startsWith('data:') }

function inlineBytes(tasks) {
  let bytes = 0, count = 0
  for (const t of tasks) {
    for (const a of t?.attachments || []) {
      if (isDataUrl(a?.dataUrl)) { bytes += a.dataUrl.length; count++ }
    }
    if (isDataUrl(t?.cover?.dataUrl)) { bytes += t.cover.dataUrl.length; count++ }
  }
  return { bytes, count }
}

function parseKey(key) {
  // tasks:{slug}:{version} — slugs are kebab-case with no colons, versions are semver.
  const parts = key.split(':')
  const version = parts.pop()
  const slug = parts.slice(1).join(':')
  return { slug, version: version === '__root' ? null : version }
}

async function scanKeys(pattern) {
  const keys = []
  let cursor = '0'
  do {
    const [next, batch] = await kv.scan(cursor, { match: pattern, count: 500 })
    keys.push(...batch)
    cursor = String(next)
  } while (cursor !== '0')
  return keys
}

;(async () => {
  const keys = (await scanKeys('tasks:*')).sort()
  console.log(`${APPLY ? 'MIGRATING' : 'DRY RUN'} — ${keys.length} task lists\n`)

  let totalMoved = 0, totalFreed = 0

  for (const key of keys) {
    const tasks = await kv.get(key)
    if (!Array.isArray(tasks)) { console.log(`${key}: not a task list, skipped`); continue }

    const before = Buffer.byteLength(JSON.stringify(tasks))
    const { bytes, count } = inlineBytes(tasks)
    if (!count) {
      console.log(`${key}: nothing inline (${(before / MB).toFixed(2)} MB) — skipped`)
      continue
    }

    const { slug, version } = parseKey(key)
    console.log(`${key}`)
    console.log(`  ${tasks.length} tasks, ${count} inline attachment(s) = ${(bytes / MB).toFixed(2)} MB`)
    console.log(`  list: ${(before / MB).toFixed(2)} MB -> ~${((before - bytes) / MB).toFixed(2)} MB`)

    if (!APPLY) { totalMoved += count; totalFreed += bytes; continue }

    await withTaskLock(slug, version, async () => {
      // Re-read INSIDE the lock — `tasks` above is a snapshot taken without it.
      const fresh = await kv.get(key)
      if (!Array.isArray(fresh)) { console.log('  vanished, skipped'); return }

      // Writes the byte keys, returns the slimmed records.
      const slimmed = await offloadTasksMedia(slug, version, fresh)

      // Verify every moved attachment is readable from its new home before the list
      // that referenced it inline is overwritten.
      let missing = 0
      for (const t of slimmed) {
        for (const a of t?.attachments || []) {
          if (!a?.id || isDataUrl(a.dataUrl)) continue
          if (!isDataUrl(await kv.get(attKey(slug, version, t.id, a.id)))) {
            console.log(`  !! missing bytes for ${t.id}/${a.id}`)
            missing++
          }
        }
        if (t?.cover?.stored && !isDataUrl(await kv.get(attKey(slug, version, t.id, COVER_ATT_ID)))) {
          console.log(`  !! missing cover bytes for ${t.id}`)
          missing++
        }
      }
      if (missing) {
        console.log(`  ABORTED for this list — ${missing} attachment(s) did not land. Original left untouched.`)
        return
      }

      const after = Buffer.byteLength(JSON.stringify(slimmed))
      await kv.set(key, slimmed)
      console.log(`  saved: ${(after / MB).toFixed(2)} MB`)
      totalMoved += count
      totalFreed += bytes
    })
  }

  console.log(`\n${APPLY ? 'Moved' : 'Would move'} ${totalMoved} attachment(s), ${(totalFreed / MB).toFixed(2)} MB out of the task lists.`)
  if (!APPLY) console.log('Re-run with --apply to write.')
})().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
