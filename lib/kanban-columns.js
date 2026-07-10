import { useEffect, useState } from 'react'

// Columns are the single definition of a project's statuses. The kanban board owns
// editing them; the task list and calendar read them so a custom column shows up
// everywhere, not just on the board.
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

export function columnsKey(apiBase) {
  return `kanban-cols:${apiBase}`
}

export function labelForStatus(status) {
  return String(status || '').replace(/(^|-)([a-z])/g, (_, s, c) => (s ? ' ' : '') + c.toUpperCase())
}

export function readColumns(apiBase) {
  if (typeof window === 'undefined' || !apiBase) return DEFAULT_COLUMNS
  try {
    const saved = localStorage.getItem(columnsKey(apiBase))
    const parsed = saved && JSON.parse(saved)
    if (Array.isArray(parsed) && parsed.length) return parsed
  } catch {}
  return DEFAULT_COLUMNS
}

// `storage` only fires in *other* tabs, so broadcast in-tab too — the board and the
// list can be mounted at once (kanban ⇄ list toggle keeps both trees alive).
export function writeColumns(apiBase, columns) {
  if (typeof window === 'undefined' || !apiBase) return
  try { localStorage.setItem(columnsKey(apiBase), JSON.stringify(columns)) } catch {}
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { apiBase } }))
}

export function useColumns(apiBase) {
  const [columns, setColumns] = useState(() => readColumns(apiBase))

  useEffect(() => {
    setColumns(readColumns(apiBase))
    const reread = e => {
      if (e.detail && e.detail.apiBase !== apiBase) return
      if (e.key && e.key !== columnsKey(apiBase)) return
      setColumns(readColumns(apiBase))
    }
    window.addEventListener(CHANGE_EVENT, reread)
    window.addEventListener('storage', reread)
    return () => {
      window.removeEventListener(CHANGE_EVENT, reread)
      window.removeEventListener('storage', reread)
    }
  }, [apiBase])

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
