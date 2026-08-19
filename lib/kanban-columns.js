import { useEffect, useState } from 'react'
import { apiFetch } from './api-fetch'
import { withRev, bumpRev } from './config-cache'

// Columns are the single definition of a project's statuses. The layout lives on
// the server (`GET/PUT /api/projects/{slug}/columns`) and is global: one order,
// set by a super admin, seen by every user and by every version-scoped board.
// localStorage is only a first-paint cache so the board does not flash the
// defaults while the fetch is in flight — the server always wins.
export const DEFAULT_COLUMNS = [
  { status: 'backlog',     label: 'Backlog',      color: '#94a3b8' },
  { status: 'todo',        label: 'To Do',        color: '#3b82f6' },
  { status: 'in-progress', label: 'In Progress',  color: '#f59e0b' },
  { status: 'in-review',   label: 'In Review',    color: '#8b5cf6' },
  { status: 'blocked',     label: 'Blocked',      color: '#dc2626' },
  { status: 'done',        label: 'Done',         color: '#16a34a' },
]

export const COL_COLORS = [
  '#94a3b8','#3b82f6','#f59e0b','#8b5cf6','#16a34a',
  '#ef4444','#ec4899','#06b6d4','#f97316','#84cc16',
]

const CHANGE_EVENT = 'kanban-cols-change'

export function columnsKey(slug) {
  return `kanban-cols:${slug}`
}

export function labelForStatus(status) {
  return String(status || '').replace(/(^|-)([a-z])/g, (_, s, c) => (s ? ' ' : '') + c.toUpperCase())
}

// Cached copy — defaults until the server answers.
export function readColumns(slug) {
  if (typeof window === 'undefined' || !slug) return DEFAULT_COLUMNS
  try {
    const saved = localStorage.getItem(columnsKey(slug))
    const parsed = saved && JSON.parse(saved)
    if (Array.isArray(parsed) && parsed.length) return parsed
  } catch {}
  return DEFAULT_COLUMNS
}

// `storage` only fires in *other* tabs, so broadcast in-tab too — the board and the
// list can be mounted at once (kanban ⇄ list toggle keeps both trees alive).
function cacheColumns(slug, columns) {
  if (typeof window === 'undefined' || !slug) return
  try { localStorage.setItem(columnsKey(slug), JSON.stringify(columns)) } catch {}
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { slug } }))
}

export async function fetchColumns(slug) {
  if (!slug) return DEFAULT_COLUMNS
  const res = await apiFetch(withRev(`/api/projects/${slug}/columns`, 'cols', slug))
  if (!res.ok) throw new Error('Failed to load columns')
  const { columns } = await res.json()
  const next = Array.isArray(columns) && columns.length ? columns : DEFAULT_COLUMNS
  cacheColumns(slug, next)
  return next
}

// Super admin only — the API rejects everyone else with 403.
export async function saveColumns(slug, columns) {
  if (!slug) return DEFAULT_COLUMNS
  const res = await apiFetch(`/api/projects/${slug}/columns`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ columns }),
  })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to save columns')
  const { columns: saved } = await res.json()
  // Before cacheColumns, and before anything can refetch: the GET is browser-cached for
  // a minute, so without a new token this tab could reload straight back into its own
  // pre-edit copy and write that over what it just saved.
  bumpRev('cols', slug)
  cacheColumns(slug, saved)
  return saved
}

export function useColumns(slug) {
  const [columns, setColumns] = useState(() => readColumns(slug))

  useEffect(() => {
    let live = true
    setColumns(readColumns(slug))
    fetchColumns(slug).then(cols => { if (live) setColumns(cols) }).catch(() => {})
    const reread = e => {
      if (e.detail && e.detail.slug !== slug) return
      if (e.key && e.key !== columnsKey(slug)) return
      setColumns(readColumns(slug))
    }
    window.addEventListener(CHANGE_EVENT, reread)
    window.addEventListener('storage', reread)
    return () => {
      live = false
      window.removeEventListener(CHANGE_EVENT, reread)
      window.removeEventListener('storage', reread)
    }
  }, [slug])

  return columns
}

// Columns plus any status found on a task that has no column — otherwise a task
// parked in a deleted/foreign status is invisible in every status-driven UI.
export function columnsWithTaskStatuses(columns, tasks) {
  const known = new Set(columns.map(c => c.status))
  const extra = []
  for (const t of (tasks || [])) {
    const s = t.status
    if (!s || known.has(s)) continue
    known.add(s)
    extra.push({ status: s, label: labelForStatus(s), color: COL_COLORS[(columns.length + extra.length) % COL_COLORS.length] })
  }
  return extra.length ? [...columns, ...extra] : columns
}
