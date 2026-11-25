import { useState, useEffect } from 'react'
import { assigneesUrl } from '../lib/config-cache'
import { useRouter } from '../lib/router-compat'
import Nav from '../components/Nav'
import PageHeader from '../components/PageHeader'
import PersonLink from '../components/PersonLink'
import MoreMenu from '../components/MoreMenu'
import { apiFetch } from '../lib/api-fetch'
import { ALL_PERMISSIONS, PERMISSION_LABELS } from '../lib/permissions'
import PermissionGrid, { ProjectPicker } from '../components/PermissionGrid'
import GroupsTab from '../components/GroupsTab'
import HolidaysTab from '../components/HolidaysTab'
import UserAccessEditor from '../components/UserAccessEditor'
import SubmitButton from '../components/SubmitButton'
import { hasPerm } from '../lib/client-permissions'
import { ROLES, MEMBER_ROLES, roleLabel, isLeadRole, canLead } from '../lib/roles'
import { enqueue, onSync } from '../lib/submit-queue'
import { useOptimistic } from '../lib/optimistic'

const ACTION_LABELS = {
  login: 'Signed in',
  logout: 'Signed out',
  login_failed: 'Sign-in failed',
  view_project: 'Viewed project',
  view_version: 'Viewed version',
  view_diff: 'Viewed diff',
  create_project: 'Created project',
  update_project: 'Updated project',
  delete_project: 'Deleted project',
  create_version: 'Created version',
  save_version: 'Saved version',
  delete_version: 'Deleted version',
  create_proposal: 'Created proposal',
  update_proposal: 'Updated proposal',
  delete_proposal: 'Deleted proposal',
  promote_proposal: 'Promoted proposal',
  create_task: 'Created task',
  update_task: 'Updated task',
  delete_task: 'Deleted task',
  reorder_task: 'Reordered task',
  move_task: 'Moved task',
  board_reorder: 'Reordered board',
  restore_positions: 'Restored task order',
  qa_pass: 'Passed QA',
  qa_rework: 'Sent back from QA',
  create_epic: 'Created epic',
  update_epic: 'Updated epic',
  delete_epic: 'Deleted epic',
  create_sprint: 'Created sprint',
  update_sprint: 'Updated sprint',
  plan_sprint: 'Planned sprint',
  start_sprint: 'Started sprint',
  complete_sprint: 'Completed sprint',
  delete_sprint: 'Deleted sprint',
  sprint_cadence: 'Sprint cadence ran',
  update_sprint_config: 'Changed sprint cadence',
  update_columns: 'Changed board columns',
  update_categories: 'Changed categories',
  create_label: 'Created label',
  delete_label: 'Deleted label',
  create_user: 'Created user',
  update_user_credentials: 'Changed sign-in',
  update_user_role: 'Changed role',
  update_user_lead: 'Changed team lead',
  update_user_access: 'Changed user access',
  delete_user: 'Deleted user',
  create_admin: 'Created admin',
  update_admin: 'Updated admin',
  delete_admin: 'Deleted admin',
  bulk_update_admin_permissions: 'Changed admin permissions',
  create_group: 'Created group',
  update_group: 'Updated group',
  update_group_members: 'Changed group members',
  delete_group: 'Deleted group',
  update_role_policy: 'Changed role permissions',
  reset_role_policy: 'Reset role permissions',
  create_holiday: 'Added holiday',
  update_holiday: 'Updated holiday',
  delete_holiday: 'Deleted holiday',
  update_holiday_config: 'Changed weekly offs',
  create_snapshot: 'Created snapshot',
  delete_snapshot: 'Deleted snapshot',
}

const actionLabel = a => ACTION_LABELS[a] || String(a || '').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())

