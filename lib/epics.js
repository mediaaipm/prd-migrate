import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from './api-fetch'
import { COL_COLORS } from './kanban-columns'

// Epic › story › sub-task. An epic groups stories (root tasks); a sub-task is in its
// story's epic and never carries an `epicId` of its own — the server strips it. So
// "which epic is this task in" is always answered through the story. Server is truth
// (`epic:{slug}:{id}`); there is no localStorage cache because epics carry progress
// that is only correct as of the last fetch.
export const EPIC_COLORS = COL_COLORS

export const EPIC_STATUSES = [
  { value: 'planned',     label: 'Planned',     tint: 'slate' },
  { value: 'in-progress', label: 'In progress', tint: 'blue' },
  { value: 'done',        label: 'Done',        tint: 'green' },
]
export const EPIC_STATUS = Object.fromEntries(EPIC_STATUSES.map(s => [s.value, s]))

const CHANGE_EVENT = 'epics-change'

// Any page that links or unlinks a story calls this so every mounted epic list
// (the Epics page, the Backlog, the task forms) refetches its progress.
export function notifyEpicsChanged(slug) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { slug } }))
}

export async function fetchEpics(slug) {
  const res = await apiFetch(`/api/projects/${slug}/epics`)
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load epics')
  return res.json()
}

const EMPTY = { epics: [], canManage: false, canLink: false, canDelete: false }

export function useEpics(slug) {
  const [state, setState] = useState({ ...EMPTY, loading: true, error: '' })

  const reload = useCallback(() => {
    if (!slug) return Promise.resolve()
    return fetchEpics(slug)
      .then(data => setState({ ...EMPTY, ...data, loading: false, error: '' }))
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

async function send(url, method, body) {
  const res = await apiFetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}

export function createEpic(slug, epic) {
  return send(`/api/projects/${slug}/epics`, 'POST', epic).then(r => { notifyEpicsChanged(slug); return r })
}
export function updateEpic(slug, id, patch) {
  return send(`/api/projects/${slug}/epics/${encodeURIComponent(id)}`, 'PUT', patch).then(r => { notifyEpicsChanged(slug); return r })
}
export function deleteEpic(slug, id) {
  return send(`/api/projects/${slug}/epics/${encodeURIComponent(id)}`, 'DELETE').then(r => { notifyEpicsChanged(slug); return r })
}
export function fetchEpic(slug, id) {
  return send(`/api/projects/${slug}/epics/${encodeURIComponent(id)}`, 'GET')
}

// The task route a story lives behind — stories are spread over version lists.
export function taskUrl(slug, task) {
  return task.version
    ? `/api/projects/${slug}/versions/${encodeURIComponent(task.version)}/tasks/${task.id}`
    : `/api/projects/${slug}/tasks/${task.id}`
}

// Link (or, with epicId null, unlink) a story. Goes through the ordinary task PUT,
// which refuses it for a sub-task or an epic that does not exist.
export function setStoryEpic(slug, story, epicId) {
  return send(taskUrl(slug, story), 'PUT', { epicId: epicId || null }).then(r => { notifyEpicsChanged(slug); return r })
}

export function updateStory(slug, story, patch) {
  return send(taskUrl(slug, story), 'PUT', patch).then(r => { notifyEpicsChanged(slug); return r })
}

// The root task above `task` (itself when it is a story). `byId` maps id → task over
// the whole list the task came from.
export function storyOf(task, byId) {
  let cur = task
  const seen = new Set()
  while (cur && cur.parentId && !seen.has(cur.id)) {
    seen.add(cur.id)
    const up = byId[cur.parentId]
    if (!up) break
    cur = up
  }
  return cur
}

// The epic id a task is in, through its story. '' when its story has none.
export function epicIdOf(task, byId) {
  return storyOf(task, byId)?.epicId || ''
}

export function epicMap(epics) {
  const map = {}
  for (const e of (epics || [])) map[e.id] = e
  return map
}

export function pct(done, total) {
  return total ? Math.round((done / total) * 100) : 0
}
