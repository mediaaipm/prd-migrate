import { useState, useEffect } from 'react'
import Link from 'next/link'
import Nav from '../components/Nav'
import { apiFetch } from '../lib/api-fetch'

export default function Home({ currentUser }) {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', taskPrefix: '', taskSeqStart: '' })
  const [showForm, setShowForm] = useState(false)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterPriority, setFilterPriority] = useState('')
  const [sortDate, setSortDate] = useState('')
  const [filterPerson, setFilterPerson] = useState('')
  const [allAssignees, setAllAssignees] = useState([])

  useEffect(() => { fetchProjects() }, [])
  useEffect(() => {
    fetch('/api/assignees').then(r => r.ok ? r.json() : []).then(setAllAssignees).catch(() => {})
  }, [])

  async function fetchProjects() {
    setLoading(true)
    try {
      const res = await apiFetch('/api/projects')
      if (res.ok) setProjects(await res.json())
    } finally {
      setLoading(false)
    }
  }

  async function handleDeleteProject(slug, name) {
    if (!confirm(`Delete project "${name}" and all its data? This cannot be undone.`)) return
    const res = await apiFetch(`/api/projects/${slug}`, { method: 'DELETE' })
    if (res.ok) setProjects(prev => prev.filter(p => p.slug !== slug))
  }

  async function handleCreate(e) {
    e.preventDefault()
    if (!form.name.trim()) return
    setCreating(true)
    try {
      const res = await apiFetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (res.ok) {
        setShowForm(false)
        setForm({ name: '', description: '', taskPrefix: '', taskSeqStart: '' })
        fetchProjects()
      }
    } finally {
      setCreating(false)
    }
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

  return (
    <>
      <Nav />
      <main className="page">
        <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1>Projects</h1>
            <p>Select a project to view and edit its PRDs.</p>
          </div>
          <button className="btn-primary" onClick={() => setShowForm(v => !v)}>
            {showForm ? 'Cancel' : '+ New Project'}
          </button>
        </div>

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
              <button className="btn-primary" type="submit" disabled={creating || !form.name.trim()}>
                {creating ? 'Creating…' : 'Create'}
              </button>
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
              <div key={p.slug} className="project-card" style={{ position: 'relative' }}>
                {currentUser?.isAdmin && (
                  <button
                    onClick={e => { e.preventDefault(); handleDeleteProject(p.slug, p.name) }}
                    style={{ position: 'absolute', top: 8, right: 8, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 14, lineHeight: 1, padding: '2px 6px' }}
                    title="Delete project"
                  >&#x2715;</button>
                )}
                <Link href={`/projects/${p.slug}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
                  <div className="project-card-header">
                    <span className="project-icon">&#9670;</span>
                    <span className="project-name">{p.name}</span>
                  </div>
                  {p.description && <p className="project-desc">{p.description}</p>}
                  <div className="project-meta">
                    <span className="meta-badge">v{p.latestVersion || '—'}</span>
                    {p.pendingProposals > 0 && (
                      <span className="meta-badge pending">{p.pendingProposals} pending</span>
                    )}
                    {p.status && p.status !== 'active' && (
                      <span className={`meta-badge project-status-badge project-status--${p.status}`}>{p.status === 'on-hold' ? 'On Hold' : p.status.charAt(0).toUpperCase() + p.status.slice(1)}</span>
                    )}
                    {p.priority && p.priority !== 'medium' && (
                      <span className={`meta-badge project-priority-badge project-priority--${p.priority}`}>{p.priority.charAt(0).toUpperCase() + p.priority.slice(1)}</span>
                    )}
                  </div>
                </Link>
              </div>
            ))}
          </div>
        )}
      </main>
    </>
  )
}
