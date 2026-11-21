import { useState, useEffect } from 'react'
import { accessUrl } from '../../../lib/config-cache'
import { useRouter } from '../../../lib/router-compat'
import Link from 'next/link'
import Nav from '../../../components/Nav'
import PageHeader from '../../../components/PageHeader'
import MoreMenu from '../../../components/MoreMenu'
import { apiFetch } from '../../../lib/api-fetch'
import { enqueue } from '../../../lib/submit-queue'
import { isSuperAdmin } from '../../../lib/client-permissions'

export default function ProjectPage({ currentUser }) {
  const router = useRouter()
  const { slug } = router.query
  const [project, setProject] = useState(null)
  const [loading, setLoading] = useState(true)
  const [newVersion, setNewVersion] = useState(null) // null | { bump }
  const [submitting, setSubmitting] = useState(false)
  const [createError, setCreateError] = useState('')
  // What this caller may do/see in this project — personal + group grant capped by
  // the project's role policy. Null until it loads; treat as permissive so the
  // page does not flash empty for a fully-privileged user.
  const [perms, setPerms] = useState(null)

  useEffect(() => {
    if (!slug) return
    apiFetch(accessUrl(slug))
      .then(r => r.ok ? r.json() : null)
      .then(a => setPerms(Array.isArray(a?.effective) ? a.effective : null))
      .catch(() => {})
  }, [slug])

  const can = perm => isSuperAdmin(currentUser) || (perms ? perms.includes(perm) : true)

  useEffect(() => {
    if (!slug) return
    setLoading(true)
    apiFetch(`/api/projects/${slug}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { setProject(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [slug])

  // Deliberately NOT queued: this navigates straight into the editor for the new
  // version, which loads it from the server. The row has to exist first. The new
  // version starts as a copy of the latest one, so editing begins from what is there.
  async function handleCreateVersion(e) {
    e.preventDefault()
    setSubmitting(true)
    setCreateError('')
    try {
      const latest = (project.versions || [])[0]
      let content = ''
      if (latest) {
        const r = await apiFetch(`/api/projects/${slug}/versions/${latest.version}`)
        if (r.ok) content = (await r.json()).content || ''
      }
      const res = await apiFetch(`/api/projects/${slug}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bumpType: newVersion.bump, content }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setCreateError(data.error || 'Could not create the version.'); return }
      setNewVersion(null)
      router.push(`/editor?slug=${slug}&version=${data.version}`)
    } finally {
      setSubmitting(false)
    }
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
          {[0].map(i => (
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
  // What each bump would produce from the latest version — shown on the choice itself.
  const [maj, min, pat] = String(versions[0]?.version || '1.0.0').split('.').map(n => parseInt(n, 10) || 0)
  const nextFor = { patch: `${maj}.${min}.${pat + 1}`, minor: `${maj}.${min + 1}.0`, major: `${maj + 1}.0.0` }

  return (
    <>
      <Nav projectName={project.name} />
      <main className="page">
        <PageHeader
          title="Project Version"
          subtitle={project.description || 'Every version of this project. Open one to read or edit it.'}
          actions={can('proposal:promote') && (
            <button className="btn-primary" onClick={() => { setCreateError(''); setNewVersion(v => (v ? null : { bump: 'minor' })) }}>
              {newVersion ? 'Cancel' : '+ New Version'}
            </button>
          )}
        />

        {newVersion && (
          <form className="new-project-form new-version-form" onSubmit={handleCreateVersion}>
            <div className="new-version-choices" role="radiogroup" aria-label="Version number">
              {[['patch', 'Small fix'], ['minor', 'New features'], ['major', 'Big change']].map(([bump, hint]) => (
                <label key={bump} className={`new-version-choice${newVersion.bump === bump ? ' is-on' : ''}`}>
                  <input type="radio" name="bump" value={bump} checked={newVersion.bump === bump} onChange={() => setNewVersion({ bump })} />
                  <strong>v{nextFor[bump]}</strong>
                  <span>{hint}</span>
                </label>
              ))}
            </div>
            <div className="new-version-foot">
              <span className="epic-muted">
                {versions[0] ? `Starts as a copy of v${versions[0].version}, then opens in the editor.` : 'Starts empty and opens in the editor.'}
              </span>
              <button className="btn-primary" type="submit" disabled={submitting}>
                {submitting ? 'Creating…' : `Create v${nextFor[newVersion.bump]}`}
              </button>
            </div>
            {createError && <div className="kanban-col-error">{createError}</div>}
          </form>
        )}

        <div className="section-grid">
          {/* Versions */}
          {can('version:view') && (
          <section className="section-card">
            <div className="section-card-header">
              <span>Versions</span>
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
                    <div className="version-actions">
                      <Link href={`/editor?slug=${slug}&version=${v.version}`} className="btn-ghost btn-sm">
                        Open
                      </Link>
                      <MoreMenu
                        label={`More for v${v.version}`}
                        items={[
                          { label: 'View tasks', onClick: () => router.push(`/projects/${slug}/tasks?version=${v.version}`) },
                          { label: 'Compare with latest', hidden: versions.length < 2 || i === 0, onClick: () => router.push(`/projects/${slug}/diff?left=${v.version}&leftType=version&right=${versions[0].version}`) },
                          { label: 'Delete version', danger: true, hidden: !isSuperAdmin(currentUser), onClick: () => handleDeleteVersion(v.version) },
                        ]}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
          )}

        </div>
      </main>
    </>
  )
}
