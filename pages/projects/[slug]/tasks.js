import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import Nav from '../../../components/Nav'
import SubmitButton from '../../../components/SubmitButton'
import { apiFetch } from '../../../lib/api-fetch'
import { enqueue, onSync } from '../../../lib/submit-queue'
import { useOptimistic } from '../../../lib/optimistic'
import { reshapesTree } from '../../../lib/task-reconcile'
import TaskTree from '../../../components/TaskTree'
import KanbanBoard from '../../../components/KanbanBoard'
import CalendarView from '../../../components/CalendarView'


const STATUS_COUNT_COLUMNS = [
  { status: 'backlog',     label: 'Backlog',     color: '#94a3b8' },
  { status: 'todo',        label: 'To Do',       color: '#3b82f6' },
  { status: 'in-progress', label: 'In Progress', color: '#f59e0b' },
  { status: 'in-review',   label: 'In Review',   color: '#8b5cf6' },
  { status: 'blocked',     label: 'Blocked',     color: '#dc2626' },
  { status: 'done',        label: 'Done',        color: '#16a34a' },
]

function StatusCounts({ tasks }) {
  const counts = tasks.reduce((acc, t) => {
    if (t.archived) return acc
    const s = t.status || 'todo'
    acc[s] = (acc[s] || 0) + 1
    return acc
  }, {})
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {/* The hue is data; the wash, border and dark-mode ink lift live in CSS,
          which is the only place that can tell which theme is on. */}
      {STATUS_COUNT_COLUMNS.map(c => (
        <span key={c.status} className="status-count-chip" style={{ '--status-color': c.color }}>
          <span className="status-count-dot" />
          {c.label}
          <span style={{ fontWeight: 800 }}>{counts[c.status] || 0}</span>
        </span>
      ))}
    </div>
  )
}

function TaskSkeleton() {
  return (
    <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {[0, 1, 2, 3, 4].map(i => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: i % 2 === 0 ? 0 : 20 }}>
          <span className="skeleton" style={{ width: 18, height: 18, borderRadius: '50%', flexShrink: 0 }} />
          <span className="skeleton" style={{ width: `${45 + (i * 11) % 35}%`, height: 13 }} />
          <span className="skeleton" style={{ width: 50, height: 18, borderRadius: 10, marginLeft: 'auto' }} />
        </div>
      ))}
    </div>
  )
}

