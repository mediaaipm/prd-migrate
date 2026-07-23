// Durable client-side write queue.
//
// enqueue() persists a mutation to localStorage and returns immediately, so the UI
// never blocks on the network. A background drain sends items one at a time, in
// order, and only drops an item once the server has accepted it.
//
// Items carry an `optimistic` descriptor (see lib/optimistic.js) describing the
// change they will eventually make. Views render `server data + replay of pending
// descriptors`, which is why a refetch can never wipe a not-yet-synced write, and
// why the optimistic view rebuilds itself after a page reload.
//
// Ordering is strict FIFO across the whole queue, not per-entity. A create and a
// later edit of the same row therefore always reach the server in the order the
// user made them.

import { apiFetch } from './api-fetch'

const QUEUE_KEY = 'sq:v1:queue'
const LOCK_KEY = 'sq:v1:lock'

// Only one tab drains at a time, otherwise two tabs replay the same POST.
// The leader rewrites the lock on this interval; a lock older than LOCK_STALE_MS
// belonged to a tab that was closed or suspended and may be stolen.
const LOCK_RENEW_MS = 2000
const LOCK_STALE_MS = 6000

const MAX_ATTEMPTS = 8
const BASE_BACKOFF_MS = 500
const MAX_BACKOFF_MS = 30000

const isBrowser = typeof window !== 'undefined'

