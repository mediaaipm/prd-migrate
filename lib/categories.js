import { useEffect, useState } from 'react'
import { apiFetch } from './api-fetch'
import { COL_COLORS } from './kanban-columns'

// Categories are the middle axis of the board: story lane › category rail › status
// column. A category is a *field* on a task, never a task itself — so "Backend" is
// one thing per project instead of one throwaway parent task per story, and
// "show me all backend work" is a filter rather than an impossibility.
//
// Storage mirrors board columns exactly (`categories:{slug}`, server is truth,
// localStorage is a first-paint cache, super admin writes). `id` is an immutable
// slug and `name` is the renameable display text — the same split as a column's
// `status`/`label`, so renaming a category never touches a single task.
export const CAT_COLORS = COL_COLORS

// Offered by the manager as a one-click starting point. Deliberately NOT applied
// automatically: a project with no categories should show no rails at all rather
// than inherit somebody else's idea of how work divides up.
export const STARTER_CATEGORIES = [
  { id: 'frontend',   name: 'Frontend',   color: '#3b82f6' },
  { id: 'backend',    name: 'Backend',    color: '#06b6d4' },
  { id: 'ui-ux',      name: 'UI/UX',      color: '#ec4899' },
  { id: 'qa',         name: 'QA',         color: '#8b5cf6' },
  { id: 'data-entry', name: 'Data Entry', color: '#f59e0b' },
]

// The rail every task without an effective category falls into. Not a stored
// category — never written to a task, never returned by the API.
export const UNCATEGORISED = { id: '', name: 'Uncategorised', color: '#94a3b8' }

const CHANGE_EVENT = 'task-cats-change'

export function categoriesKey(slug) {
  return `task-cats:${slug}`
}

export function categorySlug(name, existingIds = []) {
  const base = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'category'
  const set = new Set(existingIds)
  if (!set.has(base)) return base
  let i = 2
  while (set.has(`${base}-${i}`)) i++
  return `${base}-${i}`
}

// Cached copy — empty until the server answers. Unlike columns there is no default
// set: no categories configured is a legitimate, common state.
export function readCategories(slug) {
  if (typeof window === 'undefined' || !slug) return []
  try {
    const saved = localStorage.getItem(categoriesKey(slug))
    const parsed = saved && JSON.parse(saved)
    if (Array.isArray(parsed)) return parsed
  } catch {}
  return []
}

// `storage` only fires in *other* tabs, so broadcast in-tab too — the board, the
// list and the calendar can all be mounted at once.
function cacheCategories(slug, categories) {
  if (typeof window === 'undefined' || !slug) return
  try { localStorage.setItem(categoriesKey(slug), JSON.stringify(categories)) } catch {}
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { slug } }))
}

export async function fetchCategories(slug) {
  if (!slug) return []
  const res = await apiFetch(`/api/projects/${slug}/categories`)
  if (!res.ok) throw new Error('Failed to load categories')
  const { categories } = await res.json()
  const next = Array.isArray(categories) ? categories : []
  cacheCategories(slug, next)
  return next
}

// Super admin only — the API rejects everyone else with 403.
export async function saveCategories(slug, categories) {
  if (!slug) return []
  const res = await apiFetch(`/api/projects/${slug}/categories`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ categories }),
  })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to save categories')
  const { categories: saved } = await res.json()
  cacheCategories(slug, saved)
  return saved
}

export function useCategories(slug) {
  const [categories, setCategories] = useState(() => readCategories(slug))

  useEffect(() => {
    let live = true
    setCategories(readCategories(slug))
    fetchCategories(slug).then(c => { if (live) setCategories(c) }).catch(() => {})
    const reread = e => {
      if (e.detail && e.detail.slug !== slug) return
      if (e.key && e.key !== categoriesKey(slug)) return
      setCategories(readCategories(slug))
    }
    window.addEventListener(CHANGE_EVENT, reread)
    window.addEventListener('storage', reread)
    return () => {
      live = false
      window.removeEventListener(CHANGE_EVENT, reread)
      window.removeEventListener('storage', reread)
    }
  }, [slug])

  return categories
}

