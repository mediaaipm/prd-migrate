import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import Nav from '../../../components/Nav'
import { apiFetch } from '../../../lib/api-fetch'
import { enqueue } from '../../../lib/submit-queue'
import { isSuperAdmin } from '../../../lib/client-permissions'

export default function ProjectPage({ currentUser }) {
  const router = useRouter()
  const { slug } = router.query
  const [project, setProject] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showProposal, setShowProposal] = useState(false)
  const [proposalForm, setProposalForm] = useState({ title: '', description: '', assignee: '', startDate: '', dueDate: '' })
  const [submitting, setSubmitting] = useState(false)
  const [assignees, setAssignees] = useState([])

  useEffect(() => {
    fetch('/api/assignees').then(r => r.ok ? r.json() : []).then(setAssignees).catch(() => {})
  }, [])

  useEffect(() => {
    if (!slug) return
    setLoading(true)
    apiFetch(`/api/projects/${slug}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { setProject(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [slug])

  // Deliberately NOT queued: this navigates straight into the editor for the new
  // proposal, which loads it by id from the server. The row has to exist first.
  async function handleNewProposal(e) {
    e.preventDefault()
    setSubmitting(true)
    try {
      const res = await apiFetch(`/api/projects/${slug}/proposals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(proposalForm),
      })
      if (res.ok) {
        const p = await res.json()
        setShowProposal(false)
        setProposalForm({ title: '', description: '', assignee: '', startDate: '', dueDate: '' })
        router.push(`/editor?slug=${slug}&type=proposal&id=${p.id}`)
      }
    } finally {
      setSubmitting(false)
    }
  }

  function handleDeleteProposal(proposalId, title) {
    if (!confirm(`Delete proposal "${title}"? This cannot be undone.`)) return
    setProject(prev => ({ ...prev, proposals: prev.proposals.filter(p => p.id !== proposalId) }))
    enqueue({
      url: `/api/projects/${slug}/proposals/${proposalId}`,
      method: 'DELETE',
      label: `Delete proposal “${title}”`,
    })
  }

  function handleDeleteVersion(v) {
    if (!confirm(`Delete PRD v${v}? This removes its content and version-scoped tasks. This cannot be undone.`)) return
    setProject(prev => ({ ...prev, versions: prev.versions.filter(x => x.version !== v) }))
    enqueue({
      url: `/api/projects/${slug}/versions/${v}`,
      method: 'DELETE',
      label: `Delete PRD v${v}`,
    })
  }

  // Deliberately NOT queued: the caller renders the version number the server picks.
  async function handlePromote(proposalId) {
    const bumpType = prompt('Bump type: major / minor / patch', 'minor')
    if (!bumpType) return
    const res = await apiFetch(`/api/projects/${slug}/proposals/${proposalId}/promote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bumpType }),
    })
    if (res.ok) {
      const v = await res.json()
      setProject(prev => ({
        ...prev,
        proposals: prev.proposals.map(p => p.id === proposalId ? { ...p, status: 'promoted', promotedToVersion: v.version } : p),
        versions: [v, ...prev.versions],
      }))
    }
  }

  if (loading) return (
    <>
      <Nav />
      <main className="page">
        <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <span className="skeleton" style={{ width: 160, height: 12, marginBottom: 8 }} />
            <span className="skeleton" style={{ width: 220, height: 26, marginBottom: 8 }} />
            <span className="skeleton" style={{ width: 300, height: 13 }} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <span className="skeleton" style={{ width: 72, height: 32, borderRadius: 8 }} />
            <span className="skeleton" style={{ width: 110, height: 32, borderRadius: 8 }} />
          </div>
        </div>
        <div className="section-grid" style={{ marginTop: 32 }}>
          {[0, 1].map(i => (
            <section key={i} className="section-card">
              <div className="section-card-header">
                <span className="skeleton" style={{ width: 100, height: 13 }} />
                <span className="skeleton" style={{ width: 28, height: 20, borderRadius: 20 }} />
              </div>
              <div className="version-list">
                {[0, 1, 2].map(j => (
                  <div key={j} className="version-row">
                    <div className="version-info">
                      <span className="skeleton" style={{ width: 48, height: 13, borderRadius: 4 }} />
                      <span className="skeleton" style={{ width: 90, height: 11 }} />
                    </div>
                    <span className="skeleton" style={{ width: 54, height: 26, borderRadius: 6 }} />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>
    </>
  )
  if (!project) return <><Nav /><main className="page"><div className="empty-state">Project not found.</div></main></>

  const versions = project.versions || []
  const proposals = project.proposals || []
  const pendingProposals = proposals.filter(p => p.status === 'pending')

  return (
    <>
      <Nav />
      <main className="page">
        <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 4 }}>
              <Link href="/">Projects</Link> / {project.name}
            </div>
            <h1>{project.name}</h1>
            {project.description && <p>{project.description}</p>}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Link href={`/projects/${slug}/dashboard`} className="btn-ghost" style={{ fontSize: 13, padding: '6px 14px', textDecoration: 'none' }}>
              Dashboard
            </Link>
            <Link href={`/projects/${slug}/tasks`} className="btn-ghost" style={{ fontSize: 13, padding: '6px 14px', textDecoration: 'none' }}>
              Tasks
            </Link>
            <button className="btn-primary" onClick={() => setShowProposal(v => !v)}>
              {showProposal ? 'Cancel' : '+ New Proposal'}
            </button>
          </div>
        </div>

        {showProposal && (
          <form className="new-project-form" onSubmit={handleNewProposal}>
            <div className="form-row">
              <input
                className="form-input"
                placeholder="Proposal title"
                value={proposalForm.title}
                onChange={e => setProposalForm(f => ({ ...f, title: e.target.value }))}
                required
                autoFocus
              />
              <input
                className="form-input"
                placeholder="Description (optional)"
                value={proposalForm.description}
                onChange={e => setProposalForm(f => ({ ...f, description: e.target.value }))}
              />
              <select
                className="form-input"
                value={proposalForm.assignee}
                onChange={e => setProposalForm(f => ({ ...f, assignee: e.target.value }))}
              >
                <option value="">— Assignee —</option>
                {assignees.map(a => <option key={a.name} value={a.name}>{a.name}</option>)}
              </select>
              <input
                className="form-input"
                type="date"
                title="Start date"
                value={proposalForm.startDate}
                onChange={e => setProposalForm(f => ({ ...f, startDate: e.target.value }))}
              />
              <input
                className="form-input"
                type="date"
                title="Due date"
                value={proposalForm.dueDate}
                onChange={e => setProposalForm(f => ({ ...f, dueDate: e.target.value }))}
              />
              <button className="btn-primary" type="submit" disabled={submitting || !proposalForm.title.trim()}>
                {submitting ? 'Creating…' : 'Create & Edit'}
              </button>
            </div>
          </form>
        )}

        <div className="section-grid">
          {/* Versions */}
          <section className="section-card">
            <div className="section-card-header">
              <span>PRD Versions</span>
              <span className="badge">{versions.length}</span>
            </div>
            {versions.length === 0 ? (
              <div className="empty-state-sm">No versions yet.</div>
            ) : (
              <div className="version-list">
                {versions.map((v, i) => (
                  <div key={v.version} className="version-row">
                    <div className="version-info">
                      <span className="version-tag">v{v.version}</span>
                      {i === 0 && <span className="latest-tag">latest</span>}
                      <span className="version-date">{new Date(v.createdAt).toLocaleDateString()}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Link
                        href={`/projects/${slug}/tasks?version=${v.version}`}
                        className="btn-ghost"
                        style={{ fontSize: 12, padding: '4px 10px', textDecoration: 'none' }}
                        title="View tasks for this version"
                      >
                        Tasks
                      </Link>
                      <Link href={`/editor?slug=${slug}&version=${v.version}`} className="btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }}>
                        Open
                      </Link>
                      {versions.length > 1 && (
                        <Link
                          href={`/projects/${slug}/diff?left=${v.version}&leftType=version&right=${versions[0].version}`}
                          className="btn-ghost"
                          style={{ fontSize: 12, padding: '4px 10px', textDecoration: 'none' }}
                          title="Compare with latest version"
                        >
                          Compare
                        </Link>
                      )}
                      {isSuperAdmin(currentUser) && (
                        <button
                          className="btn-ghost"
                          style={{ fontSize: 12, padding: '4px 10px', color: 'var(--danger, #e05)' }}
                          onClick={() => handleDeleteVersion(v.version)}
                          title="Delete this PRD version"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Proposals */}
          <section className="section-card">
            <div className="section-card-header">
              <span>Proposals</span>
              {pendingProposals.length > 0 && <span className="badge pending">{pendingProposals.length} pending</span>}
            </div>
            {proposals.length === 0 ? (
              <div className="empty-state-sm">No proposals yet.</div>
            ) : (
              <div className="version-list">
                {proposals.map(p => (
                  <div key={p.id} className="version-row">
                    <div className="version-info" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                      <span className="version-tag" style={{ fontFamily: 'inherit', fontWeight: 600 }}>{p.title}</span>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span className={`status-tag ${p.status}`}>{p.status}</span>
                        {p.promotedToVersion && <span className="version-date">→ v{p.promotedToVersion}</span>}
                        {p.assignee && <span className="version-date">&#128100; {p.assignee}</span>}
                        {p.startDate && <span className="version-date">Start: {p.startDate}</span>}
                        {p.dueDate && <span className="version-date">Due: {p.dueDate}</span>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Link href={`/editor?slug=${slug}&type=proposal&id=${p.id}`} className="btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }}>
                        Edit
                      </Link>
                      {versions.length > 0 && (
                        <Link
                          href={`/projects/${slug}/diff?left=${p.id}&leftType=proposal&right=${versions[0].version}`}
                          className="btn-ghost"
                          style={{ fontSize: 12, padding: '4px 10px', textDecoration: 'none' }}
                          title="Compare proposal with latest version"
                        >
                          Compare
                        </Link>
                      )}
                      {p.status === 'pending' && (
                        <button className="btn-primary" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => handlePromote(p.id)}>
                          Promote
                        </button>
                      )}
                      {currentUser?.isAdmin && (
                        <button className="btn-ghost" style={{ fontSize: 12, padding: '4px 10px', color: 'var(--danger, #e05)' }} onClick={() => handleDeleteProposal(p.id, p.title)}>
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </>
  )
}