// Coarse buckets for the filter chips.
const AUDIT_KINDS = [
  { key: '', label: 'All' },
  { key: 'people', label: 'People & access' },
  { key: 'work', label: 'Tasks & sprints' },
  { key: 'project', label: 'Projects' },
  { key: 'auth', label: 'Sign-ins' },
]
function actionKind(a = '') {
  if (/^(login|logout)/.test(a)) return 'auth'
  if (/user|admin|group|role_policy/.test(a)) return 'people'
  if (/task|sprint|epic|qa_|board|restore_positions|label|categories|columns/.test(a)) return 'work'
  return 'project'
}
function actionTone(a = '') {
  if (a === 'login_failed' || a.startsWith('delete_') || a === 'qa_rework') return 'danger'
  if (a.startsWith('view_') || a === 'login' || a === 'logout') return 'muted'
  if (a.startsWith('create_') || a === 'qa_pass') return 'good'
  return 'info'
}

function formatTime(ts) {
  try {
    return new Date(ts).toLocaleString()
  } catch {
    return ts
  }
}

function relTime(ts) {
  const t = Date.parse(ts || '')
  if (!t) return ''
  const m = Math.round((Date.now() - t) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

function detailSummary(action, details) {
  if (!details) return []
  const parts = []
  if (details.slug) parts.push(details.slug)
  if (details.name) parts.push(details.name)
  if (details.title) parts.push(`"${details.title}"`)
  if (details.version) parts.push(`v${details.version}`)
  if (details.newVersion) parts.push(`→ v${details.newVersion}`)
  if (details.direction) parts.push(details.direction)
  if (details.fields && details.fields.length) parts.push(`[${details.fields.join(', ')}]`)
  if (details.statusFrom != null || details.statusTo != null) parts.push(`${details.statusFrom ?? '?'} → ${details.statusTo ?? '?'}`)
  if (action === 'update_user_role') parts.push((details.from || 'dev') === details.to ? `${roleLabel(details.to)} (unchanged)` : `${roleLabel(details.from || 'dev')} → ${roleLabel(details.to)}`)
  if (action === 'update_user_lead') parts.push(details.to ? `now reports to ${details.to}` : 'no team lead')
  if (details.renamedFrom) parts.push(`was ${details.renamedFrom}`)
  if (details.changedFields && details.changedFields.length) parts.push(details.changedFields.join(', '))
  if (details.note) parts.push(`“${String(details.note).slice(0, 80)}”`)
  return parts
}

function AuditLog() {
  const [logs, setLogs] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [offset, setOffset] = useState(0)
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState('')
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
  const filteredLogs = logs.filter(log => {
    if (kind && actionKind(log.action) !== kind) return false
    if (!q) return true
    const who = `${log.user?.name || ''} ${log.user?.username || ''}`.toLowerCase()
    const action = actionLabel(log.action).toLowerCase()
    const details = JSON.stringify(log.details || '').toLowerCase()
    const resource = (log.resource || '').toLowerCase()
    return who.includes(q) || action.includes(q) || details.includes(q) || resource.includes(q)
  })

  return (
    <section className="admin-card">
      <div className="admin-card-head">
        <div>
          <h2 className="admin-card-title">Audit log <span className="admin-count">{loading ? '…' : total}</span></h2>
          <p className="admin-card-sub">Search and filter apply to the page shown ({LIMIT} entries).</p>
        </div>
      </div>
      <div className="admin-toolbar">
        <div className="admin-chips" role="tablist" aria-label="Filter by kind">
          {AUDIT_KINDS.map(k => (
            <button key={k.key} type="button" role="tab" aria-selected={kind === k.key} className={`admin-chip${kind === k.key ? ' is-on' : ''}`} onClick={() => setKind(k.key)}>{k.label}</button>
          ))}
        </div>
        <input className="admin-search" type="search" placeholder="Search person, action or detail" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search logs" />
      </div>

      {loading ? (
        <div className="admin-skel">
          {[0, 1, 2, 3, 4].map(i => <span key={i} className="skeleton" style={{ height: 28 }} />)}
        </div>
      ) : filteredLogs.length === 0 ? (
        <div className="empty-state-sm admin-empty">{q || kind ? 'No matching entries on this page.' : 'No activity logged yet.'}</div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr><th>When</th><th>Who</th><th>Action</th><th>Details</th></tr>
            </thead>
            <tbody>
              {filteredLogs.map(log => (
                <tr key={log.id}>
                  <td className="admin-when" title={formatTime(log.timestamp)}>{relTime(log.timestamp)}</td>
                  <td className="admin-who">
                    {log.user ? (
                      <>
                        <PersonLink name={log.user.name} className="admin-who-name" />
                        {log.user.username && <span className="admin-muted"> @{log.user.username}</span>}
                      </>
                    ) : <span className="admin-muted">unknown</span>}
                  </td>
                  <td><span className={`admin-action admin-action--${actionTone(log.action)}`}>{actionLabel(log.action)}</span></td>
                  <td className="admin-details">
                    {detailSummary(log.action, log.details).map((part, i, arr) => (
                      <span key={i}>{part}{i < arr.length - 1 ? ' · ' : ''}</span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > LIMIT && (
        <div className="admin-pager">
          <span className="admin-muted">{offset + 1}–{Math.min(offset + LIMIT, total)} of {total}</span>
          <div className="admin-pager-btns">
            <button className="btn-ghost" disabled={offset === 0 || loading} onClick={() => fetchLogs(Math.max(0, offset - LIMIT))}>Newer</button>
            <button className="btn-ghost" disabled={offset + LIMIT >= total || loading} onClick={() => fetchLogs(offset + LIMIT)}>Older</button>
          </div>
        </div>
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

  return (
    <div style={{ padding: '10px 16px 14px', background: 'var(--sidebar-bg)', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <PermissionGrid selected={perms} onToggle={toggle} />

      {projects.length > 0 && (
        <ProjectPicker projects={projects} value={assignedProjects} onChange={setAssignedProjects} />
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
    setForm({ name: '', username: '', password: '', role: 'dev' })
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
    <section className="section-card">
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
  return <span className={`admin-role-badge${isLeadRole(role) ? ' is-lead' : ''}`}>{roleLabel(role)}</span>
}

const isAdminAccount = u => u.role === 'admin' || u.role === 'superadmin'

// Role picker for a user row (lib/roles.js). A super admin picks any role for anyone,
// admins included; everyone else picks team roles for team members, and admin accounts
// show their badge only. Not queued: the server refuses some changes (own role, Manager
// from a non-admin) and the picker has to snap back when it does.
const isAdminRole = r => r === 'admin' || r === 'superadmin'

function RolePicker({ user, currentUser, isSuperAdmin, onSaved }) {
  const [busy, setBusy] = useState(false)
  const current = isAdminAccount(user) ? user.role : (MEMBER_ROLES.includes(user.role) ? user.role : 'dev')
  const choices = isSuperAdmin ? ROLES.map(r => r.key) : MEMBER_ROLES
  if (currentUser?.name === user.name || !choices.includes(current)) return <RoleBadge role={user.role || 'dev'} />
  async function change(e) {
    const role = e.target.value
    if (role === current) return
    // Crossing the admin line changes what they can reach, so say so first.
    if (isAdminRole(role) !== isAdminRole(current) || role === 'superadmin') {
      const what = role === 'superadmin'
        ? `${user.name} will be a Super admin: full control, including other admins.`
        : isAdminRole(role)
          ? `${user.name} will be an Admin: admin pages, out of any team.`
          : `${user.name} will no longer be an admin.`
      if (!confirm(`${what} Their personal permission list resets to the ${roleLabel(role)} defaults; project access and groups stay. Continue?`)) { e.target.value = current; return }
    }
    setBusy(true)
    const res = await apiFetch(`/api/assignees/${encodeURIComponent(user.name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    })
    setBusy(false)
    const d = await res.json().catch(() => ({}))
    if (!res.ok) { alert(d.error || 'Could not change the role.'); return }
    // The new role broke some Reports-to links (lib/team.js); the server cleared them.
    if (d.clearedLeads?.length) alert(`${user.name} is now ${roleLabel(role)}. Reports-to cleared for: ${d.clearedLeads.join(', ')} — a lead must be above the person.`)
    onSaved()
  }
  return (
    <select className="admin-select" value={current} onChange={change} disabled={busy} aria-label={`Role of ${user.name}`}>
      {choices.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
    </select>
  )
}

// Team lead picker (lib/team.js): who this person reports to. Only someone above them
// on the ladder is offered (`canLead`: Dev/QA → Team lead → Manager, Manager → Manager);
// the server re-checks that and refuses loops.
function LeadPicker({ user, leads, onSaved }) {
  const [busy, setBusy] = useState(false)
  if (isAdminAccount(user)) return <span className="admin-muted">—</span>
  const options = leads.filter(l => l.name !== user.name && canLead(l.role, user.role))
  if (!options.length && !user.lead) return <span className="admin-muted" title={user.role === 'manager' ? 'A Manager reports only to another Manager' : 'Give someone a role above this person first'}>No one above</span>
  async function change(e) {
    const lead = e.target.value
    setBusy(true)
    const res = await apiFetch(`/api/assignees/${encodeURIComponent(user.name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lead }),
    })
    setBusy(false)
    if (!res.ok) { alert((await res.json().catch(() => ({}))).error || 'Could not change the team lead.'); return }
    onSaved()
  }
  return (
    <select className={`admin-select${user.lead ? '' : ' is-empty'}`} value={user.lead || ''} onChange={change} disabled={busy} aria-label={`Team lead of ${user.name}`}>
      <option value="">Nobody</option>
      {user.lead && !options.some(l => l.name === user.lead) && <option value={user.lead}>{user.lead}</option>}
      {options.map(l => <option key={l.name} value={l.name}>{l.name}</option>)}
    </select>
  )
}

function PasswordInput({ value, onChange, placeholder, autoFocus }) {
  const [show, setShow] = useState(false)
  return (
    <div className="admin-pw">
      <input className="form-input" type={show ? 'text' : 'password'} placeholder={placeholder} value={value} onChange={onChange} autoFocus={autoFocus} autoComplete="new-password" />
      <button type="button" className="admin-pw-toggle" onClick={() => setShow(v => !v)} aria-label={show ? 'Hide password' : 'Show password'}>
        {show ? 'Hide' : 'Show'}
      </button>
    </div>
  )
}

function UserRow({ user, leads, reports, onRemove, onSaved, isSuperAdmin, currentUser }) {
  // null | 'credentials' | 'rename' | 'access' — one inline panel at a time.
  const [panel, setPanel] = useState(null)
  const [form, setForm] = useState({ username: user.username || '', password: '' })
  const [renameVal, setRenameVal] = useState(user.name)
  const isMe = currentUser?.name === user.name
  const cantSignIn = !user.username || !user.hasPassword

  function openPanel(p) {
    setPanel(cur => (cur === p ? null : p))
    setForm({ username: user.username || '', password: '' })
    setRenameVal(user.name)
  }

  // Not queued: the server returns 409 when the new name collides with an existing
  // user — a uniqueness check the client cannot make, so we await it and surface the
  // error before closing the rename field.
  async function handleRename() {
    const trimmed = renameVal.trim()
    if (!trimmed || trimmed === user.name) { setPanel(null); return }
    const res = await apiFetch(`/api/assignees/${encodeURIComponent(user.name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newName: trimmed }),
    })
    if (res.ok) {
      setPanel(null)
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
    setPanel(null)
  }

  return (
    <li className={`admin-user${panel ? ' is-open' : ''}`}>
      <div className="admin-user-row">
        <div className="admin-user-who">
          <span className="admin-avatar" aria-hidden="true">{user.name.charAt(0).toUpperCase()}</span>
          <div className="admin-user-text">
            <span className="admin-user-name">
              <PersonLink name={user.name} />
              {isMe && <span className="admin-you">you</span>}
            </span>
            <span className="admin-user-sub">
              {user.username ? `@${user.username}` : 'no username'}
              {reports > 0 && <> · leads {reports}</>}
              {cantSignIn && (
                <span className="admin-warn" title="Set a username and password so they can sign in">
                  {!user.username && !user.hasPassword ? 'Can’t sign in' : !user.username ? 'No username' : 'No password'}
                </span>
              )}
            </span>
          </div>
        </div>
        <div className="admin-user-cell" data-label="Role"><RolePicker user={user} currentUser={currentUser} isSuperAdmin={isSuperAdmin} onSaved={onSaved} /></div>
        <div className="admin-user-cell" data-label="Reports to"><LeadPicker user={user} leads={leads} onSaved={onSaved} /></div>
        <div className="admin-user-actions">
          <MoreMenu
            label={`Actions for ${user.name}`}
            items={[
              { label: cantSignIn ? 'Set up sign-in' : 'Change username / password', onClick: () => openPanel('credentials') },
              { label: 'Projects & permissions', onClick: () => openPanel('access'), hidden: !isSuperAdmin },
              { label: 'Rename', onClick: () => openPanel('rename'), hidden: !isSuperAdmin },
              { label: 'Remove user', onClick: () => onRemove(user.name), danger: true, hidden: isMe },
            ]}
          />
        </div>
      </div>

      {panel === 'credentials' && (
        <div className="admin-user-panel">
          <div className="admin-panel-title">Sign-in for {user.name}</div>
          <div className="admin-form-grid">
            <label className="admin-field">
              <span>Username</span>
              <input className="form-input" placeholder="e.g. ravi" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} autoFocus />
            </label>
            <label className="admin-field">
              <span>{user.hasPassword ? 'New password' : 'Password'}</span>
              <PasswordInput value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder={user.hasPassword ? 'Leave blank to keep' : 'Set a password'} />
            </label>
          </div>
          <div className="admin-panel-foot">
            {!form.username.trim() && <span className="admin-field-error">A username is required.</span>}
            {form.password && <span className="admin-muted">Saving a new password signs them out everywhere.</span>}
            <button type="button" className="btn-ghost" onClick={() => setPanel(null)}>Cancel</button>
            <SubmitButton className="btn-primary" onClick={handleSave} disabled={!form.username.trim()}>Save</SubmitButton>
          </div>
        </div>
      )}

      {panel === 'rename' && (
        <div className="admin-user-panel">
          <div className="admin-panel-title">Rename {user.name}</div>
          <label className="admin-field">
            <span>Display name</span>
            <input
              className="form-input"
              value={renameVal}
              onChange={e => setRenameVal(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setPanel(null) }}
              autoFocus
            />
          </label>
          <div className="admin-panel-foot">
            <span className="admin-muted">Their tasks, projects, groups and team follow the new name.</span>
            <button type="button" className="btn-ghost" onClick={() => setPanel(null)}>Cancel</button>
            <SubmitButton className="btn-primary" onClick={handleRename} disabled={!renameVal.trim()}>Rename</SubmitButton>
          </div>
        </div>
      )}

      {panel === 'access' && (
        <div className="admin-user-panel admin-user-panel--access">
          <div className="admin-panel-title">
            Projects & permissions for {user.name}
            <button type="button" className="btn-ghost admin-panel-close" onClick={() => setPanel(null)}>Done</button>
          </div>
          <UserAccessEditor userName={user.name} onSaved={onSaved} />
        </div>
      )}
    </li>
  )
}

const ROLE_FILTERS = [{ key: '', label: 'All' }, ...MEMBER_ROLES.map(r => ({ key: r, label: roleLabel(r) })), { key: 'signin', label: 'Can’t sign in' }]

function UsersTab({ currentUser, isSuperAdmin }) {
  const [rawUsers, setRawUsers] = useState([])
  const users = useOptimistic(rawUsers, { entity: 'user', key: 'name' })
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ name: '', username: '', password: '', role: 'dev' })
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('')

  useEffect(() => { fetchUsers() }, [])
  useEffect(() => onSync(item => {
    if (item.optimistic?.entity === 'user') return fetchUsers()
  }), [])

  async function fetchUsers() {
    setLoading(true)
    try {
      const res = await apiFetch(assigneesUrl({ fresh: true }))
      if (res.ok) setRawUsers(await res.json())
    } finally {
      setLoading(false)
    }
  }

  function handleAdd(e) {
    e.preventDefault()
    const name = form.name.trim()
    if (!name) return
    if (users.some(u => u.name.toLowerCase() === name.toLowerCase())) { alert(`A user called "${name}" already exists.`); return }
    const username = form.username.trim()
    enqueue({
      url: '/api/assignees',
      method: 'POST',
      body: { name, username, password: form.password, role: form.role || 'dev' },
      optimistic: { entity: 'user', op: 'create', data: { name, username, hasPassword: !!form.password, role: form.role || 'dev' } },
      label: `Add user ${name}`,
    })
    setForm({ name: '', username: '', password: '', role: form.role || 'dev' })
    setAdding(false)
  }

  function handleRemove(name) {
    if (!confirm(`Remove ${name}? They can no longer sign in, and anyone reporting to them is left without a team lead. Their tasks keep the name.`)) return
    enqueue({
      url: `/api/assignees/${encodeURIComponent(name)}`,
      method: 'DELETE',
      optimistic: { entity: 'user', op: 'delete', id: name },
      label: `Remove user ${name}`,
    })
  }

  const leads = users.filter(u => u.role === 'teamlead' || u.role === 'designlead' || u.role === 'manager')
  const reportCount = name => users.filter(u => u.lead === name).length
  const roleOf = u => (MEMBER_ROLES.includes(u.role) ? u.role : isAdminAccount(u) ? u.role : 'dev')
  const counts = Object.fromEntries(ROLE_FILTERS.map(f => [f.key, f.key === '' ? users.length
    : f.key === 'signin' ? users.filter(u => !u.username || !u.hasPassword).length
      : users.filter(u => roleOf(u) === f.key).length]))
  const term = q.trim().toLowerCase()
  const shown = users.filter(u =>
    (!filter || (filter === 'signin' ? (!u.username || !u.hasPassword) : roleOf(u) === filter)) &&
    (!term || u.name.toLowerCase().includes(term) || (u.username || '').toLowerCase().includes(term) || (u.lead || '').toLowerCase().includes(term)))

  return (
    <section className="admin-card">
      <div className="admin-card-head">
        <div>
          <h2 className="admin-card-title">Users <span className="admin-count">{loading ? '…' : users.length}</span></h2>
          <p className="admin-card-sub">Team members, their role and who they report to. Admin accounts are under Admins.</p>
        </div>
        {!adding && <button type="button" className="btn-primary" onClick={() => setAdding(true)}>+ Add user</button>}
      </div>

      {adding && (
        <form className="admin-add" onSubmit={handleAdd}>
          <div className="admin-panel-title">New user</div>
          <div className="admin-form-grid admin-form-grid--4">
            <label className="admin-field">
              <span>Display name *</span>
              <input className="form-input" placeholder="e.g. Ravi Kumar" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} autoFocus required />
            </label>
            <label className="admin-field">
              <span>Username</span>
              <input className="form-input" placeholder="for signing in" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} autoComplete="off" />
            </label>
            <label className="admin-field">
              <span>Password</span>
              <PasswordInput value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="Set a password" />
            </label>
            <label className="admin-field">
              <span>Role</span>
              <select className="form-input" value={form.role || 'dev'} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                {MEMBER_ROLES.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
              </select>
            </label>
          </div>
          <div className="admin-panel-foot">
            <span className="admin-muted">Without a username and password they can be assigned tasks but can’t sign in. Set their team lead after adding.</span>
            <button type="button" className="btn-ghost" onClick={() => setAdding(false)}>Cancel</button>
            <SubmitButton className="btn-primary" type="submit" onClick={handleAdd} disabled={!form.name.trim()} busyLabel="Adding…">Add user</SubmitButton>
          </div>
        </form>
      )}

      <div className="admin-toolbar">
        <div className="admin-chips" role="tablist" aria-label="Filter by role">
          {ROLE_FILTERS.filter(f => f.key !== 'signin' || counts.signin > 0).map(f => (
            <button key={f.key} type="button" role="tab" aria-selected={filter === f.key}
              className={`admin-chip${filter === f.key ? ' is-on' : ''}${f.key === 'signin' ? ' admin-chip--warn' : ''}`}
              onClick={() => setFilter(f.key)}>
              {f.label}<span>{counts[f.key]}</span>
            </button>
          ))}
        </div>
        <input className="admin-search" type="search" placeholder="Search name, username or lead" value={q} onChange={e => setQ(e.target.value)} aria-label="Search users" />
      </div>

      <div className="admin-user-head" aria-hidden="true">
        <span>Person</span><span>Role</span><span>Reports to</span><span />
      </div>
      {loading && !users.length ? (
        <div className="admin-skel">
          {[0, 1, 2].map(i => <span key={i} className="skeleton" style={{ height: 44 }} />)}
        </div>
      ) : shown.length === 0 ? (
        <div className="empty-state-sm admin-empty">{users.length ? 'No users match.' : 'No users yet — add the first one.'}</div>
      ) : (
        <ul className="admin-users">
          {shown.map(user => (
            <UserRow key={user.name} user={user} leads={leads} reports={reportCount(user.name)} onRemove={handleRemove} onSaved={fetchUsers} isSuperAdmin={isSuperAdmin} currentUser={currentUser} />
          ))}
        </ul>
      )}
    </section>
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
    <section className="section-card">
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

const TAB_META = {
  users: { label: 'Users', sub: 'People, roles, teams and sign-in.' },
  admins: { label: 'Admins', sub: 'Admin accounts and what each one may do.' },
  groups: { label: 'Groups', sub: 'Bundles of permissions and projects, granted to many people at once.' },
  holidays: { label: 'Holidays', sub: 'Weekly offs and holidays — sprint working days skip them.' },
  snapshots: { label: 'Snapshots', sub: 'Backups of all data. Take one before a big change.' },
  audit: { label: 'Audit log', sub: 'Who changed what, newest first.' },
}

export default function AdminPage({ currentUser }) {
  const router = useRouter()
  const isSuperAdmin = currentUser?.role === 'superadmin' || (currentUser?.isAdmin && !currentUser?.role)
  // The holiday calendar is org-wide, so it is not gated on a project: a subadmin
  // holding holiday:manage gets the tab alongside every superadmin.
  const canHolidays = isSuperAdmin || hasPerm(currentUser, 'holiday:manage')
  const tabs = ['users', ...(isSuperAdmin ? ['admins', 'groups'] : []), ...(canHolidays ? ['holidays'] : []), ...(currentUser?.isAdmin ? ['snapshots', 'audit'] : [])]
  // The tab lives in the URL (?tab=) so it survives a reload and can be linked.
  const tab = tabs.includes(router.query.tab) ? router.query.tab : 'users'

  useEffect(() => {
    if (currentUser && !currentUser.isAdmin && !hasPerm(currentUser, 'assignee:manage')) router.replace('/')
  }, [currentUser])

  function go(t) {
    router.replace(t === 'users' ? '/admin' : `/admin?tab=${t}`)
  }

  return (
    <>
      <Nav />
      <main className="page admin-page">
        <PageHeader title="Admin" subtitle={TAB_META[tab].sub} />

        {tabs.length > 1 && (
          <nav className="admin-tabs" role="tablist" aria-label="Admin sections">
            {tabs.map(t => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} className={`admin-tab${tab === t ? ' is-on' : ''}`} onClick={() => go(t)}>
                {TAB_META[t].label}
              </button>
            ))}
          </nav>
        )}

        <div className="admin-panel">
          {tab === 'users' && <UsersTab currentUser={currentUser} isSuperAdmin={isSuperAdmin} />}
          {tab === 'admins' && isSuperAdmin && <AdminsTab />}
          {tab === 'groups' && isSuperAdmin && <GroupsTab />}
          {tab === 'holidays' && canHolidays && <HolidaysTab currentUser={currentUser} />}
          {tab === 'snapshots' && currentUser?.isAdmin && <Snapshots />}
          {tab === 'audit' && currentUser?.isAdmin && <AuditLog />}
        </div>
      </main>
    </>
  )
}
