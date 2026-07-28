import { useState, useEffect } from 'react'
import { apiFetch } from '../lib/api-fetch'
import PermissionGrid, { ProjectPicker } from './PermissionGrid'
import SubmitButton from './SubmitButton'

// Per-user access: what this one account can DO (permissions) and SEE (projects),
// plus which groups it belongs to. Superadmin only — rendered inline in the Admin
// page's Users list.
//
// Three modes per field:
//   inherit -> nothing set on the account; the role policy (and any group) decides
//   all     -> explicit "every project"
//   custom  -> the list below
export default function UserAccessEditor({ userName, onSaved }) {
  const [data, setData] = useState(null)
  const [projects, setProjects] = useState([])
  const [allGroups, setAllGroups] = useState([])
  const [permMode, setPermMode] = useState('inherit')
  const [perms, setPerms] = useState([])
  const [projMode, setProjMode] = useState('inherit')
  const [projList, setProjList] = useState([])
  const [groups, setGroups] = useState([])
  const [msg, setMsg] = useState('')

  useEffect(() => {
    let alive = true
    Promise.all([
      apiFetch(`/api/admin/user-access/${encodeURIComponent(userName)}`).then(r => r.ok ? r.json() : null),
      apiFetch('/api/projects').then(r => r.ok ? r.json() : []),
      apiFetch('/api/admin/groups').then(r => r.ok ? r.json() : []),
    ]).then(([access, projs, grps]) => {
      if (!alive || !access) return
      setData(access)
      setProjects(projs || [])
      setAllGroups(grps || [])
      setGroups((access.groups || []).map(g => g.id))
      setPermMode(access.personal.permissionsInherited ? 'inherit' : 'custom')
      setPerms(access.personal.permissions || access.effective.permissions || [])
      if (access.personal.projectsInherited) setProjMode('inherit')
      else if (access.personal.assignedProjects === null) setProjMode('all')
      else setProjMode('custom')
      setProjList(access.personal.assignedProjects || [])
    })
    return () => { alive = false }
  }, [userName])

  function toggle(perm) {
    setPerms(prev => prev.includes(perm) ? prev.filter(p => p !== perm) : [...prev, perm])
  }

  // Not queued: the response carries the recomputed effective access, which the
  // caller shows immediately — an optimistic patch could not derive it.
  async function handleSave() {
    setMsg('')
    const body = {
      permissions: permMode === 'inherit' ? 'inherit' : perms,
      assignedProjects: projMode === 'inherit' ? 'inherit' : projMode === 'all' ? null : projList,
      groups,
    }
    const res = await apiFetch(`/api/admin/user-access/${encodeURIComponent(userName)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) {
      setMsg('Saved. Takes effect on this user’s next sign-in.')
      onSaved && onSaved()
    } else {
      const d = await res.json().catch(() => ({}))
      setMsg(d.error || 'Save failed.')
    }
  }

  if (!data) {
    return <div style={{ padding: '12px 16px', background: 'var(--sidebar-bg)', color: 'var(--muted)', fontSize: 13 }}>Loading access…</div>
  }

  const modeBtn = (active, label, onClick) => (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontSize: 11, padding: '3px 9px', borderRadius: 4, cursor: 'pointer', border: '1px solid',
        borderColor: active ? 'var(--accent, #818cf8)' : 'var(--border)',
        background: active ? 'rgba(129,140,248,0.12)' : 'transparent',
        color: active ? 'var(--accent, #818cf8)' : 'var(--muted)',
      }}
    >{label}</button>
  )

  return (
    <div style={{ padding: '12px 16px 16px', background: 'var(--sidebar-bg)', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg)' }}>Permissions</span>
          {modeBtn(permMode === 'inherit', 'Inherit role + groups', () => setPermMode('inherit'))}
          {modeBtn(permMode === 'custom', 'Custom for this user', () => { setPermMode('custom'); if (!perms.length) setPerms(data.effective.permissions || []) })}
        </div>
        <PermissionGrid selected={permMode === 'inherit' ? (data.effective.permissions || []) : perms} onToggle={toggle} disabled={permMode === 'inherit'} ceiling={data.ceiling} />
        {permMode === 'custom' && (
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn-ghost" style={{ fontSize: 11, padding: '3px 9px' }} onClick={() => setPerms([...(data.ceiling || [])])}>Select all allowed</button>
            <button className="btn-ghost" style={{ fontSize: 11, padding: '3px 9px' }} onClick={() => setPerms([])}>Clear all</button>
          </div>
        )}
        <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--muted)' }}>
          Capped by the {data.role === 'admin' ? 'Admin' : 'User'} role policy in Access Control — an amber chip is selected here but blocked there.
        </p>
      </div>

      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg)' }}>Visible projects</span>
          {modeBtn(projMode === 'inherit', 'Inherit from groups', () => setProjMode('inherit'))}
          {modeBtn(projMode === 'all', 'All projects', () => setProjMode('all'))}
          {modeBtn(projMode === 'custom', 'Only selected', () => setProjMode('custom'))}
        </div>
        {projMode === 'custom' ? (
          <ProjectPicker projects={projects} value={projList} onChange={v => setProjList(v === null ? projects.map(p => p.slug) : v)} />
        ) : (
          <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>
            {projMode === 'all'
              ? 'Sees every project, regardless of group restrictions.'
              : data.effective.projects === null
                ? 'No restriction set anywhere — sees every project.'
                : `Restricted by groups to: ${data.effective.projects.join(', ') || 'nothing'}`}
          </p>
        )}
      </div>

      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg)', marginBottom: 8 }}>Groups</div>
        {allGroups.length === 0 ? (
          <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>No groups yet — create one in the Groups tab.</p>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {allGroups.map(g => {
              const active = groups.includes(g.id)
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setGroups(prev => active ? prev.filter(x => x !== g.id) : [...prev, g.id])}
                  title={g.description || g.name}
                  style={{
                    fontSize: 12, padding: '4px 10px', borderRadius: 5, cursor: 'pointer', border: '1px solid',
                    borderColor: active ? 'var(--accent, #818cf8)' : 'var(--border)',
                    background: active ? 'rgba(129,140,248,0.12)' : 'transparent',
                    color: active ? 'var(--accent, #818cf8)' : 'var(--muted)',
                    fontWeight: active ? 500 : 400,
                  }}
                >
                  {active ? '✓ ' : ''}{g.name}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <SubmitButton className="btn-primary" style={{ fontSize: 12, padding: '4px 14px' }} onClick={handleSave}>Save access</SubmitButton>
        {msg && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{msg}</span>}
      </div>
    </div>
  )
}
