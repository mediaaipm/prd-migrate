import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Nav from '../components/Nav'
import { apiFetch } from '../lib/api-fetch'
import { ALL_PERMISSIONS, PERMISSION_LABELS } from '../lib/permissions'
import SubmitButton from '../components/SubmitButton'
import { enqueue, onSync } from '../lib/submit-queue'
import { useOptimistic } from '../lib/optimistic'

const ACTION_LABELS = {
  login: 'Logged in',
  logout: 'Logged out',
  login_failed: 'Login failed',
  view_project: 'Viewed project',
  create_project: 'Created project',
  delete_project: 'Deleted project',
  view_version: 'Viewed version',
  create_version: 'Created version',
  save_version: 'Saved version',
  view_diff: 'Viewed diff',
  create_proposal: 'Created proposal',
  update_proposal: 'Updated proposal',
  delete_proposal: 'Deleted proposal',
  promote_proposal: 'Promoted proposal',
  create_task: 'Created task',
  update_task: 'Updated task',
  delete_task: 'Deleted task',
  reorder_task: 'Reordered task',
  create_user: 'Created user',
  update_user_credentials: 'Updated user credentials',
  delete_user: 'Deleted user',
  create_snapshot: 'Created snapshot',
  delete_snapshot: 'Deleted snapshot',
}

function formatTime(ts) {
  try {
    return new Date(ts).toLocaleString()
  } catch {
    return ts
  }
}

function detailSummary(action, details) {
  if (!details) return []
  const parts = []
  if (details.slug) parts.push(details.slug)
  if (details.name) parts.push(details.name)
  if (details.title) parts.push(`"${details.title}"`)
  if (details.taskId) parts.push(<code key="tid" style={{ fontSize: 11, background: 'var(--sidebar-bg)', padding: '1px 4px', borderRadius: 3 }}>{details.taskId}</code>)
  if (details.version) parts.push(`v${details.version}`)
  if (details.newVersion) parts.push(`→ v${details.newVersion}`)
  if (details.direction) parts.push(details.direction)
  if (details.fields && details.fields.length) parts.push(`[${details.fields.join(', ')}]`)
  if (details.statusFrom != null || details.statusTo != null) parts.push(`${details.statusFrom ?? '?'} → ${details.statusTo ?? '?'}`)
  return parts
}

