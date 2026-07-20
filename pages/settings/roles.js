import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/router'
import Nav from '../../components/Nav'
import { apiFetch } from '../../lib/api-fetch'
import { ALL_PERMISSIONS, PERMISSION_LABELS, PERMISSION_GROUPS } from '../../lib/permissions'
import { isSuperAdmin } from '../../lib/client-permissions'
import { DEFAULT_COLUMNS, labelForStatus } from '../../lib/kanban-columns'

// Mirrors slugify() in KanbanBoard so a restricted key matches a custom column's key.
const normStatus = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

function PermGrid({ selected, onToggle }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {PERMISSION_GROUPS.map(group => (
        <div key={group.label}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{group.label}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {group.perms.map(perm => {
              const active = selected.includes(perm)
              return (
                <button
                  key={perm}
                  type="button"
                  onClick={() => onToggle(perm)}
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
    </div>
  )
}

function RoleCard({ title, subtitle, perms, setPerms, footer }) {
  function toggle(perm) {
    setPerms(prev => prev.includes(perm) ? prev.filter(p => p !== perm) : [...prev, perm])
  }
  return (
    <section className="section-card" style={{ marginTop: 20 }}>
      <div className="section-card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>{title}</span>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>{perms.length}/{ALL_PERMISSIONS.length}</span>
      </div>
      <div style={{ padding: '12px 16px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>{subtitle}</p>
        <PermGrid selected={perms} onToggle={toggle} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => setPerms([...ALL_PERMISSIONS])}>Select all</button>
          <button className="btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => setPerms([])}>Clear all</button>
        </div>
        {footer}
      </div>
    </section>
  )
}

function StatusBlocklistCard({ statuses, setStatuses, columns, scopeName }) {
  const [custom, setCustom] = useState('')

  function toggle(key) {
    setStatuses(prev => prev.includes(key) ? prev.filter(s => s !== key) : [...prev, key])
  }
  function addCustom() {
    const key = normStatus(custom)
    if (!key) return
    setStatuses(prev => prev.includes(key) ? prev : [...prev, key])
    setCustom('')
  }

  // The selected project's actual columns (falls back to defaults for the global
  // scope), plus any restricted key that isn't a current column so every selected
  // status stays visible even if its column was later removed.
  const cols = (Array.isArray(columns) && columns.length) ? columns : DEFAULT_COLUMNS
  const known = cols.map(c => c.status)
  const extra = statuses.filter(s => !known.includes(s))
  const chips = [...cols.map(c => ({ status: c.status, label: c.label })), ...extra.map(s => ({ status: s, label: labelForStatus(s) }))]

  return (
    <section className="section-card" style={{ marginTop: 20 }}>
      <div className="section-card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>Statuses users cannot set</span>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>{statuses.length} restricted</span>
      </div>
      <div style={{ padding: '12px 16px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>
          Regular users can move their tasks to any status <em>except</em> the ones selected below{scopeName ? <> — in <strong>{scopeName}</strong></> : ''}. Admins are never restricted.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {chips.map(c => {
            const active = statuses.includes(c.status)
            return (
              <button
                key={c.status}
                type="button"
                onClick={() => toggle(c.status)}
                title={c.status}
                style={{
                  fontSize: 12, padding: '4px 10px', borderRadius: 5, cursor: 'pointer', border: '1px solid',
                  borderColor: active ? '#dc2626' : 'var(--border)',
                  background: active ? 'rgba(220,38,38,0.12)' : 'transparent',
                  color: active ? '#f87171' : 'var(--muted)',
                  fontWeight: active ? 500 : 400,
                }}
              >
                {active ? '🚫 ' : ''}{c.label}
              </button>
            )
          })}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            className="form-input"
            placeholder="Add a custom status (e.g. Need Rework)"
            value={custom}
            onChange={e => setCustom(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustom() } }}
            style={{ maxWidth: 280 }}
          />
          <button className="btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }} onClick={addCustom} disabled={!custom.trim()}>Add</button>
        </div>
      </div>
    </section>
  )
}

export default function RolePolicyPage({ currentUser }) {
  const router = useRouter()
  const allowed = isSuperAdmin(currentUser)

  const [scope, setScope] = useState('global') // 'global' or a project slug
  const [projects, setProjects] = useState([])
  const [columns, setColumns] = useState(DEFAULT_COLUMNS)
  const [custom, setCustom] = useState(true)   // does this scope have its own policy?
  const [userPerms, setUserPerms] = useState([])
  const [adminPerms, setAdminPerms] = useState([])
  const [restrictedStatuses, setRestrictedStatuses] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  const scopeQuery = scope === 'global' ? '' : `?slug=${encodeURIComponent(scope)}`

  // Non-superadmins see nothing — bounce them to the home page.
  useEffect(() => {
    if (currentUser && !allowed) router.replace('/')
  }, [currentUser, allowed])

  useEffect(() => {
    if (!allowed) return
    apiFetch('/api/projects').then(r => r.ok ? r.json() : []).then(d => setProjects(d || [])).catch(() => {})
  }, [allowed])

  // Show the selected project's real columns in the status blocklist (global scope
  // falls back to the built-in defaults).
  useEffect(() => {
    if (!allowed) return
    if (scope === 'global') { setColumns(DEFAULT_COLUMNS); return }
    apiFetch(`/api/projects/${encodeURIComponent(scope)}/columns`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setColumns(Array.isArray(d?.columns) && d.columns.length ? d.columns : DEFAULT_COLUMNS))
      .catch(() => setColumns(DEFAULT_COLUMNS))
  }, [allowed, scope])

  const loadPolicy = useCallback(() => {
    if (!allowed) return
    setLoading(true); setMsg('')
    apiFetch(`/api/admin/role-policy${scopeQuery}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d) {
          const p = d.policy || {}
          setUserPerms(p.user || []); setAdminPerms(p.admin || []); setRestrictedStatuses(p.userRestrictedStatuses || [])
          setCustom(scope === 'global' ? true : !!d.custom)
        }
      })
      .finally(() => setLoading(false))
  }, [allowed, scope]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadPolicy() }, [loadPolicy])

  async function handleSave() {
    setSaving(true); setMsg('')
    try {
      const res = await apiFetch(`/api/admin/role-policy${scopeQuery}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: userPerms, admin: adminPerms, userRestrictedStatuses: restrictedStatuses }),
      })
      if (res.ok) {
        const d = await res.json()
        const p = d.policy || {}
        setUserPerms(p.user || []); setAdminPerms(p.admin || []); setRestrictedStatuses(p.userRestrictedStatuses || [])
        setCustom(true)
        setMsg(scope === 'global'
          ? 'Global default saved.'
          : 'Saved a project-specific policy. Status limits apply immediately; permission changes apply on the user’s next sign-in.')
      } else {
        const d = await res.json().catch(() => ({}))
        setMsg(d.error || 'Save failed.')
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleResetToGlobal() {
    if (scope === 'global') return
    if (!confirm('Remove this project’s custom policy and inherit the global default?')) return
    const res = await apiFetch(`/api/admin/role-policy${scopeQuery}`, { method: 'DELETE' })
    if (res.ok) { loadPolicy() } else {
      const d = await res.json().catch(() => ({}))
      alert(d.error || 'Reset failed.')
    }
  }

  async function handleApplyToAllAdmins() {
    if (!confirm('Overwrite every existing admin with this admin permission set? Per-admin overrides will be replaced.')) return
    const res = await apiFetch('/api/admin/users/bulk-permissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissions: adminPerms }),
    })
    if (res.ok) {
      const d = await res.json()
      alert(`Updated ${d.updated} admin(s) to this permission set.`)
    } else {
      const d = await res.json().catch(() => ({}))
      alert(d.error || 'Failed to update admins.')
    }
  }

  // Render nothing for non-superadmins (and while auth resolves).
  if (!allowed) return null

  const scopeName = scope === 'global' ? 'Global default' : (projects.find(p => p.slug === scope)?.name || scope)

  return (
    <>
      <Nav />
      <main className="page" style={{ maxWidth: 720 }}>
        <div className="page-header">
          <h1>Access Control</h1>
          <p>Define what the <strong>User</strong> and <strong>Admin</strong> roles can do — per project. Superadmin only.</p>
        </div>

        <section className="section-card" style={{ marginTop: 20 }}>
          <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>Configuring</label>
            <select
              className="form-input"
              value={scope}
              onChange={e => setScope(e.target.value)}
              style={{ maxWidth: 280, fontSize: 13 }}
            >
              <option value="global">Global default (all projects)</option>
              {projects.map(p => (
                <option key={p.slug} value={p.slug}>{p.name}{/* inherit marker added below */}</option>
              ))}
            </select>
            {scope !== 'global' && (
              custom
                ? <span style={{ fontSize: 12, color: 'var(--accent, #818cf8)' }}>Custom policy</span>
                : <span style={{ fontSize: 12, color: 'var(--muted)' }}>Inheriting global default — saving creates an override</span>
            )}
          </div>
        </section>

        {loading ? (
          <div style={{ padding: 24, color: 'var(--muted)' }}>Loading…</div>
        ) : (
          <>
            <RoleCard
              title={`User role — ${scopeName}`}
              subtitle="Capabilities granted to every regular user (viewer) in this scope."
              perms={userPerms}
              setPerms={setUserPerms}
            />

            <RoleCard
              title={`Admin role — ${scopeName}`}
              subtitle="Capabilities admins have in this scope. An admin's effective permissions are this set intersected with their personal grant (Admin → Admins tab)."
              perms={adminPerms}
              setPerms={setAdminPerms}
              footer={scope === 'global' ? (
                <div>
                  <button className="btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }} onClick={handleApplyToAllAdmins}>
                    Apply to all existing admins
                  </button>
                </div>
              ) : null}
            />

            <StatusBlocklistCard statuses={restrictedStatuses} setStatuses={setRestrictedStatuses} columns={columns} scopeName={scopeName} />

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 20, flexWrap: 'wrap' }}>
              <button className="btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : scope === 'global' ? 'Save global default' : 'Save project policy'}
              </button>
              {scope !== 'global' && custom && (
                <button className="btn-ghost" style={{ fontSize: 13 }} onClick={handleResetToGlobal}>
                  Reset to global default
                </button>
              )}
              {msg && <span style={{ fontSize: 13, color: 'var(--muted)' }}>{msg}</span>}
            </div>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 12 }}>
              Note: status limits apply immediately; role-permission changes take effect on each user's next sign-in.
            </p>
          </>
        )}
      </main>
    </>
  )
}
