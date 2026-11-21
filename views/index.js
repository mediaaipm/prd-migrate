import { useState, useEffect } from 'react'
import { assigneesUrl } from '../lib/config-cache'
import Link from 'next/link'
import Nav from '../components/Nav'
import PageHeader from '../components/PageHeader'
import SubmitButton from '../components/SubmitButton'
import MoreMenu from '../components/MoreMenu'
import { apiFetch } from '../lib/api-fetch'
import { isSuperAdmin, hasPerm } from '../lib/client-permissions'
import { useOptimistic } from '../lib/optimistic'
import { enqueue, onSync } from '../lib/submit-queue'
import { slugify } from '../lib/slugify'

export default function Home({ currentUser }) {
  const [serverProjects, setServerProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ name: '', description: '', taskPrefix: '', taskSeqStart: '' })
  const [showForm, setShowForm] = useState(false)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterPriority, setFilterPriority] = useState('')
  const [sortDate, setSortDate] = useState('')
  const [filterPerson, setFilterPerson] = useState('')
  const [allAssignees, setAllAssignees] = useState([])
  // The rename dialog's draft.
  const [showFilters, setShowFilters] = useState(false)
  const [renaming, setRenaming] = useState(null) // { slug, name, draft }

  // Pending creates/deletes are replayed over the server list, so a refetch that lands
  // mid-sync can neither drop a new project nor resurrect a deleted one.
  const projects = useOptimistic(serverProjects, { entity: 'project', key: 'slug' })

  useEffect(() => { fetchProjects() }, [])
  useEffect(() => {
    fetch(assigneesUrl()).then(r => r.ok ? r.json() : []).then(setAllAssignees).catch(() => {})
  }, [])

  // Pull the authoritative record once the server has it (createdAt, latestVersion).
  useEffect(() => onSync(item => {
    if (item.optimistic?.entity === 'project') return fetchProjects()
  }), [])

  async function fetchProjects() {
    setLoading(true)
    try {
      const res = await apiFetch('/api/projects')
      if (res.ok) setServerProjects(await res.json())
    } finally {
      setLoading(false)
    }
  }

  function handleDeleteProject(slug, name) {
    if (!confirm(`Delete project "${name}" and all its data? This cannot be undone.`)) return
    enqueue({
      url: `/api/projects/${slug}`,
      method: 'DELETE',
      label: `Delete project “${name}”`,
      optimistic: { entity: 'project', op: 'delete', id: slug },
    })
  }

  // Only the display name changes — the slug (and so every URL and redis key) is
  // immutable after creation.
  function handleRename(e) {
    e.preventDefault()
    const name = (renaming?.draft || '').trim()
    if (!name || name === renaming.name) { setRenaming(null); return }
    enqueue({
      url: `/api/projects/${renaming.slug}`,
      method: 'PUT',
      body: { name },
      label: `Rename project “${renaming.name}” to “${name}”`,
      optimistic: { entity: 'project', op: 'update', id: renaming.slug, patch: { name } },
    })
    setRenaming(null)
  }

  function handleCreate(e) {
    e.preventDefault()
    const name = form.name.trim()
    if (!name) return

    // The server derives the slug from the name the same way, so the optimistic card
    // and the eventual server record agree on the primary key — and a replayed POST
    // overwrites the same key rather than creating a second project.
    const slug = slugify(name)

    enqueue({
      url: '/api/projects',
      method: 'POST',
      body: form,
      label: `Create project “${name}”`,
      optimistic: {
        entity: 'project',
        op: 'create',
        data: {
          slug,
          name,
          description: form.description || '',
          status: 'active',
          priority: 'medium',
          members: [],
          latestVersion: '1.0.0',
          pendingProposals: 0,
          createdAt: new Date().toISOString(),
        },
      },
    })

    setShowForm(false)
    setForm({ name: '', description: '', taskPrefix: '', taskSeqStart: '' })
  }

  const q = search.toLowerCase()
  const pq = filterPerson.toLowerCase().trim()
  let filtered = projects.filter(p => {
    const members = Array.isArray(p.members) ? p.members : []
    return (
      (!q || p.name.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q)) &&
      (!filterStatus || (p.status || 'active') === filterStatus) &&
      (!filterPriority || (p.priority || 'medium') === filterPriority) &&
      (!pq || members.some(m => m.toLowerCase().includes(pq)))
    )
  })
  if (sortDate === 'oldest') filtered = [...filtered].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
  else if (sortDate === 'newest') filtered = [...filtered].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))

  const hasFilters = search || filterStatus || filterPriority || sortDate || filterPerson
  const activeFilterCount = [filterStatus, filterPriority, sortDate, filterPerson].filter(Boolean).length

  // Rename needs project:update; delete stays superadmin-only (the API enforces both).
  const canRename = hasPerm(currentUser, 'project:update')
  const canDelete = isSuperAdmin(currentUser)

  return (
    <>
      <Nav />
      <main className="page">
        <PageHeader
          title="Projects"
          subtitle="Open a project to manage its tasks."
          actions={
            <button className="btn-primary" onClick={() => setShowForm(v => !v)}>
              {showForm ? 'Cancel' : '+ New Project'}
            </button>
          }
        />

        {showForm && (
          <form className="new-project-form" onSubmit={handleCreate}>
            <div className="form-row">
              <input
                className="form-input"
                placeholder="Project name"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                required
                autoFocus
              />
              <input
                className="form-input"
                placeholder="Description (optional)"
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              />
              {/* Enter-to-submit goes through the form's onSubmit; the click goes through
                  onClick, which preventDefaults so only one of the two ever runs. */}
              <SubmitButton
                type="submit"
                className="btn-primary"
                busyLabel="Creating…"
                onClick={handleCreate}
                disabled={!form.name.trim()}
              >
                Create
              </SubmitButton>
            </div>
            <div className="form-row">
              <input
                className="form-input"
                placeholder="Task ID prefix (e.g. ENG)"
                value={form.taskPrefix}
                maxLength={8}
                onChange={e => setForm(f => ({ ...f, taskPrefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') }))}
                style={{ textTransform: 'uppercase', maxWidth: 200 }}
              />
              <input
                className="form-input"
                type="number"
                min={1}
                placeholder="Start number (e.g. 1001)"
                value={form.taskSeqStart}
                onChange={e => setForm(f => ({ ...f, taskSeqStart: e.target.value.replace(/[^0-9]/g, '') }))}
                style={{ maxWidth: 200 }}
              />
              <span style={{ fontSize: 12, color: 'var(--muted)', alignSelf: 'center' }}>
                First task → <strong>{(form.taskPrefix || 'ENG')}-{form.taskSeqStart || '1'}</strong>. Editable later.
              </span>
            </div>
          </form>
        )}

        {!loading && projects.length > 0 && (
          <div className="filter-bar">
            <div className="search-bar" style={{ flex: 1, minWidth: 160 }}>
              <input
                className="form-input search-input"
                placeholder="Search projects…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              {search && (
                <button className="btn-ghost search-clear" onClick={() => setSearch('')} title="Clear">&#x2715;</button>
              )}
            </div>
            {/* Search stays out; the rest folds away until asked for. */}
            <button
              type="button"
              className={`btn-ghost filter-toggle${showFilters || activeFilterCount ? ' is-on' : ''}`}
              onClick={() => setShowFilters(v => !v)}
              aria-expanded={showFilters}
            >
              Filters{activeFilterCount ? ` · ${activeFilterCount}` : ''}
            </button>
            {showFilters && <>
            <select className="form-input filter-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="on-hold">On Hold</option>
              <option value="archived">Archived</option>
            </select>
            <select className="form-input filter-select" value={filterPriority} onChange={e => setFilterPriority(e.target.value)}>
              <option value="">All priorities</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <select className="form-input filter-select" value={sortDate} onChange={e => setSortDate(e.target.value)}>
              <option value="">Date: Default</option>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
            {allAssignees.length > 0 && (
              <div className="search-bar" style={{ marginBottom: 0, minWidth: 150, maxWidth: 190 }}>
                <input
                  className="form-input search-input"
                  list="proj-assignee-list"
                  placeholder="Filter by person…"
                  value={filterPerson}
                  onChange={e => setFilterPerson(e.target.value)}
                />
                {filterPerson && (
                  <button className="btn-ghost search-clear" onClick={() => setFilterPerson('')} title="Clear">&#x2715;</button>
                )}
                <datalist id="proj-assignee-list">
                  {allAssignees.map(a => <option key={a.name} value={a.name} />)}
                </datalist>
              </div>
            )}
            </>}
            {hasFilters && (
              <button className="btn-ghost" style={{ whiteSpace: 'nowrap', fontSize: 12 }} onClick={() => { setSearch(''); setFilterStatus(''); setFilterPriority(''); setSortDate(''); setFilterPerson('') }}>
                Clear filters
              </button>
            )}
          </div>
        )}

        {loading ? (
          <div className="project-grid">
            {[0, 1, 2].map(i => (
              <div key={i} className="project-card" style={{ gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="skeleton" style={{ width: 14, height: 14, borderRadius: 3, flexShrink: 0 }} />
                  <span className="skeleton" style={{ width: '55%', height: 15 }} />
                </div>
                <span className="skeleton" style={{ width: '78%', height: 12 }} />
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  <span className="skeleton" style={{ width: 54, height: 20, borderRadius: 20 }} />
                </div>
              </div>
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">&#128196;</div>
            <p>No projects yet. Create your first project to get started.</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">&#128269;</div>
            <p>No projects match the current filters.</p>
          </div>
        ) : (
          <div className="project-grid">
            {filtered.map(p => (
              <div key={p.slug} className={`project-card${p._pending ? ' is-pending' : ''}`}>
                {p._pending && <span className="pending-dot" title="Saving…" />}
                <div className="project-card-header">
                  <span className="project-icon">&#9670;</span>
                  <span className="project-name">{p.name}</span>
                  {!p._pending && (
                    <MoreMenu label={`Actions for ${p.name}`} items={[
                      { label: 'Rename project', hidden: !canRename, onClick: () => setRenaming({ slug: p.slug, name: p.name, draft: p.name }) },
                      { label: 'Delete project', danger: true, hidden: !canDelete, onClick: () => handleDeleteProject(p.slug, p.name) },
                    ]} />
                  )}
                </div>
                {p.description && <p className="project-desc">{p.description}</p>}
                <div className="project-meta">
                  <span className="meta-badge">v{p.latestVersion || '—'}</span>
                  {p.status && p.status !== 'active' && (
                    <span className={`meta-badge project-status-badge project-status--${p.status}`}>{p.status === 'on-hold' ? 'On Hold' : p.status.charAt(0).toUpperCase() + p.status.slice(1)}</span>
                  )}
                  {p.priority && p.priority !== 'medium' && (
                    <span className={`meta-badge project-priority-badge project-priority--${p.priority}`}>{p.priority.charAt(0).toUpperCase() + p.priority.slice(1)}</span>
                  )}
                </div>
                <div className="project-card-footer">
                  {/* Opening a project whose POST has not landed would 404 — the task
                      manager loads it by slug. Swallow the click until the create syncs. */}
                  <Link
                    href={p._pending ? '#' : `/projects/${p.slug}/tasks`}
                    onClick={e => { if (p._pending) e.preventDefault() }}
                    aria-disabled={p._pending || undefined}
                    className="btn-primary project-open-btn"
                  >
                    Open
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}

        {renaming && (
          <div className="kanban-modal-overlay" onClick={e => { if (e.target === e.currentTarget) setRenaming(null) }}>
            <form className="kanban-modal" onSubmit={handleRename} onKeyDown={e => { if (e.key === 'Escape') setRenaming(null) }}>
              <div className="kanban-modal-header">
                <span>Rename project</span>
                <button type="button" className="kanban-modal-close" onClick={() => setRenaming(null)}>✕</button>
              </div>
              <div className="task-form">
                <input
                  className="form-input"
                  value={renaming.draft}
                  onChange={e => setRenaming(r => ({ ...r, draft: e.target.value }))}
                  autoFocus
                  maxLength={120}
                  aria-label="Project name"
                />
                <div className="task-form-hint">Only the display name changes — the project's links stay the same.</div>
                <div className="sprint-modal-actions">
                  <button type="button" className="btn-ghost" onClick={() => setRenaming(null)}>Cancel</button>
                  <button type="submit" className="btn-primary" disabled={!renaming.draft.trim()}>Rename</button>
                </div>
              </div>
            </form>
          </div>
        )}
      </main>
    </>
  )
}
