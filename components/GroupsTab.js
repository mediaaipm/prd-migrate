import { useState, useEffect } from 'react'
import { apiFetch } from '../lib/api-fetch'
import PermissionGrid, { ProjectPicker } from './PermissionGrid'
import SubmitButton from './SubmitButton'

// Groups: a named bundle of permissions + project visibility, plus its members.
// A user's effective access is their personal grant merged with every group they
// are in (union — a group can only add, never take away). Superadmin only.
function GroupEditor({ group, projects, users, onSaved, onCancel }) {
  const [name, setName] = useState(group.name || '')
  const [description, setDescription] = useState(group.description || '')
  const [perms, setPerms] = useState(group.permissions || [])
  const [assigned, setAssigned] = useState(group.assignedProjects === undefined ? null : group.assignedProjects)
  const [members, setMembers] = useState(group.members || [])
  const [search, setSearch] = useState('')
  const [msg, setMsg] = useState('')

  function toggle(perm) {
    setPerms(prev => prev.includes(perm) ? prev.filter(p => p !== perm) : [...prev, perm])
  }

  // Not queued: create needs the server-assigned id back, and a rename can 409.
  async function handleSave() {
    setMsg('')
    const body = { name, description, permissions: perms, assignedProjects: assigned, members }
    const isNew = !group.id
    const res = await apiFetch(isNew ? '/api/admin/groups' : `/api/admin/groups/${encodeURIComponent(group.id)}`, {
      method: isNew ? 'POST' : 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) onSaved()
    else {
      const d = await res.json().catch(() => ({}))
      setMsg(d.error || 'Save failed.')
    }
  }

  const q = search.trim().toLowerCase()
  const shown = q ? users.filter(u => u.name.toLowerCase().includes(q) || (u.username || '').toLowerCase().includes(q)) : users

  return (
    <div style={{ padding: '12px 16px 16px', background: 'var(--sidebar-bg)', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="form-row">
        <input className="form-input" placeholder="Group name *" value={name} onChange={e => setName(e.target.value)} />
        <input className="form-input" placeholder="Description" value={description} onChange={e => setDescription(e.target.value)} />
      </div>

      <PermissionGrid selected={perms} onToggle={toggle} />
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn-ghost" style={{ fontSize: 11, padding: '3px 9px' }} onClick={() => setPerms([])}>Clear all permissions</button>
      </div>

      <ProjectPicker projects={projects} value={assigned} onChange={setAssigned} />

      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Members
          </div>
          <span className="badge">{members.length}</span>
          <input
            type="search"
            className="form-input"
            placeholder="Filter users…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ fontSize: 12, padding: '3px 9px', maxWidth: 200 }}
          />
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
          {shown.map(u => {
            const active = members.includes(u.name)
            return (
              <button
                key={u.name}
                type="button"
                onClick={() => setMembers(prev => active ? prev.filter(m => m !== u.name) : [...prev, u.name])}
                title={u.role || 'user'}
                style={{
                  fontSize: 12, padding: '4px 10px', borderRadius: 5, cursor: 'pointer', border: '1px solid',
                  borderColor: active ? 'var(--accent, #818cf8)' : 'var(--border)',
                  background: active ? 'rgba(129,140,248,0.12)' : 'transparent',
                  color: active ? 'var(--accent, #818cf8)' : 'var(--muted)',
                  fontWeight: active ? 500 : 400,
                }}
              >
                {active ? '✓ ' : ''}{u.name}
              </button>
            )
          })}
          {shown.length === 0 && <span style={{ fontSize: 12, color: 'var(--muted)' }}>No matching users.</span>}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <SubmitButton className="btn-primary" style={{ fontSize: 12, padding: '4px 14px' }} onClick={handleSave} disabled={!name.trim()}>
          {group.id ? 'Save group' : 'Create group'}
        </SubmitButton>
        <button className="btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }} onClick={onCancel}>Cancel</button>
        {msg && <span style={{ fontSize: 12, color: '#f87171' }}>{msg}</span>}
      </div>
    </div>
  )
}

export default function GroupsTab() {
  const [groups, setGroups] = useState([])
  const [projects, setProjects] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const [g, p, u] = await Promise.all([
        apiFetch('/api/admin/groups').then(r => r.ok ? r.json() : []),
        apiFetch('/api/projects').then(r => r.ok ? r.json() : []),
        apiFetch('/api/assignees').then(r => r.ok ? r.json() : []),
      ])
      setGroups(g || []); setProjects(p || []); setUsers(u || [])
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(id, name) {
    if (!confirm(`Delete group "${name}"? Members keep their personal permissions.`)) return
    const res = await apiFetch(`/api/admin/groups/${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (res.ok) load()
    else alert('Delete failed.')
  }

  return (
    <section className="section-card" style={{ marginTop: 0, borderRadius: '0 6px 6px 6px' }}>
      <div className="section-card-header">
        <span>Groups</span>
        {!loading && <span className="badge">{groups.length}</span>}
        <button
          className="btn-ghost"
          style={{ marginLeft: 'auto', fontSize: 12 }}
          onClick={() => { setCreating(v => !v); setExpanded(null) }}
        >
          {creating ? 'Cancel' : '+ New group'}
        </button>
      </div>

      <p style={{ margin: 0, padding: '10px 16px', fontSize: 12, color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>
        A group grants its permissions and project access to every member, on top of what they already have. It never removes access.
      </p>

      {creating && (
        <GroupEditor
          group={{ permissions: [], assignedProjects: null, members: [] }}
          projects={projects}
          users={users}
          onSaved={() => { setCreating(false); load() }}
          onCancel={() => setCreating(false)}
        />
      )}

      {loading ? (
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[0, 1].map(i => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="skeleton" style={{ width: `${40 + i * 20}%`, height: 14 }} />
              <span className="skeleton" style={{ width: 80, height: 28, borderRadius: 6 }} />
            </div>
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className="empty-state-sm" style={{ padding: '20px 16px' }}>No groups yet. Create one above.</div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {groups.map(g => (
            <li key={g.id} style={{ borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 14, color: 'var(--fg)', fontWeight: 500 }}>👥 {g.name}</span>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {g.members.length} member{g.members.length !== 1 ? 's' : ''}
                    {' · '}
                    {g.permissions.length} permission{g.permissions.length !== 1 ? 's' : ''}
                    {' · '}
                    {g.assignedProjects === null ? 'all projects' : `${g.assignedProjects.length} project${g.assignedProjects.length !== 1 ? 's' : ''}`}
                    {g.description ? ` · ${g.description}` : ''}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    className="btn-ghost"
                    style={{ fontSize: 12, padding: '4px 10px' }}
                    onClick={() => { setExpanded(v => v === g.id ? null : g.id); setCreating(false) }}
                  >
                    {expanded === g.id ? 'Done' : 'Edit'}
                  </button>
                  <SubmitButton
                    className="btn-ghost"
                    style={{ fontSize: 12, padding: '4px 10px', color: 'var(--danger, #e05)' }}
                    onClick={() => handleDelete(g.id, g.name)}
                    busyLabel="Deleting…"
                  >
                    Delete
                  </SubmitButton>
                </div>
              </div>
              {expanded === g.id && (
                <GroupEditor
                  group={g}
                  projects={projects}
                  users={users}
                  onSaved={() => { setExpanded(null); load() }}
                  onCancel={() => setExpanded(null)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