function AuditLog() {
  const [logs, setLogs] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [offset, setOffset] = useState(0)
  const [search, setSearch] = useState('')
  const LIMIT = 50

  useEffect(() => { fetchLogs(0) }, [])

  async function fetchLogs(off) {
    setLoading(true)
    try {
      const res = await apiFetch(`/api/audit?limit=${LIMIT}&offset=${off}`)
      if (res.ok) {
        const data = await res.json()
        setLogs(data.logs || [])
        setTotal(data.total || 0)
        setOffset(off)
      }
    } finally {
      setLoading(false)
    }
  }

  const q = search.trim().toLowerCase()
  const filteredLogs = q
    ? logs.filter(log => {
        const who = `${log.user?.name || ''} ${log.user?.username || ''}`.toLowerCase()
        const action = (ACTION_LABELS[log.action] || log.action || '').toLowerCase()
        const details = JSON.stringify(log.details || '').toLowerCase()
        const resource = (log.resource || '').toLowerCase()
        return who.includes(q) || action.includes(q) || details.includes(q) || resource.includes(q)
      })
    : logs

  return (
    <section className="section-card" style={{ marginTop: 24 }}>
      <div className="section-card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>Audit Log</span>
          {!loading && <span className="badge">{total}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="search"
            placeholder="Search logs…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--fg)', outline: 'none', width: 200 }}
          />
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <span className="skeleton" style={{ width: 140, height: 11 }} />
              <span className="skeleton" style={{ width: 80, height: 11 }} />
              <span className="skeleton" style={{ width: `${30 + i * 8}%`, height: 11 }} />
            </div>
          ))}
        </div>
      ) : filteredLogs.length === 0 ? (
        <div className="empty-state-sm" style={{ padding: '20px 16px' }}>{q ? 'No matching logs.' : 'No activity logged yet.'}</div>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: '8px 16px', color: 'var(--muted)', fontWeight: 500, whiteSpace: 'nowrap' }}>When</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--muted)', fontWeight: 500 }}>Who</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--muted)', fontWeight: 500 }}>Action</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px 8px 0', color: 'var(--muted)', fontWeight: 500 }}>Details</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map(log => (
                  <tr key={log.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '7px 16px', color: 'var(--muted)', whiteSpace: 'nowrap', fontSize: 12 }}>
                      {formatTime(log.timestamp)}
                    </td>
                    <td style={{ padding: '7px 12px', whiteSpace: 'nowrap' }}>
                      {log.user ? (
                        <span>
                          <span style={{ fontWeight: 500, color: 'var(--fg)' }}>{log.user.name}</span>
                          {log.user.username && (
                            <span style={{ color: 'var(--muted)', fontSize: 11 }}> @{log.user.username}</span>
                          )}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--muted)', fontStyle: 'italic' }}>unknown</span>
                      )}
                    </td>
                    <td style={{ padding: '7px 12px', whiteSpace: 'nowrap' }}>
                      <span style={{
                        background: log.action === 'login_failed'
                          ? 'rgba(220,38,38,0.15)'
                          : log.action === 'logout'
                            ? 'rgba(251,146,60,0.15)'
                            : log.action?.startsWith('view_')
                              ? 'rgba(148,163,184,0.12)'
                              : 'rgba(99,102,241,0.12)',
                        color: log.action === 'login_failed'
                          ? '#f87171'
                          : log.action === 'logout'
                            ? '#fb923c'
                            : log.action?.startsWith('view_')
                              ? 'var(--muted)'
                              : 'var(--accent, #818cf8)',
                        borderRadius: 4, padding: '2px 7px', fontSize: 11, fontWeight: 500,
                      }}>
                        {ACTION_LABELS[log.action] || log.action}
                      </span>
                    </td>
                    <td style={{ padding: '7px 12px 7px 0', color: 'var(--muted)', fontSize: 12 }}>
                      {detailSummary(log.action, log.details).map((part, i, arr) => (
                        <span key={i}>{part}{i < arr.length - 1 ? ' · ' : ''}</span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {total > LIMIT && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderTop: '1px solid var(--border)' }}>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                Showing {offset + 1}–{Math.min(offset + LIMIT, total)} of {total}
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  className="btn-ghost"
                  style={{ fontSize: 12, padding: '3px 10px' }}
                  disabled={offset === 0}
                  onClick={() => fetchLogs(Math.max(0, offset - LIMIT))}
                >
                  Newer
                </button>
                <button
                  className="btn-ghost"
                  style={{ fontSize: 12, padding: '3px 10px' }}
                  disabled={offset + LIMIT >= total}
                  onClick={() => fetchLogs(offset + LIMIT)}
                >
                  Older
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}

function AdminPermissionEditor({ admin, onSaved }) {
  const [perms, setPerms] = useState(admin.permissions || ALL_PERMISSIONS)
  const [assignedProjects, setAssignedProjects] = useState(admin.assignedProjects || null)
  const [projects, setProjects] = useState([])

  useEffect(() => {
    fetch('/api/projects').then(r => r.ok ? r.json() : []).then(data => setProjects(data || [])).catch(() => {})
  }, [])

  function toggle(perm) {
    setPerms(prev => prev.includes(perm) ? prev.filter(p => p !== perm) : [...prev, perm])
  }

  function toggleProject(slug) {
    setAssignedProjects(prev => {
      const arr = prev || projects.map(p => p.slug)
      return arr.includes(slug) ? arr.filter(s => s !== slug) : [...arr, slug]
    })
  }

  function handleSave() {
    enqueue({
      url: `/api/admin/users/${encodeURIComponent(admin.name)}`,
      method: 'PUT',
      body: { permissions: perms, assignedProjects },
      optimistic: { entity: 'admin', op: 'update', id: admin.name, patch: { permissions: perms, assignedProjects } },
      label: `Save permissions for ${admin.name}`,
    })
    onSaved()
  }

  const GROUPS = [
    { label: 'Projects', perms: ['project:create', 'project:update'] },
    { label: 'Proposals', perms: ['proposal:create', 'proposal:update', 'proposal:delete', 'proposal:promote'] },
    { label: 'Tasks', perms: ['task:create', 'task:update', 'task:delete'] },
    { label: 'Other', perms: ['assignee:manage', 'snapshot:manage', 'audit:view'] },
  ]

  const allSlugs = projects.map(p => p.slug)
  const effectiveProjects = assignedProjects || allSlugs

  return (
    <div style={{ padding: '10px 16px 14px', background: 'var(--sidebar-bg)', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {GROUPS.map(group => (
        <div key={group.label}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{group.label}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {group.perms.map(perm => {
              const active = perms.includes(perm)
              return (
                <button
                  key={perm}
                  type="button"
                  onClick={() => toggle(perm)}
                  style={{
                    fontSize: 12, padding: '4px 10px', borderRadius: 5, cursor: 'pointer', border: '1px solid',
                    borderColor: active ? 'var(--accent, #818cf8)' : 'var(--border)',
                    background: active ? 'rgba(129,140,248,0.12)' : 'transparent',
                    color: active ? 'var(--accent, #818cf8)' : 'var(--muted)',
                    fontWeight: active ? 500 : 400,
                  }}
                >
                  {active ? '✓ ' : ''}{PERMISSION_LABELS[perm]}
                </button>
              )
            })}
          </div>
        </div>
      ))}

      {projects.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Project Access
            </div>
            <button
              type="button"
              onClick={() => setAssignedProjects(null)}
              style={{ fontSize: 11, padding: '2px 7px', borderRadius: 4, cursor: 'pointer', border: '1px solid', borderColor: assignedProjects === null ? 'var(--accent, #818cf8)' : 'var(--border)', background: assignedProjects === null ? 'rgba(129,140,248,0.12)' : 'transparent', color: assignedProjects === null ? 'var(--accent, #818cf8)' : 'var(--muted)' }}
            >
              All projects
            </button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {projects.map(p => {
              const active = effectiveProjects.includes(p.slug)
              return (
                <button
                  key={p.slug}
                  type="button"
                  onClick={() => {
                    if (assignedProjects === null) {
                      setAssignedProjects(allSlugs.filter(s => s !== p.slug))
                    } else {
                      toggleProject(p.slug)
                    }
                  }}
                  style={{
                    fontSize: 12, padding: '4px 10px', borderRadius: 5, cursor: 'pointer', border: '1px solid',
                    borderColor: active ? 'var(--accent, #818cf8)' : 'var(--border)',
                    background: active ? 'rgba(129,140,248,0.12)' : 'transparent',
                    color: active ? 'var(--accent, #818cf8)' : 'var(--muted)',
                    fontWeight: active ? 500 : 400,
                  }}
                >
                  {active ? '✓ ' : ''}{p.name}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <SubmitButton className="btn-primary" style={{ fontSize: 12, padding: '4px 14px' }} onClick={handleSave}>
          Save
        </SubmitButton>
        <button
          className="btn-ghost"
          style={{ fontSize: 12, padding: '4px 10px' }}
          onClick={() => setPerms(ALL_PERMISSIONS)}
        >
          Grant all perms
        </button>
        <button
          className="btn-ghost"
          style={{ fontSize: 12, padding: '4px 10px' }}
          onClick={() => setPerms([])}
        >
          Revoke all perms
        </button>
      </div>
    </div>
  )
}

function AdminPasswordEditor({ adminName, onSaved }) {
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)

  function handleSave() {
    if (!password) return
    // No optimistic descriptor: the password is never rendered in the admin list,
    // so there is nothing to overlay — the write just needs to reach the server.
    enqueue({
      url: `/api/admin/users/${encodeURIComponent(adminName)}`,
      method: 'PUT',
      body: { password },
      label: `Change password for ${adminName}`,
    })
    setPassword('')
    onSaved()
  }

  return (
    <div style={{ padding: '10px 16px 14px', background: 'var(--sidebar-bg)', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ position: 'relative', flex: 1, maxWidth: 280 }}>
        <input
          className="form-input"
          type={showPw ? 'text' : 'password'}
          placeholder="New password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          style={{ width: '100%', paddingRight: 32 }}
          onKeyDown={e => e.key === 'Enter' && handleSave()}
          autoFocus
        />
        <button type="button" onClick={() => setShowPw(v => !v)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 14, padding: 0 }} title={showPw ? 'Hide' : 'Show'}>
          {showPw ? '🙈' : '👁'}
        </button>
      </div>
      <SubmitButton className="btn-primary" style={{ fontSize: 12, padding: '4px 14px' }} onClick={handleSave} disabled={!password}>
        Save
      </SubmitButton>
    </div>
  )
}

function AdminsTab() {
  const [rawAdmins, setRawAdmins] = useState([])
  const admins = useOptimistic(rawAdmins, { entity: 'admin', key: 'name' })
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ name: '', username: '', password: '' })
  const [newPerms, setNewPerms] = useState(ALL_PERMISSIONS)
  const [showPw, setShowPw] = useState(false)
  const [expanded, setExpanded] = useState(null)
  const [expandedPw, setExpandedPw] = useState(null)
  const [renaming, setRenaming] = useState(null)
  const [renameVal, setRenameVal] = useState('')

  useEffect(() => { fetchAdmins() }, [])

  // Pull the authoritative record once a queued admin write lands. Password saves
  // carry no descriptor, so fall back to matching the URL.
  useEffect(() => onSync(item => {
    if (item.optimistic?.entity === 'admin' || (!item.optimistic && item.url.startsWith('/api/admin/users'))) return fetchAdmins()
  }), [])

  async function fetchAdmins() {
    setLoading(true)
    try {
      const res = await apiFetch('/api/admin/users')
      if (res.ok) setRawAdmins(await res.json())
    } finally {
      setLoading(false)
    }
  }

  function handleAdd(e) {
    e.preventDefault()
    const name = form.name.trim()
    const username = form.username.trim()
    if (!name || !username || !form.password) return
    enqueue({
      url: '/api/admin/users',
      method: 'POST',
      body: { name, username, password: form.password, permissions: newPerms },
      optimistic: { entity: 'admin', op: 'create', data: { name, username, permissions: newPerms, assignedProjects: null } },
      label: `Add admin ${name}`,
    })
    setForm({ name: '', username: '', password: '' })
    setNewPerms(ALL_PERMISSIONS)
  }

  // Not queued: the server returns 409 when the new name collides with an existing
  // user — a uniqueness check the client cannot make.
  async function handleRename(oldName) {
    const trimmed = renameVal.trim()
    if (!trimmed || trimmed === oldName) { setRenaming(null); return }
    const res = await apiFetch(`/api/admin/users/${encodeURIComponent(oldName)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newName: trimmed }),
    })
    if (res.ok) {
      setRenaming(null)
      fetchAdmins()
    } else {
      const d = await res.json().catch(() => ({}))
      alert(d.error || 'Rename failed.')
    }
  }

  function handleRemove(name) {
    if (!confirm(`Remove admin "${name}"? They will lose admin access.`)) return
    enqueue({
      url: `/api/admin/users/${encodeURIComponent(name)}`,
      method: 'DELETE',
      optimistic: { entity: 'admin', op: 'delete', id: name },
      label: `Remove admin ${name}`,
    })
  }

  // Not queued: reads d.updated off the response to report how many admins were
  // changed — a count the client cannot know until the server answers.
  async function handleApplyAll() {
    if (!admins.length) return
    if (!confirm(`Grant the full permission list to all ${admins.length} admin(s)? This overwrites their current permissions.`)) return
    const res = await apiFetch('/api/admin/users/bulk-permissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissions: ALL_PERMISSIONS }),
    })
    if (res.ok) {
      const d = await res.json()
      await fetchAdmins()
      alert(`Updated ${d.updated} admin(s) to the full permission list.`)
    } else {
      const d = await res.json().catch(() => ({}))
      alert(d.error || 'Failed to update permissions')
    }
  }

  return (
    <section className="section-card" style={{ marginTop: 0, borderRadius: '0 6px 6px 6px' }}>
      <div className="section-card-header">
        <span>Admins</span>
        {!loading && <span className="badge">{admins.length}</span>}
        {!loading && admins.length > 0 && (
          <SubmitButton
            className="btn-ghost"
            style={{ marginLeft: 'auto', fontSize: 12, whiteSpace: 'nowrap' }}
            onClick={handleApplyAll}
            busyLabel="Applying…"
            title="Grant every permission to all secondary admins"
          >
            Grant full permissions to all
          </SubmitButton>
        )}
      </div>

      <form onSubmit={handleAdd} style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>Admins can only perform actions you grant them. They cannot delete projects.</p>
        <div className="form-row">
          <input className="form-input" placeholder="Display name *" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
          <input className="form-input" placeholder="Username *" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} required />
        </div>
        <div className="form-row">
          <div style={{ position: 'relative', flex: 1 }}>
            <input
              className="form-input"
              type={showPw ? 'text' : 'password'}
              placeholder="Password *"
              value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              style={{ width: '100%', paddingRight: 32 }}
              required
            />
            <button type="button" onClick={() => setShowPw(v => !v)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 14, padding: 0 }} title={showPw ? 'Hide' : 'Show'}>
              {showPw ? '🙈' : '👁'}
            </button>
          </div>
          <SubmitButton className="btn-primary" type="submit" onClick={handleAdd} disabled={!form.name.trim() || !form.username.trim() || !form.password} busyLabel="Adding…" style={{ whiteSpace: 'nowrap' }}>
            + Add Admin
          </SubmitButton>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {ALL_PERMISSIONS.map(perm => {
            const active = newPerms.includes(perm)
            return (
              <button
                key={perm}
                type="button"
                onClick={() => setNewPerms(prev => active ? prev.filter(p => p !== perm) : [...prev, perm])}
                style={{
                  fontSize: 11, padding: '3px 8px', borderRadius: 4, cursor: 'pointer', border: '1px solid',
                  borderColor: active ? 'var(--accent, #818cf8)' : 'var(--border)',
                  background: active ? 'rgba(129,140,248,0.12)' : 'transparent',
                  color: active ? 'var(--accent, #818cf8)' : 'var(--muted)',
                }}
              >
                {active ? '✓ ' : ''}{PERMISSION_LABELS[perm]}
              </button>
            )
          })}
        </div>
      </form>

      {loading ? (
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[0, 1].map(i => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="skeleton" style={{ width: `${40 + i * 20}%`, height: 14 }} />
              <span className="skeleton" style={{ width: 80, height: 28, borderRadius: 6 }} />
            </div>
          ))}
        </div>
      ) : admins.length === 0 ? (
        <div className="empty-state-sm" style={{ padding: '20px 16px' }}>No admins yet. Add one above.</div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {admins.map(admin => (
            <li key={admin.name} style={{ borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 14, color: 'var(--fg)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                    🛡
                    {renaming === admin.name ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <input
                          className="form-input"
                          value={renameVal}
                          onChange={e => setRenameVal(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') handleRename(admin.name); if (e.key === 'Escape') setRenaming(null) }}
                          style={{ fontSize: 14, padding: '2px 8px', width: 180 }}
                          autoFocus
                        />
                        <SubmitButton className="btn-primary" style={{ fontSize: 12, padding: '3px 10px' }} onClick={() => handleRename(admin.name)} disabled={!renameVal.trim()}>
                          Save
                        </SubmitButton>
                        <button className="btn-ghost" style={{ fontSize: 12, padding: '3px 8px' }} onClick={() => setRenaming(null)}>
                          Cancel
                        </button>
                      </span>
                    ) : admin.name}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {admin.username ? `@${admin.username}` : <em>no username</em>}
                    {' · '}
                    {(admin.permissions || []).length}/{ALL_PERMISSIONS.length} permissions
                    {' · '}
                    {admin.assignedProjects === null ? 'all projects' : `${(admin.assignedProjects || []).length} project${(admin.assignedProjects || []).length !== 1 ? 's' : ''}`}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {renaming !== admin.name && (
                    <button
                      className="btn-ghost"
                      style={{ fontSize: 12, padding: '4px 10px' }}
                      onClick={() => { setRenaming(admin.name); setRenameVal(admin.name); setExpanded(null); setExpandedPw(null) }}
                    >
                      Rename
                    </button>
                  )}
                  <button
                    className="btn-ghost"
                    style={{ fontSize: 12, padding: '4px 10px' }}
                    onClick={() => { setExpanded(v => v === admin.name ? null : admin.name); setExpandedPw(null) }}
                  >
                    {expanded === admin.name ? 'Done' : 'Permissions'}
                  </button>
                  <button
                    className="btn-ghost"
                    style={{ fontSize: 12, padding: '4px 10px' }}
                    onClick={() => { setExpandedPw(v => v === admin.name ? null : admin.name); setExpanded(null) }}
                  >
                    {expandedPw === admin.name ? 'Cancel' : 'Change Password'}
                  </button>
                  <SubmitButton className="btn-ghost" style={{ fontSize: 12, padding: '4px 10px', color: 'var(--danger, #e05)' }} onClick={() => handleRemove(admin.name)} busyLabel="Removing…">
                    Remove
                  </SubmitButton>
                </div>
              </div>
              {expanded === admin.name && (
                <AdminPermissionEditor admin={admin} onSaved={() => setExpanded(null)} />
              )}
              {expandedPw === admin.name && (
                <AdminPasswordEditor adminName={admin.name} onSaved={() => setExpandedPw(null)} />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function RoleBadge({ role }) {
  const r = role || 'user'
  const label = r === 'superadmin' ? 'Super Admin' : r === 'admin' ? 'Admin' : 'User'
  const isPriv = r === 'admin' || r === 'superadmin'
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4,
      color: isPriv ? 'var(--accent)' : 'var(--muted)',
      border: `1px solid ${isPriv ? 'var(--accent)' : 'var(--border)'}`,
      borderRadius: 4, padding: '1px 5px', whiteSpace: 'nowrap',
    }}>{label}</span>
  )
}

function UserRow({ user, onRemove, onSaved, isSuperAdmin }) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ username: user.username || '', password: '' })
  const [showPw, setShowPw] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameVal, setRenameVal] = useState(user.name)

  // Not queued: the server returns 409 when the new name collides with an existing
  // user — a uniqueness check the client cannot make, so we await it and surface the
  // error before closing the rename field.
  async function handleRename() {
    const trimmed = renameVal.trim()
    if (!trimmed || trimmed === user.name) { setRenaming(false); return }
    const res = await apiFetch(`/api/assignees/${encodeURIComponent(user.name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newName: trimmed }),
    })
    if (res.ok) {
      setRenaming(false)
      onSaved()
    } else {
      const d = await res.json().catch(() => ({}))
      alert(d.error || 'Rename failed.')
    }
  }

  function handleSave() {
    const body = { username: form.username }
    if (form.password) body.password = form.password
    const patch = { username: form.username }
    if (form.password) patch.hasPassword = true
    enqueue({
      url: `/api/assignees/${encodeURIComponent(user.name)}`,
      method: 'PUT',
      body,
      optimistic: { entity: 'user', op: 'update', id: user.name, patch },
      label: `Update ${user.name} credentials`,
    })
    setEditing(false)
    setForm(f => ({ ...f, password: '' }))
  }

  return (
    <li style={{ borderBottom: '1px solid var(--border)' }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '10px 16px',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 14, color: 'var(--fg)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
            <RoleBadge role={user.role} />
            &#128100;
            {renaming ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <input
                  className="form-input"
                  value={renameVal}
                  onChange={e => setRenameVal(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') { setRenaming(false); setRenameVal(user.name) } }}
                  style={{ fontSize: 14, padding: '2px 8px', width: 180 }}
                  autoFocus
                />
                <SubmitButton className="btn-primary" style={{ fontSize: 12, padding: '3px 10px' }} onClick={handleRename} disabled={!renameVal.trim()}>
                  Save
                </SubmitButton>
                <button className="btn-ghost" style={{ fontSize: 12, padding: '3px 8px' }} onClick={() => { setRenaming(false); setRenameVal(user.name) }}>
                  Cancel
                </button>
              </span>
            ) : (
              user.name
            )}
          </span>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            {user.username ? `@${user.username}` : <em>no username set</em>}
            {' · '}
            {user.hasPassword ? '••••••' : <em>no password set</em>}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {isSuperAdmin && !renaming && (
            <button
              className="btn-ghost"
              style={{ fontSize: 12, padding: '4px 10px' }}
              onClick={() => { setRenaming(true); setRenameVal(user.name) }}
            >
              Rename
            </button>
          )}
          <button
            className="btn-ghost"
            style={{ fontSize: 12, padding: '4px 10px' }}
            onClick={() => { setEditing(v => !v); setForm({ username: user.username || '', password: '' }) }}
          >
            {editing ? 'Cancel' : 'Set credentials'}
          </button>
          <SubmitButton
            className="btn-ghost"
            style={{ fontSize: 12, padding: '4px 10px', color: 'var(--danger, #e05)' }}
            onClick={() => onRemove(user.name)}
            busyLabel="Removing…"
          >
            Remove
          </SubmitButton>
        </div>
      </div>

      {editing && (
        <div style={{
          padding: '10px 16px 14px', background: 'var(--sidebar-bg)',
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <div className="form-row">
            <input
              className="form-input"
              placeholder="Username (for login)"
              value={form.username}
              onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
              autoFocus
            />
            <div style={{ position: 'relative', flex: 1 }}>
              <input
                className="form-input"
                type={showPw ? 'text' : 'password'}
                placeholder={user.hasPassword ? 'New password (leave blank to keep)' : 'Set password'}
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                style={{ width: '100%', paddingRight: 32 }}
              />
              <button
                type="button"
                onClick={() => setShowPw(v => !v)}
                style={{
                  position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 14, padding: 0,
                }}
                title={showPw ? 'Hide' : 'Show'}
              >
                {showPw ? '🙈' : '👁'}
              </button>
            </div>
            <SubmitButton
              className="btn-primary"
              onClick={handleSave}
              disabled={!form.username.trim()}
              style={{ whiteSpace: 'nowrap', fontSize: 12 }}
            >
              Save
            </SubmitButton>
          </div>
          {!form.username.trim() && (
            <p style={{ margin: 0, fontSize: 12, color: '#f87171' }}>Username is required to save.</p>
          )}
        </div>
      )}
    </li>
  )
}

function Snapshots() {
  const [rawSnapshots, setRawSnapshots] = useState([])
  const snapshots = useOptimistic(rawSnapshots, { entity: 'snapshot', key: 'id' })
  const [loading, setLoading] = useState(true)
  const [label, setLabel] = useState('')
  const [expanded, setExpanded] = useState(null)
  const [detail, setDetail] = useState({})

  useEffect(() => { fetchSnapshots() }, [])

  useEffect(() => onSync(item => {
    if (item.optimistic?.entity === 'snapshot') return fetchSnapshots()
  }), [])

  async function fetchSnapshots() {
    setLoading(true)
    try {
      const res = await apiFetch('/api/admin/snapshots')
      if (res.ok) setRawSnapshots(await res.json())
    } finally {
      setLoading(false)
    }
  }

  // Not queued: the snapshot id is assigned by the server (snapshot-store.js ignores
  // any client id), so there is no stable key to build an optimistic row from.
  async function handleCreate(e) {
    e.preventDefault()
    const res = await apiFetch('/api/admin/snapshots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: label.trim() || undefined }),
    })
    if (res.ok) {
      setLabel('')
      fetchSnapshots()
    }
  }

  function handleDelete(id, snapLabel) {
    if (!confirm(`Delete snapshot "${snapLabel}"? This cannot be undone.`)) return
    enqueue({
      url: `/api/admin/snapshots/${id}`,
      method: 'DELETE',
      optimistic: { entity: 'snapshot', op: 'delete', id },
      label: `Delete snapshot ${snapLabel}`,
    })
    if (expanded === id) setExpanded(null)
  }

  async function handleExpand(id) {
    if (expanded === id) { setExpanded(null); return }
    setExpanded(id)
    if (!detail[id]) {
      const res = await apiFetch(`/api/admin/snapshots/${id}`)
      if (res.ok) {
        const data = await res.json()
        setDetail(prev => ({ ...prev, [id]: data }))
      }
    }
  }

  return (
    <section className="section-card" style={{ marginTop: 0, borderRadius: '0 6px 6px 6px' }}>
      <div className="section-card-header">
        <span>Snapshots</span>
        {!loading && <span className="badge">{snapshots.length}</span>}
      </div>

      <form onSubmit={handleCreate} style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8 }}>
        <input
          className="form-input"
          placeholder="Snapshot label (optional)"
          value={label}
          onChange={e => setLabel(e.target.value)}
        />
        <SubmitButton className="btn-primary" type="submit" onClick={handleCreate} busyLabel="Taking…" style={{ whiteSpace: 'nowrap' }}>
          Take Snapshot
        </SubmitButton>
      </form>

      {loading ? (
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="skeleton" style={{ width: `${40 + i * 15}%`, height: 14 }} />
              <span className="skeleton" style={{ width: 80, height: 28, borderRadius: 6 }} />
            </div>
          ))}
        </div>
      ) : snapshots.length === 0 ? (
        <div className="empty-state-sm" style={{ padding: '20px 16px' }}>No snapshots yet. Take one above.</div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {snapshots.map(s => (
            <li key={s.id} style={{ borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--fg)' }}>{s.label}</span>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {new Date(s.createdAt).toLocaleString()}
                    {s.createdBy?.name && ` · by ${s.createdBy.name}`}
                    {` · ${s.projectCount} project${s.projectCount !== 1 ? 's' : ''}`}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    className="btn-ghost"
                    style={{ fontSize: 12, padding: '4px 10px' }}
                    onClick={() => handleExpand(s.id)}
                  >
                    {expanded === s.id ? 'Hide' : 'Details'}
                  </button>
                  <SubmitButton
                    className="btn-ghost"
                    style={{ fontSize: 12, padding: '4px 10px', color: 'var(--danger, #e05)' }}
                    onClick={() => handleDelete(s.id, s.label)}
                    busyLabel="Deleting…"
                  >
                    Delete
                  </SubmitButton>
                </div>
              </div>
              {expanded === s.id && (
                <div style={{ padding: '8px 16px 14px', background: 'var(--sidebar-bg)', fontSize: 13 }}>
                  {!detail[s.id] ? (
                    <span style={{ color: 'var(--muted)' }}>Loading…</span>
                  ) : (
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {(detail[s.id].projects || []).map(p => (
                        <li key={p.slug} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <span style={{ color: 'var(--accent, #818cf8)', fontWeight: 500 }}>{p.name}</span>
                          <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                            {(p.versions || []).length} version{(p.versions || []).length !== 1 ? 's' : ''}
                            {' · '}
                            {(p.proposals || []).length} proposal{(p.proposals || []).length !== 1 ? 's' : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default function AdminPage({ currentUser }) {
  const router = useRouter()
  const isSuperAdmin = currentUser?.role === 'superadmin' || (currentUser?.isAdmin && !currentUser?.role)
  const [tab, setTab] = useState('users')
  const [rawUsers, setRawUsers] = useState([])
  const users = useOptimistic(rawUsers, { entity: 'user', key: 'name' })
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ name: '', username: '', password: '' })
  const [showPw, setShowPw] = useState(false)

  useEffect(() => {
    if (currentUser && !currentUser.isAdmin) router.replace('/')
  }, [currentUser])

  useEffect(() => { fetchUsers() }, [])

  useEffect(() => onSync(item => {
    if (item.optimistic?.entity === 'user') return fetchUsers()
  }), [])

  async function fetchUsers() {
    setLoading(true)
    try {
      const res = await fetch('/api/assignees')
      if (res.ok) setRawUsers(await res.json())
    } finally {
      setLoading(false)
    }
  }

  function handleAdd(e) {
    e.preventDefault()
    const name = form.name.trim()
    if (!name) return
    const username = form.username.trim()
    enqueue({
      url: '/api/assignees',
      method: 'POST',
      body: { name, username, password: form.password },
      optimistic: { entity: 'user', op: 'create', data: { name, username, hasPassword: !!form.password } },
      label: `Add user ${name}`,
    })
    setForm({ name: '', username: '', password: '' })
  }

  function handleRemove(name) {
    if (!confirm(`Remove user "${name}"?`)) return
    enqueue({
      url: `/api/assignees/${encodeURIComponent(name)}`,
      method: 'DELETE',
      optimistic: { entity: 'user', op: 'delete', id: name },
      label: `Remove user ${name}`,
    })
  }

  return (
    <>
      <Nav />
      <main className="page" style={{ maxWidth: 720 }}>
        <div className="page-header">
          <h1>Admin</h1>
          <p>Manage users and view activity logs.</p>
        </div>

        <div style={{ display: 'flex', gap: 2, marginTop: 20 }}>
          {['users', ...(isSuperAdmin ? ['admins'] : []), 'snapshots', 'audit'].map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: '7px 18px', fontSize: 13, fontWeight: 500, border: 'none', cursor: 'pointer',
                borderRadius: '6px 6px 0 0',
                background: tab === t ? 'rgba(129, 140, 248, 0.12)' : 'transparent',
                color: tab === t ? 'var(--accent, #818cf8)' : 'var(--muted)',
                borderBottom: tab === t ? '2px solid var(--accent, #818cf8)' : '2px solid transparent',
              }}
            >
              {t === 'users' ? 'Users' : t === 'admins' ? 'Admins' : t === 'snapshots' ? 'Snapshots' : 'Audit Log'}
            </button>
          ))}
        </div>

        {tab === 'users' && (
          <section className="section-card" style={{ marginTop: 0, borderRadius: '0 6px 6px 6px' }}>
            <div className="section-card-header">
              <span>Users</span>
              {!loading && <span className="badge">{users.length}</span>}
            </div>

            <form onSubmit={handleAdd} style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="form-row">
                <input
                  className="form-input"
                  placeholder="Display name *"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  autoFocus
                  required
                />
                <input
                  className="form-input"
                  placeholder="Username (for login)"
                  value={form.username}
                  onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                />
              </div>
              <div className="form-row">
                <div style={{ position: 'relative', flex: 1 }}>
                  <input
                    className="form-input"
                    type={showPw ? 'text' : 'password'}
                    placeholder="Password"
                    value={form.password}
                    onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                    style={{ width: '100%', paddingRight: 32 }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(v => !v)}
                    style={{
                      position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                      background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 14, padding: 0,
                    }}
                    title={showPw ? 'Hide' : 'Show'}
                  >
                    {showPw ? '🙈' : '👁'}
                  </button>
                </div>
                <SubmitButton className="btn-primary" type="submit" onClick={handleAdd} disabled={!form.name.trim()} busyLabel="Adding…" style={{ whiteSpace: 'nowrap' }}>
                  + Add User
                </SubmitButton>
              </div>
            </form>

            {loading ? (
              <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[0, 1, 2].map(i => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span className="skeleton" style={{ width: `${40 + i * 15}%`, height: 14 }} />
                      <span className="skeleton" style={{ width: `${25 + i * 10}%`, height: 11 }} />
                    </div>
                    <span className="skeleton" style={{ width: 100, height: 28, borderRadius: 6 }} />
                  </div>
                ))}
              </div>
            ) : users.length === 0 ? (
              <div className="empty-state-sm" style={{ padding: '20px 16px' }}>No users yet. Add one above.</div>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {users.map(user => (
                  <UserRow key={user.name} user={user} onRemove={handleRemove} onSaved={fetchUsers} isSuperAdmin={isSuperAdmin} />
                ))}
              </ul>
            )}
          </section>
        )}

        {tab === 'admins' && isSuperAdmin && <AdminsTab />}
        {tab === 'snapshots' && <Snapshots />}
        {tab === 'audit' && <AuditLog />}
      </main>
    </>
  )
}