// Identifies this tab in the leader lock. Not persisted.
const TAB_ID = isBrowser ? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` : 'ssr'

const listeners = new Set()
const syncListeners = new Set()

let draining = false
let drainTimer = null
let renewTimer = null

// --- id generation -----------------------------------------------------------

// Client-generated entity id. The server accepts this verbatim (see task-store.js),
// which is what lets a queued create be referenced by later queued writes — a
// sub-task can name its parent before the parent has reached the database — and what
// makes a replayed POST idempotent.
export function newId(prefix = 'task') {
  const rand = isBrowser && window.crypto?.randomUUID
    ? window.crypto.randomUUID().replace(/-/g, '').slice(0, 16)
    : Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10)
  return `${prefix}-${Date.now().toString(36)}-${rand}`
}

// --- persistence -------------------------------------------------------------

// Set only once a localStorage write has failed (quota, private mode, disabled
// storage). From then on this is the authoritative queue — without it a failed
// setItem would drop the mutation on the floor and the user's save would vanish with
// no error anywhere. Durability across a reload is lost; the write itself is not.
let memQueue = null

function readQueue() {
  if (!isBrowser) return []
  if (memQueue) return memQueue
  try {
    const raw = localStorage.getItem(QUEUE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeQueue(items) {
  if (!isBrowser) return
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(items))
    memQueue = null // persisted again; localStorage is authoritative once more
  } catch {
    memQueue = items
  }
  emit()
}

function emit() {
  const state = getState()
  listeners.forEach(fn => { try { fn(state) } catch {} })
}

// --- public state ------------------------------------------------------------

// 'pending'  — not sent yet (or waiting on a backoff)
// 'syncing'  — the server accepted it; listeners are refetching. Still replayed by the
//              optimistic overlay, because the refetched data has not arrived yet.
// 'parked'   — failed permanently, surfaced to the user
const UNSETTLED = new Set(['pending', 'syncing'])

export function getState() {
  const items = readQueue()
  return {
    items,
    pending: items.filter(i => UNSETTLED.has(i.status)).length,
    parked: items.filter(i => i.status === 'parked'),
  }
}

// Mutations whose result is not yet visible in server data — what the unload guard and
// the optimistic overlay care about. Parked items are failures the user has been told
// about; they must not keep the "saving your progress" warning up forever.
export function getPending() {
  return readQueue().filter(i => UNSETTLED.has(i.status))
}

export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// Fires after an item is accepted by the server, with the parsed response body.
// Pages use this to reconcile (refetch, or read a server-assigned field like `seq`).
// A listener that returns a promise is awaited before the item leaves the overlay —
// return your refetch promise and the row will never flash its pre-write value.
export function onSync(fn) {
  syncListeners.add(fn)
  return () => syncListeners.delete(fn)
}

// Upper bound on how long a slow or stuck listener may keep an accepted item on the
// overlay. Past this the item is settled regardless.
const RECONCILE_TIMEOUT_MS = 8000

async function emitSync(item, response) {
  const waits = []
  syncListeners.forEach(fn => {
    try {
      const r = fn(item, response)
      if (r && typeof r.then === 'function') waits.push(r)
    } catch {}
  })
  if (!waits.length) return
  await Promise.race([
    Promise.allSettled(waits),
    new Promise(r => setTimeout(r, RECONCILE_TIMEOUT_MS)),
  ])
}

// --- enqueue -----------------------------------------------------------------

// The overlay marks rows it has replayed with `_pending`. Those rows are routinely fed
// straight back into an edit form, so strip the marker before it can be PUT to the
// server and persisted as a real field.
function sanitize(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body ?? null
  const out = {}
  for (const [k, v] of Object.entries(body)) if (!k.startsWith('_')) out[k] = v
  return out
}

/**
 * Queue a mutation. Returns synchronously — the caller must not await the network.
 *
 * @param {object} req
 * @param {string} req.url
 * @param {'POST'|'PUT'|'PATCH'|'DELETE'} req.method
 * @param {object} [req.body]        JSON body
 * @param {object} [req.optimistic]  descriptor consumed by lib/optimistic.js
 * @param {string} [req.label]       human name, shown when the item fails
 * @param {boolean} [req.silent]     discard on permanent failure instead of telling the
 *                                   user. For incidental writes they never asked for,
 *                                   like marking a notification read.
 * @returns {object} the queued item
 */
export function enqueue({ url, method, body, optimistic, label, silent }) {
  const item = {
    id: newId('op'),
    url,
    method,
    body: sanitize(body),
    optimistic: optimistic ?? null,
    label: label || `${method} ${url}`,
    silent: !!silent,
    status: 'pending',
    attempts: 0,
    nextAttemptAt: 0,
    error: null,
    createdAt: Date.now(),
  }
  writeQueue([...readQueue(), item])
  kick()
  return item
}

// --- failure classification --------------------------------------------------

// 4xx means the server understood and refused: replaying it will fail identically,
// so the item is parked for the user to retry or discard rather than looping.
// 408/429 are the exceptions — the server is asking us to come back later.
function isPermanent(status) {
  return status >= 400 && status < 500 && status !== 408 && status !== 429
}

function backoffMs(attempts) {
  const exp = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempts)
  return exp / 2 + Math.random() * (exp / 2) // jitter, so parallel tabs don't sync up
}

function updateItem(id, patch) {
  writeQueue(readQueue().map(i => (i.id === id ? { ...i, ...patch } : i)))
}

function removeItem(id) {
  writeQueue(readQueue().filter(i => i.id !== id))
}

// --- cross-tab leader lock ---------------------------------------------------

function readLock() {
  try {
    const raw = localStorage.getItem(LOCK_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function acquireLock() {
  const lock = readLock()
  const now = Date.now()
  if (lock && lock.tab !== TAB_ID && now - lock.ts < LOCK_STALE_MS) return false
  try {
    localStorage.setItem(LOCK_KEY, JSON.stringify({ tab: TAB_ID, ts: now }))
  } catch {
    return false
  }
  // Re-read: if two tabs wrote concurrently, exactly one sees its own id last.
  const confirmed = readLock()
  return !!confirmed && confirmed.tab === TAB_ID
}

function renewLock() {
  try {
    localStorage.setItem(LOCK_KEY, JSON.stringify({ tab: TAB_ID, ts: Date.now() }))
  } catch {}
}

function releaseLock() {
  const lock = readLock()
  if (lock && lock.tab === TAB_ID) {
    try { localStorage.removeItem(LOCK_KEY) } catch {}
  }
}

// --- drain -------------------------------------------------------------------

function nextReady(items, now) {
  return items.find(i => i.status === 'pending' && i.nextAttemptAt <= now)
}

// Wake the drain up when the soonest backoff expires, so a retry doesn't wait for
// an unrelated event to nudge the queue.
function scheduleWake(items) {
  const waits = items.filter(i => i.status === 'pending').map(i => i.nextAttemptAt)
  if (!waits.length) return
  const delay = Math.max(0, Math.min(...waits) - Date.now())
  clearTimeout(drainTimer)
  drainTimer = setTimeout(kick, delay + 25)
}

export function kick() {
  if (!isBrowser || draining) return
  drain()
}

async function drain() {
  if (draining) return
  draining = true
  clearTimeout(drainTimer)

  try {
    while (true) {
      if (!isBrowser || navigator.onLine === false) return

      const items = readQueue()
      const item = nextReady(items, Date.now())
      if (!item) {
        scheduleWake(items)
        return
      }

      if (!acquireLock()) {
        // Another tab owns the drain. Check back once its lock could have gone stale.
        clearTimeout(drainTimer)
        drainTimer = setTimeout(kick, LOCK_STALE_MS)
        return
      }
      clearInterval(renewTimer)
      renewTimer = setInterval(renewLock, LOCK_RENEW_MS)

      await send(item)
    }
  } finally {
    draining = false
    clearInterval(renewTimer)
    renewTimer = null
    releaseLock()
    // An item may have been enqueued while the last send was in flight.
    if (isBrowser && nextReady(readQueue(), Date.now())) setTimeout(kick, 0)
  }
}

async function send(item) {
  let res
  try {
    res = await apiFetch(item.url, {
      method: item.method,
      ...(item.body != null ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item.body) } : {}),
    })
  } catch (err) {
    // Network-level failure (offline, DNS, aborted). Always transient.
    return retryLater(item, err?.message || 'Network error')
  }

  if (res.ok) {
    let payload = null
    try { payload = await res.json() } catch {} // 204 and empty bodies are fine
    // Hand over to the refetch before dropping the item. Removing it first would take
    // the optimistic patch off the row while the listener's GET is still in flight, so
    // a moved card would snap back to its old column and jump forward again a moment
    // later. 'syncing' keeps it on the overlay without making it eligible for resend.
    updateItem(item.id, { status: 'syncing', error: null })
    await emitSync(item, payload)
    removeItem(item.id)
    return
  }

  let message = `Request failed (${res.status})`
  try {
    const body = await res.json()
    if (body?.error) message = body.error
  } catch {}

  if (isPermanent(res.status)) return park(item, message, res.status)
  return retryLater(item, message)
}

function retryLater(item, message) {
  const attempts = item.attempts + 1
  if (attempts >= MAX_ATTEMPTS) return park(item, `${message} (gave up after ${attempts} attempts)`, 0)
  updateItem(item.id, { attempts, error: message, nextAttemptAt: Date.now() + backoffMs(attempts) })
}

// A parked item has stopped retrying. It stays in localStorage so the user can retry
// it after fixing the cause (e.g. signing back in), but it no longer counts as
// pending, so it neither blocks the drain nor keeps the unload warning up.
function park(item, message, status) {
  if (item.silent) return removeItem(item.id)
  updateItem(item.id, { status: 'parked', error: message, httpStatus: status, attempts: item.attempts + 1 })
}

// --- parked item actions -----------------------------------------------------

export function retryParked(id) {
  updateItem(id, { status: 'pending', attempts: 0, nextAttemptAt: 0, error: null })
  kick()
}

export function discardParked(id) {
  removeItem(id)
}

export function retryAllParked() {
  writeQueue(readQueue().map(i => (i.status === 'parked' ? { ...i, status: 'pending', attempts: 0, nextAttemptAt: 0, error: null } : i)))
  kick()
}

export function discardAllParked() {
  writeQueue(readQueue().filter(i => i.status !== 'parked'))
}

// --- lifecycle ---------------------------------------------------------------

if (isBrowser) {
  // Another tab changed the queue (enqueued, or finished an item). Re-render, and
  // pick up the work if that tab has since died.
  window.addEventListener('storage', e => {
    if (e.key === QUEUE_KEY) { emit(); kick() }
  })
  window.addEventListener('online', kick)
  // A backgrounded tab gets its timers throttled; retry as soon as it is looked at.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) kick() })
  window.addEventListener('pagehide', releaseLock)

  // A 'syncing' item left over from a previous session was already accepted by the
  // server — the tab just died before its refetch finished. It is never resent, so drop
  // it, otherwise it would sit on the overlay (and in the "saving…" count) forever.
  const leftover = readQueue()
  if (leftover.some(i => i.status === 'syncing')) {
    writeQueue(leftover.filter(i => i.status !== 'syncing'))
  }

  kick() // resume anything left over from the previous session
}