export function categoryMap(categories) {
  const map = {}
  for (const c of (categories || [])) map[c.id] = c
  return map
}

// A task's own category, else the nearest ancestor that has one, else none. Set
// "Backend" once on a mid-level task and everything under it follows — and a task
// nested four deep still lands in a sensible rail instead of falling out of the
// board. `byId` is a plain id → task map of the whole (unfiltered) task list.
export function effectiveCategory(task, byId) {
  let cur = task
  const seen = new Set()
  while (cur && !seen.has(cur.id)) {
    if (cur.category) return cur.category
    seen.add(cur.id)
    cur = cur.parentId ? byId[cur.parentId] : null
  }
  return ''
}

export function taskIndex(tasks) {
  const byId = {}
  for (const t of (tasks || [])) byId[t.id] = t
  return byId
}

// --- Rail roll-up -----------------------------------------------------------
// A department rail has no status of its own — it is a label, not a task — so its
// state is derived from the cards sitting in it. This is what answers "UI/UX is
// done, Backend is in progress" without inventing a status field on a category.
//
// `waiting` is the sequencing signal: departments run in the order they are
// configured, so a rail that has not started yet while an *earlier* rail still
// has unfinished work is waiting on it. Purely advisory — nothing here blocks a
// drag. It is deliberately not called "blocked", because Blocked is a real task
// status and the two would be read as the same thing.
export const RAIL_STATE_LABEL = {
  done: 'Done',
  'in-progress': 'In progress',
  'not-started': 'Not started',
  waiting: 'Waiting',
  empty: 'Empty',
}

const STARTING_STATUSES = new Set(['todo', 'backlog'])

// rails: [{ id, name, ... }] in configured order. cards: the lane's tasks.
// catOf(task) -> effective category id ('' for uncategorised).
export function railRollups(rails, cards, catOf) {
  const base = (rails || []).map(rail => {
    const mine = (cards || []).filter(t => (catOf(t) || '') === rail.id)
    const done = mine.filter(t => t.status === 'done').length
    const started = mine.some(t => !STARTING_STATUSES.has(t.status || 'todo'))
    let state = 'empty'
    if (mine.length) {
      if (done === mine.length) state = 'done'
      else if (started) state = 'in-progress'
      else state = 'not-started'
    }
    return { ...rail, total: mine.length, done, pct: mine.length ? Math.round((done / mine.length) * 100) : 0, state, waitingOn: [] }
  })

  // Uncategorised is a catch-all, not a stage in the pipeline — it never waits on
  // anything and nothing waits on it.
  const stages = base.filter(r => r.id)
  for (let i = 0; i < stages.length; i++) {
    const r = stages[i]
    if (r.state !== 'not-started' && r.state !== 'empty') continue
    const blockers = stages.slice(0, i).filter(p => p.total > 0 && p.state !== 'done')
    if (!blockers.length) continue
    r.waitingOn = blockers.map(p => p.name)
    if (r.state === 'not-started') r.state = 'waiting'
  }
  return base
}

// Configured categories plus any category id a task still carries that no longer
// has a definition — deleting a category must never make its tasks disappear from
// a category-driven UI. Same rescue `columnsWithTaskStatuses()` performs for a
// status whose column was removed; the resurrected entry is flagged `orphan` so
// the manager can offer to clean it up.
export function categoriesWithTaskValues(categories, tasks) {
  const known = new Set((categories || []).map(c => c.id))
  const extra = []
  for (const t of (tasks || [])) {
    const id = t.category
    if (!id || known.has(id)) continue
    known.add(id)
    extra.push({
      id,
      name: id,
      color: CAT_COLORS[(categories.length + extra.length) % CAT_COLORS.length],
      orphan: true,
    })
  }
  return extra.length ? [...(categories || []), ...extra] : (categories || [])
}