export default function TasksPage({ currentUser }) {
  const router = useRouter()
  const { slug, version, task: focusTaskId } = router.query

  const [projectName, setProjectName] = useState('')
  const [access, setAccess] = useState(null)
  const [taskAcl, setTaskAcl] = useState(null)
  const [taskPrefix, setTaskPrefix] = useState('')
  const [taskSeqStart, setTaskSeqStart] = useState(1)
  const [showIdSettings, setShowIdSettings] = useState(false)
  const [idDraft, setIdDraft] = useState({ prefix: '', start: '1' })
  const [serverTasks, setServerTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [versions, setVersions] = useState([])
  const [viewMode, setViewMode] = useState('list')
  const [showArchived, setShowArchived] = useState(false)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [importFormat, setImportFormat] = useState('csv')
  const [importFile, setImportFile] = useState(null)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState('')
  const [importSuccess, setImportSuccess] = useState('')

  const apiBase = slug
    ? version
      ? `/api/projects/${slug}/versions/${version}/tasks`
      : `/api/projects/${slug}/tasks`
    : null

  // Single choke point for the board, tree and calendar: every queued task mutation
  // for this apiBase is replayed on top of whatever the server last returned. A
  // refetch therefore cannot make a just-created card blink out of existence while
  // its POST is still in flight.
  const tasks = useOptimistic(serverTasks, { entity: 'task', scope: apiBase, cascade: true })

  // Refetches fire from several places at once (initial load, every queue sync, sprint
  // changes). Responses can land out of order, so an older one must never overwrite a
  // newer list — that is how a just-created task disappears again after saving.
  const loadSeq = useRef(0)

  // Latest server data, readable synchronously. The sync listener has to decide whether
  // a write reshaped the tree BEFORE it picks reconcile-or-refetch, which it cannot do
  // from inside a setState updater.
  const serverTasksRef = useRef([])
  useEffect(() => { serverTasksRef.current = serverTasks }, [serverTasks])

  // Returns the in-flight promise: onSync awaits it, so a synced write stays on the
  // optimistic overlay until the refreshed server data is actually in state.
  const loadTasks = useCallback((opts = {}) => {
    if (!apiBase) return Promise.resolve()
    // Skeleton only on initial load. Background refreshes (status change, drag,
    // reorder) keep the board mounted to avoid a whole-page flicker.
    if (!opts.background) setLoading(true)
    const seq = ++loadSeq.current
    return apiFetch(apiBase)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (seq !== loadSeq.current) return // a newer fetch already answered
        // A failed GET means "unknown", not "empty" — keep what we have rather than
        // blanking the list.
        if (Array.isArray(data)) setServerTasks(data)
        setLoading(false)
      })
      .catch(() => { if (seq === loadSeq.current) setLoading(false) })
  }, [apiBase])

  const refreshTasks = useCallback(() => loadTasks({ background: true }), [loadTasks])

  // Fold in server-assigned fields (seq, number, order) once a queued write lands.
  // Moves (drag, ↑/↓) carry no optimistic descriptor — the server reindexes siblings and
  // renumbers, which is not replayable client-side — so match on the url too, otherwise a
  // move would only appear after a reload.
  //
  // Reconciling from the write's OWN response wherever it is sufficient, rather than
  // re-GETting the list. The list is ~500 KB at this project's size and it was coming
  // back down the wire on every status flip, drag and comment — the payload volume that
  // blew Fast Origin Transfer once already. The response already carries the answer:
  //
  //   PATCH  -> the full renumbered array (computeNumbers server-side) — a drop-in list
  //   POST   -> the created task, numbered; appending renumbers nothing
  //   PUT    -> the updated task, as long as the edit cannot reshape the tree
  //
  // Deletes cascade to children and renumber the siblings left behind, and a structural
  // PUT reparents or renumbers — neither is reconstructable from the response, so those
  // still refetch.
  useEffect(() => onSync((item, response) => {
    if (!apiBase) return
    const scoped = item.optimistic
      ? item.optimistic.entity === 'task' && item.optimistic.scope === apiBase
      : typeof item.url === 'string' && item.url.startsWith(apiBase)
    if (!scoped) return

    const method = String(item.method || '').toUpperCase()

    // Any GET issued before this write must not land on top of what we just applied.
    // loadTasks() already discards responses older than loadSeq; bump it so a reconcile
    // invalidates in-flight fetches the same way a refetch would.
    const settle = next => {
      loadSeq.current++
      setServerTasks(next)
      setLoading(false)
    }

    if (method === 'PATCH' && Array.isArray(response)) {
      settle(response)
      return
    }
    if (method === 'POST' && response && response.id) {
      settle(prev => (prev.some(t => t.id === response.id) ? prev : [...prev, response]))
      return
    }
    if (method === 'PUT' && response && response.id) {
      const before = serverTasksRef.current.find(t => t.id === response.id)
      if (!reshapesTree(item.body, before)) {
        settle(prev => prev.map(t => (t.id === response.id ? { ...t, ...response } : t)))
        return
      }
    }

    // Returned so the queue holds the item until this refetch has landed.
    return refreshTasks()
  }), [apiBase, refreshTasks])

  function openIdSettings() {
    setIdDraft({ prefix: taskPrefix || '', start: String(taskSeqStart || 1) })
    setShowIdSettings(true)
  }
  function saveIdSettings() {
    if (!slug) return
    const prefix = (idDraft.prefix || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
    const start = Math.max(1, parseInt(idDraft.start, 10) || 1)
    enqueue({
      url: `/api/projects/${slug}`,
      method: 'PUT',
      body: { taskPrefix: prefix, taskSeqStart: start },
      label: 'Save task ID settings',
    })
    setTaskPrefix(prefix)
    setTaskSeqStart(start)
    setShowIdSettings(false)
  }

  useEffect(() => {
    if (!router.isReady || !slug) return
    apiFetch(`/api/projects/${slug}`)
      .then(r => r.ok ? r.json() : null)
      .then(p => {
        if (p) {
          setProjectName(p.name)
          setVersions(p.versions || [])
          setTaskAcl(p.taskAcl || null)
          setTaskPrefix(p.taskPrefix || '')
          setTaskSeqStart(p.taskSeqStart || 1)
        }
      })
  }, [router.isReady, slug])

  // This project's effective role policy (per-project overrides fold in here).
  useEffect(() => {
    if (!router.isReady || !slug) return
    apiFetch(`/api/projects/${slug}/access`)
      .then(r => r.ok ? r.json() : null)
      .then(a => setAccess(a))
      .catch(() => {})
  }, [router.isReady, slug])

  // The session user carries global-default perms; overlay this project's policy so
  // the board/list only offer what the server will accept here. Superadmin is
  // unaffected (hasPerm short-circuits on role). Admins are capped by the project's
  // admin policy; viewers use the project's user policy + status blocklist.
  const scopedUser = useMemo(() => {
    if (!currentUser || !access) return currentUser
    if (currentUser.role === 'superadmin' || (currentUser.isAdmin && !currentUser.role)) return currentUser
    const u = { ...currentUser }
    // `effective` is what the server computed for THIS caller in THIS project
    // (personal + group grant, capped by the project policy).
    const effective = Array.isArray(access.effective) ? access.effective : null
    if (currentUser.role === 'admin') {
      const personal = Array.isArray(currentUser.permissions) ? currentUser.permissions : []
      u.permissions = effective || personal.filter(p => (access.admin || []).includes(p))
    } else {
      u.viewerPerms = effective || access.user || []
    }
    u.restrictedStatuses = access.userRestrictedStatuses || []
    return u
  }, [currentUser, access])

  useEffect(() => {
    if (!router.isReady) return
    loadTasks()
  }, [router.isReady, loadTasks])

  // A shared ?task= link points at a row in the tree, which only the list view renders.
  useEffect(() => { if (focusTaskId) setViewMode('list') }, [focusTaskId])

  async function handleExport(format) {
    setShowExportMenu(false)
    const params = new URLSearchParams({ format })
    if (version) params.set('version', version)
    const res = await apiFetch(`/api/projects/${slug}/export?${params}`)
    if (!res.ok) return
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = format === 'json' ? `${slug}-prd.json` : `${slug}-tasks${version ? `-v${version}` : ''}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  async function handleImport(e) {
    e.preventDefault()
    if (!importFile) return
    setImporting(true)
    setImportError('')
    setImportSuccess('')
    try {
      const content = await importFile.text()
      let body
      if (importFormat === 'csv') {
        body = { format: 'csv', content }
      } else {
        try { body = { format: 'json', data: JSON.parse(content) } }
        catch { setImportError('Invalid JSON file'); setImporting(false); return }
      }
      const params = new URLSearchParams()
      if (version) params.set('version', version)
      const res = await apiFetch(`/api/projects/${slug}/import?${params}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setImportError(err.error || 'Import failed')
      } else {
        const result = await res.json()
        setImportSuccess(`Imported ${result.created} task${result.created !== 1 ? 's' : ''} successfully`)
        setImportFile(null)
        loadTasks()
      }
    } finally {
      setImporting(false)
    }
  }

  const archivedTasks = tasks.filter(t => t.archived)

  function restoreTask(id) {
    const patch = { archived: false, archivedAt: null }
    enqueue({
      url: `${apiBase}/${id}`,
      method: 'PUT',
      body: patch,
      label: 'Restore card',
      optimistic: { entity: 'task', op: 'update', scope: apiBase, id, patch },
    })
  }

  function permaDeleteTask(id) {
    if (!confirm('Permanently delete this card and its sub-tasks? This cannot be undone.')) return
    enqueue({
      url: `${apiBase}/${id}`,
      method: 'DELETE',
      label: 'Delete card',
      optimistic: { entity: 'task', op: 'delete', scope: apiBase, id },
    })
  }

  const contextLabel = version ? `v${version} Tasks` : 'Project Tasks'

  if (!router.isReady) {
    return (
      <><Nav />
        <main className="page page--full">
          <div className="page-header">
            <span className="skeleton" style={{ width: 240, height: 12, marginBottom: 10 }} />
            <span className="skeleton" style={{ width: 180, height: 26 }} />
          </div>
          <div style={{ display: 'flex', gap: 4, marginTop: 20 }}>
            {[0, 1, 2].map(i => <span key={i} className="skeleton" style={{ width: 80, height: 34, borderRadius: '6px 6px 0 0' }} />)}
          </div>
          <div className="section-card" style={{ marginTop: 16 }}>
            <div className="section-card-header"><span className="skeleton" style={{ width: 100, height: 13 }} /></div>
            <TaskSkeleton />
          </div>
        </main>
      </>
    )
  }

  return (
    <>
      <Nav />
      <main className="page page--full">
        <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 10 }}>
              <h1>{contextLabel}</h1>
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                — <Link href="/">Projects</Link> / <Link href={`/projects/${slug}`}>{projectName || slug}</Link> / {contextLabel}
                {version && <> - Tasks scoped to version {version}</>}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Link
              href={`/projects/${slug}/sprints`}
              style={{
                fontSize: 13, padding: '6px 14px', borderRadius: 8, textDecoration: 'none',
                border: '1px solid var(--tint-indigo-fg)', background: 'var(--tint-indigo-fg)',
                color: 'var(--on-accent)', fontWeight: 600, whiteSpace: 'nowrap',
              }}
            >
              Sprints →
            </Link>
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setShowExportMenu(p => !p)}
                className="btn-ghost"
                style={{ fontSize: 13, padding: '6px 14px' }}
              >
                Export ▾
              </button>
              {showExportMenu && (
                <div
                  style={{
                    position: 'absolute', top: '100%', right: 0, marginTop: 4,
                    background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
                    boxShadow: '0 4px 16px rgba(0,0,0,.1)', zIndex: 200, minWidth: 160, overflow: 'hidden',
                  }}
                  onMouseLeave={() => setShowExportMenu(false)}
                >
                  <button
                    onClick={() => handleExport('json')}
                    style={{ display: 'block', width: '100%', padding: '9px 16px', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text)' }}
                  >
                    Download JSON
                  </button>
                  <button
                    onClick={() => handleExport('csv')}
                    style={{ display: 'block', width: '100%', padding: '9px 16px', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text)' }}
                  >
                    Download CSV
                  </button>
                </div>
              )}
            </div>
            <button onClick={() => { setShowImport(true); setImportError(''); setImportSuccess(''); setImportFile(null) }} className="btn-ghost" style={{ fontSize: 13, padding: '6px 14px' }}>
              Import
            </button>
            <Link href={`/projects/${slug}/dashboard`} className="btn-ghost" style={{ fontSize: 13, padding: '6px 14px', textDecoration: 'none' }}>
              Dashboard
            </Link>
            <Link href={`/projects/${slug}`} className="btn-ghost" style={{ fontSize: 13, padding: '6px 14px', textDecoration: 'none' }}>
              ← Back to Project
            </Link>
          </div>
        </div>

        <div className="task-context-tabs">
          <Link
            href={`/projects/${slug}/tasks`}
            className={`task-context-tab ${!version ? 'active' : ''}`}
          >
            Project Tasks
          </Link>
          {versions.map(v => (
            <Link
              key={v.version}
              href={`/projects/${slug}/tasks?version=${v.version}`}
              className={`task-context-tab ${version === v.version ? 'active' : ''}`}
            >
              v{v.version}
            </Link>
          ))}
          <div className="task-context-tools">
            {!loading && <span className="badge">{tasks.length}</span>}
            {!loading && <StatusCounts tasks={tasks} />}
            {currentUser?.isAdmin && slug && (
              <button className="btn-ghost" style={{ whiteSpace: 'nowrap', fontSize: 12 }} onClick={openIdSettings} title="Set task ID prefix & start number">
                ⚙ Task IDs
              </button>
            )}
            <div className="kanban-view-toggle">
              <button
                className={`kanban-view-btn${viewMode === 'list' ? ' active' : ''}`}
                onClick={() => setViewMode('list')}
                title="List view"
              >List</button>
              <button
                className={`kanban-view-btn${viewMode === 'kanban' ? ' active' : ''}`}
                onClick={() => setViewMode('kanban')}
                title="Kanban board"
              >Kanban</button>
              <button
                className={`kanban-view-btn${viewMode === 'calendar' ? ' active' : ''}`}
                onClick={() => setViewMode('calendar')}
                title="Calendar view"
              >Calendar</button>
            </div>
          </div>
        </div>

        <div className="section-card" style={{ marginTop: 0 }}>
          {loading ? <TaskSkeleton /> : viewMode === 'kanban' ? (
            <KanbanBoard key={apiBase} tasks={tasks} apiBase={apiBase} slug={slug} currentUser={scopedUser} taskAcl={taskAcl} onAclChange={setTaskAcl} taskPrefix={taskPrefix} onPrefixChange={setTaskPrefix} taskSeqStart={taskSeqStart} onSeqStartChange={setTaskSeqStart} focusTaskId={focusTaskId} />
          ) : viewMode === 'calendar' ? (
            <CalendarView tasks={tasks} apiBase={apiBase} slug={slug} currentUser={scopedUser} />
          ) : (
            <TaskTree tasks={tasks} apiBase={apiBase} slug={slug} onRefresh={refreshTasks} currentUser={scopedUser} taskAcl={taskAcl} taskPrefix={taskPrefix} focusTaskId={focusTaskId} />
          )}
        </div>

        {archivedTasks.length > 0 && (
          <div className="section-card" style={{ marginTop: 12 }}>
            <div className="section-card-header">
              <button
                onClick={() => setShowArchived(v => !v)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6, padding: 0 }}
              >
                {showArchived ? '▾' : '▸'} Archived ({archivedTasks.length})
              </button>
            </div>
            {showArchived && (
              <div className="archived-list">
                {archivedTasks.map(t => (
                  <div key={t.id} className="archived-row">
                    {t.number && <span className="task-number" style={{ fontSize: 11 }}>{t.number}</span>}
                    <span className="archived-title">{t.title}</span>
                    <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => restoreTask(t.id)}>Restore</button>
                    {currentUser?.isAdmin && (
                      <button className="btn-ghost" style={{ fontSize: 12, color: 'var(--tint-red-fg)' }} onClick={() => permaDeleteTask(t.id)}>Delete</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {showIdSettings && (
          <div className="kanban-modal-overlay" onClick={e => { if (e.target === e.currentTarget) setShowIdSettings(false) }}>
            <div className="kanban-modal" style={{ maxWidth: 420 }}>
              <div className="kanban-modal-header">
                <span>Task IDs</span>
                <button className="kanban-modal-close" onClick={() => setShowIdSettings(false)}>✕</button>
              </div>
              <div className="task-form">
                <div className="task-assignees-label" style={{ marginBottom: 6 }}>Task ID prefix</div>
                <input
                  className="form-input"
                  placeholder="e.g. ENG, MED, CON, WAR"
                  value={idDraft.prefix}
                  maxLength={8}
                  onChange={e => setIdDraft(d => ({ ...d, prefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') }))}
                  style={{ textTransform: 'uppercase' }}
                />
                <div className="task-assignees-label" style={{ margin: '12px 0 6px' }}>Start number</div>
                <input
                  className="form-input"
                  type="number"
                  min={1}
                  placeholder="1"
                  value={idDraft.start}
                  onChange={e => setIdDraft(d => ({ ...d, start: e.target.value.replace(/[^0-9]/g, '') }))}
                />
                <p style={{ fontSize: 11, color: 'var(--muted)', margin: '8px 0 0' }}>
                  Tasks show <strong>{(idDraft.prefix || 'ENG')}-{idDraft.start || '1'}</strong>. New ids count up from the largest existing one, never below the start. Existing ids never change. Leave prefix blank to hide ids.
                </p>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
                  <button className="btn-ghost" onClick={() => setShowIdSettings(false)}>Cancel</button>
                  <SubmitButton className="btn-primary" onClick={saveIdSettings}>Save</SubmitButton>
                </div>
              </div>
            </div>
          </div>
        )}

        {showImport && (
          <div
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}
            onClick={e => { if (e.target === e.currentTarget) setShowImport(false) }}
          >
            <div style={{ background: 'var(--surface)', borderRadius: 14, width: '100%', maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,.18)' }}>
              <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h2 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>Import Tasks</h2>
                <button onClick={() => setShowImport(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--muted)', lineHeight: 1 }}>×</button>
              </div>
              <form onSubmit={handleImport} style={{ padding: '20px 22px' }}>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: 8 }}>Format</label>
                  <div style={{ display: 'flex', gap: 16 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                      <input type="radio" value="csv" checked={importFormat === 'csv'} onChange={() => setImportFormat('csv')} />
                      CSV
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                      <input type="radio" value="json" checked={importFormat === 'json'} onChange={() => setImportFormat('json')} />
                      JSON
                    </label>
                  </div>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: 8 }}>File</label>
                  <input
                    type="file"
                    accept={importFormat === 'csv' ? '.csv,text/csv' : '.json,application/json'}
                    onChange={e => { setImportFile(e.target.files?.[0] || null); setImportError(''); setImportSuccess('') }}
                    style={{ fontSize: 13 }}
                  />
                </div>
                {importFormat === 'csv' && (
                  <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.5 }}>
                    Required header: <code>title</code>. Optional: <code>status</code>, <code>priority</code>, <code>assignees</code> (semicolon-separated), <code>startDate</code>, <code>dueDate</code>, <code>description</code>
                  </p>
                )}
                {importFormat === 'json' && (
                  <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.5 }}>
                    Accepts the JSON export format or a plain array of task objects.
                  </p>
                )}
                {importError && <p style={{ color: 'var(--tint-red-fg)', fontSize: 13, marginBottom: 12 }}>{importError}</p>}
                {importSuccess && <p style={{ color: 'var(--tint-green-fg)', fontSize: 13, marginBottom: 12 }}>{importSuccess}</p>}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button type="button" onClick={() => setShowImport(false)} className="btn-ghost" style={{ fontSize: 13, padding: '7px 16px' }}>Cancel</button>
                  <button
                    type="submit"
                    disabled={!importFile || importing}
                    style={{ fontSize: 13, padding: '7px 16px', borderRadius: 8, border: 'none', background: 'var(--tint-indigo-fg)', color: 'var(--surface)', fontWeight: 600, cursor: importFile && !importing ? 'pointer' : 'not-allowed', opacity: importFile && !importing ? 1 : 0.6 }}
                  >
                    {importing ? 'Importing…' : 'Import'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </>
  )
}
