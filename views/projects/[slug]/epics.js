import { useEffect, useMemo, useState } from 'react'
import { useRouter } from '../../../lib/router-compat'
import Link from 'next/link'
import Nav from '../../../components/Nav'
import PageHeader from '../../../components/PageHeader'
import { apiFetch } from '../../../lib/api-fetch'
import {
  useEpics, createEpic, updateEpic, deleteEpic, fetchEpic, setStoryEpic,
  EPIC_STATUSES, EPIC_STATUS, EPIC_COLORS, epicMap, pct,
} from '../../../lib/epics'

// Epic › story › sub-task. This page owns epics: create/edit them, see their progress,
// and link stories (root tasks) in or out. Sub-tasks are never linked directly — they
// ride with their story.

const today = () => new Date().toISOString().slice(0, 10)

function fmtDate(d) {
  if (!d) return ''
  const dt = new Date(`${d}T00:00:00`)
  return dt.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

function storyHref(slug, story) {
  const q = new URLSearchParams({ task: story.id })
  if (story.version) q.set('version', story.version)
  return `/projects/${slug}/tasks?${q}`
}

function StatusChip({ status }) {
  const s = EPIC_STATUS[status] || EPIC_STATUS.planned
  return <span className={`epic-status epic-status--${s.tint}`}>{s.label}</span>
}

function TaskStatusChip({ status }) {
  return <span className="epic-task-status">{(status || 'todo').replace(/-/g, ' ')}</span>
}

function ProgressBar({ done, total }) {
  const p = pct(done, total)
  return (
    <div className="epic-progress" title={`${done} of ${total} done`}>
      <div className="epic-progress-fill" style={{ width: `${p}%` }} />
    </div>
  )
}

// --- Create / edit ---------------------------------------------------------------

function EpicFormModal({ initial, onSave, onDelete, onClose, canDelete }) {
  const [form, setForm] = useState(() => ({
    name: '', description: '', color: EPIC_COLORS[3], status: 'planned', owner: '', startDate: '', targetDate: '',
    ...(initial || {}),
  }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = k => e => setForm(p => ({ ...p, [k]: e.target.value }))

  async function submit() {
    if (!form.name.trim()) { setError('Give the epic a name.'); return }
    setBusy(true); setError('')
    try {
      await onSave({
        name: form.name, description: form.description, color: form.color, status: form.status,
        owner: form.owner || null, startDate: form.startDate || null, targetDate: form.targetDate || null,
      })
    } catch (e) { setError(e.message); setBusy(false) }
  }

  return (
    <div className="kanban-modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="kanban-modal epic-form-modal" onKeyDown={e => { if (e.key === 'Escape') onClose() }}>
        <div className="kanban-modal-header">
          <span>{initial?.id ? 'Edit epic' : 'New epic'}</span>
          <button className="kanban-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="task-form">
          {error && <div className="kanban-col-error">{error}</div>}
          <input className="form-input" placeholder="Epic name *" value={form.name} onChange={set('name')} autoFocus maxLength={120} />
          <textarea className="form-input epic-form-desc" placeholder="What this epic delivers (optional)" value={form.description} onChange={set('description')} rows={4} />
          <div className="task-form-row">
            <select className="form-input" value={form.status} onChange={set('status')} title="Status">
              {EPIC_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <input className="form-input" placeholder="Owner (optional)" value={form.owner || ''} onChange={set('owner')} />
          </div>
          <div className="task-form-row">
            <label className="task-form-date">
              <span className="task-form-date-label">Start</span>
              <input className="form-input" type="date" value={form.startDate || ''} onChange={set('startDate')} />
            </label>
            <label className="task-form-date">
              <span className="task-form-date-label">Target</span>
              <input className="form-input" type="date" value={form.targetDate || ''} onChange={set('targetDate')} />
            </label>
          </div>
          <div className="epic-swatches" role="radiogroup" aria-label="Colour">
            {EPIC_COLORS.map(c => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={form.color === c}
                className={`epic-swatch${form.color === c ? ' is-on' : ''}`}
                style={{ '--status-color': c }}
                onClick={() => setForm(p => ({ ...p, color: c }))}
                title={c}
              />
            ))}
          </div>
          <div className="epic-form-actions">
            {initial?.id && canDelete && (
              <button type="button" className="btn-ghost epic-danger" onClick={onDelete} disabled={busy}>Delete epic</button>
            )}
            <span className="epic-spacer" />
            <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="button" className="btn-primary" onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// --- Link stories picker -------------------------------------------------------------

function LinkStoriesPanel({ slug, epic, epicsById, onDone, onCancel }) {
  const [stories, setStories] = useState(null)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState(() => new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    apiFetch(`/api/projects/${slug}/tasks?allVersions=1&fields=picker`)
      .then(r => (r.ok ? r.json() : []))
      .then(list => setStories((Array.isArray(list) ? list : []).filter(t => !t.parentId && !t.archived && t.epicId !== epic.id)))
      .catch(() => setStories([]))
  }, [slug, epic.id])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (stories || []).filter(s => !q || `${s.number} ${s.title}`.toLowerCase().includes(q))
  }, [stories, query])

  function toggle(id) {
    setPicked(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  async function link() {
    setBusy(true); setError('')
    const chosen = (stories || []).filter(s => picked.has(s.id))
    const failed = []
    for (const s of chosen) {
      try { await setStoryEpic(slug, s, epic.id) } catch (e) { failed.push(`${s.title}: ${e.message}`) }
    }
    setBusy(false)
    if (failed.length) { setError(failed.join('\n')); return }
    onDone()
  }

  return (
    <div className="epic-link-panel">
      <div className="epic-link-head">
        <input className="form-input" placeholder="Search stories…" value={query} onChange={e => setQuery(e.target.value)} autoFocus />
      </div>
      {error && <div className="kanban-col-error epic-pre">{error}</div>}
      <div className="epic-link-list">
        {stories === null && <div className="epic-muted">Loading stories…</div>}
        {stories && shown.length === 0 && <div className="epic-muted">No stories to link.</div>}
        {shown.map(s => {
          const other = s.epicId ? epicsById[s.epicId] : null
          return (
            <label key={`${s.version || ''}:${s.id}`} className="epic-link-row">
              <input type="checkbox" checked={picked.has(s.id)} onChange={() => toggle(s.id)} />
              <span className="task-number">{s.number}</span>
              <span className="epic-link-title">{s.title}</span>
              {s.version && <span className="epic-version">v{s.version}</span>}
              <TaskStatusChip status={s.status} />
              {other && <span className="epic-chip" style={{ '--status-color': other.color }} title="Linking moves it out of this epic">◆ {other.name}</span>}
            </label>
          )
        })}
      </div>
      <div className="epic-form-actions">
        <span className="epic-muted">{picked.size} selected</span>
        <span className="epic-spacer" />
        <button className="btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className="btn-primary" onClick={link} disabled={busy || picked.size === 0}>
          {busy ? 'Linking…' : `Link ${picked.size || ''} ${picked.size === 1 ? 'story' : 'stories'}`}
        </button>
      </div>
    </div>
  )
}

// --- Detail (stories in one epic) -------------------------------------------------

function EpicDetailModal({ slug, epicId, epicsById, canLink, canManage, onEdit, onClose }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [linking, setLinking] = useState(false)

  function load() {
    return fetchEpic(slug, epicId).then(setData).catch(e => setError(e.message))
  }
  useEffect(() => { load() }, [slug, epicId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function unlink(story) {
    if (!confirm(`Unlink “${story.title}” from this epic? The story and its sub-tasks stay as they are.`)) return
    try { await setStoryEpic(slug, story, null); await load() } catch (e) { alert(e.message) }
  }

  // The page's list is refetched after every edit/link, so it wins over this modal's
  // own (older) copy — an edit made from here shows without reopening.
  const epic = epicsById[epicId] || data?.epic
  const stories = data?.stories || []
  const p = epic?.progress

  return (
    <div className="kanban-modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="kanban-modal epic-detail-modal" style={{ '--status-color': epic?.color || '#94a3b8' }}>
        <div className="kanban-modal-header epic-detail-header">
          <span className="epic-detail-title">
            <span className="epic-dot" />
            {epic?.name || 'Epic'}
            {epic && <StatusChip status={epic.status} />}
          </span>
          <span className="epic-detail-actions">
            {canManage && epic && <button className="btn-ghost epic-btn-sm" onClick={() => onEdit(epic)}>Edit</button>}
            <button className="kanban-modal-close" onClick={onClose}>✕</button>
          </span>
        </div>
        <div className="epic-detail-body">
          {error && <div className="kanban-col-error">{error}</div>}
          {epic?.description && <p className="epic-detail-desc">{epic.description}</p>}
          {p && (
            <div className="epic-detail-stats">
              <div><strong>{p.storiesDone}/{p.stories}</strong> stories done</div>
              <div><strong>{p.subtasksDone}/{p.subtasks}</strong> sub-tasks done</div>
              <div><strong>{p.pointsDone}/{p.points}</strong> points</div>
              {epic.targetDate && <div>Target <strong>{fmtDate(epic.targetDate)}</strong></div>}
            </div>
          )}
          {p && <ProgressBar done={p.storiesDone} total={p.stories} />}

          <div className="epic-detail-section-head">
            <span>Stories</span>
            {canLink && !linking && <button className="btn-primary epic-btn-sm" onClick={() => setLinking(true)}>+ Link stories</button>}
          </div>

          {linking && epic && (
            <LinkStoriesPanel
              slug={slug}
              epic={epic}
              epicsById={epicsById}
              onCancel={() => setLinking(false)}
              onDone={() => { setLinking(false); load() }}
            />
          )}

          {!data && !error && <div className="epic-muted">Loading…</div>}
          {data && stories.length === 0 && !linking && (
            <div className="epic-muted">No stories yet. Link existing stories, or pick this epic when you add a story.</div>
          )}
          <div className="epic-story-list">
            {stories.map(s => (
              <div key={`${s.version || ''}:${s.id}`} className="epic-story-row">
                <span className="task-number">{s.number}</span>
                <Link href={storyHref(slug, s)} className="epic-story-title">{s.title}</Link>
                {s.version && <span className="epic-version">v{s.version}</span>}
                <TaskStatusChip status={s.status} />
                <span className="epic-muted epic-story-subs" title="Sub-tasks done">
                  {s.subtasks ? `${s.subtasksDone}/${s.subtasks} sub-tasks` : 'no sub-tasks'}
                </span>
                {canLink && <button className="task-action-btn" onClick={() => unlink(s)} title="Unlink from epic">✕</button>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// --- Page --------------------------------------------------------------------------

export default function ProjectEpics() {
  const router = useRouter()
  const { slug, epic: openId } = router.query
  const [projectName, setProjectName] = useState('')
  const { epics, canManage, canLink, canDelete, loading, error, reload } = useEpics(slug)
  const [filter, setFilter] = useState('active')
  const [editing, setEditing] = useState(null) // null | {} (new) | epic

  useEffect(() => {
    if (!router.isReady || !slug) return
    apiFetch(`/api/projects/${slug}`).then(r => (r.ok ? r.json() : null)).then(p => p && setProjectName(p.name || '')).catch(() => {})
  }, [router.isReady, slug])

  const epicsById = useMemo(() => epicMap(epics), [epics])
  const shown = epics.filter(e => filter === 'all' || (filter === 'active' ? e.status !== 'done' : e.status === filter))
  const counts = {
    active: epics.filter(e => e.status !== 'done').length,
    done: epics.filter(e => e.status === 'done').length,
    all: epics.length,
  }

  // The open epic lives in the URL so it is linkable and Back closes it.
  function openEpic(id) {
    const href = id ? `/projects/${slug}/epics?epic=${encodeURIComponent(id)}` : `/projects/${slug}/epics`
    router.replace(href, undefined, { shallow: true })
  }

  async function save(fields) {
    if (editing?.id) await updateEpic(slug, editing.id, fields)
    else await createEpic(slug, fields)
    setEditing(null)
  }

  async function remove() {
    const e = editing
    const n = e?.progress?.stories || 0
    if (!confirm(`Delete epic “${e.name}”?${n ? ` Its ${n} ${n === 1 ? 'story is' : 'stories are'} unlinked, not deleted.` : ''} This cannot be undone.`)) return
    try {
      await deleteEpic(slug, e.id)
      setEditing(null)
      if (openId === e.id) openEpic(null)
    } catch (err) { alert(err.message) }
  }

  return (
    <>
      <Nav projectName={projectName} />
      <main className="page page--full">
        <PageHeader
          title="Epics"
          subtitle="Big pieces of work. Each epic groups stories, and progress rolls up from them."
          actions={canManage && <button className="btn-primary" onClick={() => setEditing({})}>+ New Epic</button>}
        />

        <div className="epic-filters" role="tablist">
          {[['active', 'Active'], ['done', 'Done'], ['all', 'All']].map(([k, label]) => (
            <button key={k} role="tab" aria-selected={filter === k} className={`epic-filter${filter === k ? ' is-on' : ''}`} onClick={() => setFilter(k)}>
              {label} <span className="epic-filter-count">{counts[k]}</span>
            </button>
          ))}
        </div>

        {error && <div className="kanban-col-error">{error}</div>}
        {loading && <div className="epic-grid">{[0, 1, 2].map(i => <span key={i} className="skeleton epic-skeleton" />)}</div>}

        {!loading && shown.length === 0 && (
          <div className="section-card epic-empty">
            {epics.length === 0
              ? <>No epics yet.{canManage ? ' Create one to start grouping your stories.' : ''}</>
              : 'No epics in this view.'}
          </div>
        )}

        {!loading && shown.length > 0 && (
          <div className="epic-grid">
            {shown.map(e => {
              const p = e.progress || {}
              const late = e.targetDate && e.status !== 'done' && e.targetDate < today()
              return (
                <button key={e.id} className="epic-card" style={{ '--status-color': e.color }} onClick={() => openEpic(e.id)}>
                  <div className="epic-card-top">
                    <span className="epic-card-name">{e.name}</span>
                    <StatusChip status={e.status} />
                  </div>
                  {e.description && <p className="epic-card-desc">{e.description}</p>}
                  <ProgressBar done={p.storiesDone || 0} total={p.stories || 0} />
                  <div className="epic-card-meta">
                    <span><strong>{p.storiesDone || 0}/{p.stories || 0}</strong> stories</span>
                    <span>{p.subtasksDone || 0}/{p.subtasks || 0} sub-tasks</span>
                    <span>{pct(p.storiesDone, p.stories)}%</span>
                  </div>
                  {(e.startDate || e.targetDate || e.owner) && (
                    <div className="epic-card-foot">
                      {e.owner && <span>{e.owner}</span>}
                      {(e.startDate || e.targetDate) && (
                        <span className={late ? 'epic-late' : ''}>
                          {fmtDate(e.startDate) || '…'} → {fmtDate(e.targetDate) || '…'}{late ? ' · overdue' : ''}
                        </span>
                      )}
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        )}

        {typeof openId === 'string' && openId && (
          <EpicDetailModal
            key={openId}
            slug={slug}
            epicId={openId}
            epicsById={epicsById}
            canLink={canLink}
            canManage={canManage}
            onEdit={e => setEditing(e)}
            onClose={() => openEpic(null)}
          />
        )}

        {editing && (
          <EpicFormModal
            initial={editing.id ? editing : null}
            canDelete={canDelete}
            onSave={async fields => { await save(fields); reload() }}
            onDelete={remove}
            onClose={() => setEditing(null)}
          />
        )}
      </main>
    </>
  )
}
