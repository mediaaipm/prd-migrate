import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from './api-fetch'

// Client side of lib/sprint-store.js. Server is truth; every write broadcasts so the
// Sprints page tabs and the Backlog refetch together.

const CHANGE_EVENT = 'sprints-change'

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export const SPRINT_STATUS = {
  planned:   { label: 'Planned',   tint: 'slate' },
  active:    { label: 'Active',    tint: 'blue' },
  completed: { label: 'Completed', tint: 'green' },
}

export function notifySprintsChanged(slug) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { slug } }))
}

const EMPTY = { sprints: [], config: null, velocity: null, today: null, canManage: false, canDeleteCompleted: false }

export function useSprints(slug) {
  const [state, setState] = useState({ ...EMPTY, loading: true, error: '', forbidden: false })

  const reload = useCallback(() => {
    if (!slug) return Promise.resolve()
    return apiFetch(`/api/projects/${slug}/sprint`)
      .then(async r => {
        if (r.status === 403) { setState(s => ({ ...s, loading: false, forbidden: true })); return }
        const data = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(data.error || 'Failed to load sprints')
        setState({ ...EMPTY, ...data, loading: false, error: '', forbidden: false })
      })
      .catch(e => setState(s => ({ ...s, loading: false, error: e.message })))
  }, [slug])

  useEffect(() => {
    reload()
    const onChange = e => { if (!e.detail || e.detail.slug === slug) reload() }
    window.addEventListener(CHANGE_EVENT, onChange)
    return () => window.removeEventListener(CHANGE_EVENT, onChange)
  }, [slug, reload])

  return { ...state, reload }
}

async function send(slug, url, method, body) {
  const res = await apiFetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  notifySprintsChanged(slug)
  return data
}

const base = slug => `/api/projects/${slug}/sprint`
const one = (slug, id) => `${base(slug)}?id=${encodeURIComponent(id)}`

export const createSprint = (slug, fields) => send(slug, base(slug), 'POST', fields)
export const updateSprint = (slug, id, fields) => send(slug, one(slug, id), 'PUT', fields)
export const deleteSprint = (slug, id) => send(slug, one(slug, id), 'DELETE')
export const startSprint = (slug, id) => send(slug, one(slug, id), 'PATCH', { action: 'start' })
export const completeSprint = (slug, id, review) => send(slug, one(slug, id), 'PATCH', { action: 'complete', review })
export const addStoriesToSprint = (slug, id, storyIds) => send(slug, one(slug, id), 'PATCH', { action: 'addStories', storyIds })
export const removeStoriesFromSprint = (slug, id, storyIds) => send(slug, one(slug, id), 'PATCH', { action: 'removeStories', storyIds })

export async function fetchSprintConfig(slug) {
  const res = await apiFetch(`/api/projects/${slug}/sprint-config`)
  if (!res.ok) throw new Error('Failed to load the sprint cadence')
  return res.json()
}
export const saveSprintConfig = (slug, config) => send(slug, `/api/projects/${slug}/sprint-config`, 'PUT', config)

// --- Display helpers -----------------------------------------------------------------

// "2-week sprints, Monday → Friday · auto-rollover on"
export function cadenceLabel(c) {
  if (!c) return ''
  const days = `${WEEKDAYS[c.startDay]} → ${WEEKDAYS[c.endDay]}`
  const auto = c.autoRollover ? `closes at the end of ${WEEKDAYS[c.endDay]}, unfinished stories roll over automatically` : 'rollover when completed'
  return `${c.lengthWeeks}-week sprints, ${days} · ${auto}`
}

export function fmtDay(iso, withYear = false) {
  if (!iso) return ''
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) })
}

export function dateRange(s) {
  if (!s?.startDate && !s?.endDate) return 'No dates'
  return `${fmtDay(s.startDate) || '…'} → ${fmtDay(s.endDate, true) || '…'}`
}

// Calendar days left including today, from the server's notion of today.
export function daysLeft(endDate, today) {
  if (!endDate || !today) return null
  return Math.round((new Date(`${endDate}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000) + 1
}

export const pointsOf = t => { const n = Number(t && t.points); return Number.isFinite(n) && n > 0 ? n : 1 }

// Story-level progress for one sprint: stories done, tasks done, points done.
export function sprintProgress(sprint) {
  const stories = sprint?.stories || []
  const tasks = sprint?.tasks || []
  const doneTasks = tasks.filter(t => t.status === 'done')
  return {
    stories: stories.length,
    storiesDone: stories.filter(t => t.status === 'done').length,
    tasks: tasks.length,
    tasksDone: doneTasks.length,
    points: tasks.reduce((n, t) => n + pointsOf(t), 0),
    pointsDone: doneTasks.reduce((n, t) => n + pointsOf(t), 0),
  }
}
