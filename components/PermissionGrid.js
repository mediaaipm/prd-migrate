import { PERMISSION_GROUPS, PERMISSION_LABELS } from '../lib/permissions'

// Shared permission chip grid — used by the role-policy page, the group editor and
// the per-user access editor so all three stay in step with PERMISSION_GROUPS.
export default function PermissionGrid({ selected, onToggle, disabled = false, ceiling = null }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, opacity: disabled ? 0.5 : 1 }}>
      {PERMISSION_GROUPS.map(group => (
        <div key={group.label}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{group.label}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {group.perms.map(perm => {
              const active = selected.includes(perm)
              // A perm outside the role-policy ceiling can be selected but will not
              // take effect — flag it rather than hiding it.
              const capped = ceiling && !ceiling.includes(perm)
              return (
                <button
                  key={perm}
                  type="button"
                  disabled={disabled}
                  onClick={() => !disabled && onToggle(perm)}
                  title={capped ? 'Not granted to this role by the access-control policy — has no effect until you add it there.' : perm}
                  style={{
                    fontSize: 12, padding: '4px 10px', borderRadius: 5, cursor: disabled ? 'default' : 'pointer', border: '1px solid',
                    borderColor: active ? (capped ? '#f59e0b' : 'var(--accent, #818cf8)') : 'var(--border)',
                    background: active ? (capped ? 'rgba(245,158,11,0.12)' : 'rgba(129,140,248,0.12)') : 'transparent',
                    color: active ? (capped ? '#f59e0b' : 'var(--accent, #818cf8)') : 'var(--muted)',
                    fontWeight: active ? 500 : 400,
                    textDecoration: capped && active ? 'line-through' : 'none',
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

// Project visibility picker. `value` is null for "every project" or an array of
// slugs. Mirrors the assignedProjects encoding in lib/user-access.js.
export function ProjectPicker({ projects, value, onChange, disabled = false }) {
  const all = projects.map(p => p.slug)
  const effective = value === null ? all : (value || [])
  return (
    <div style={{ opacity: disabled ? 0.5 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Project access
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(null)}
          style={{
            fontSize: 11, padding: '2px 7px', borderRadius: 4, cursor: disabled ? 'default' : 'pointer', border: '1px solid',
            borderColor: value === null ? 'var(--accent, #818cf8)' : 'var(--border)',
            background: value === null ? 'rgba(129,140,248,0.12)' : 'transparent',
            color: value === null ? 'var(--accent, #818cf8)' : 'var(--muted)',
          }}
        >
          All projects
        </button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {projects.map(p => {
          const active = effective.includes(p.slug)
          return (
            <button
              key={p.slug}
              type="button"
              disabled={disabled}
              onClick={() => {
                if (disabled) return
                // Un-ticking one project while on "all" pins the rest as an explicit list.
                const base = value === null ? all : effective
                onChange(active ? base.filter(s => s !== p.slug) : [...base, p.slug])
              }}
              style={{
                fontSize: 12, padding: '4px 10px', borderRadius: 5, cursor: disabled ? 'default' : 'pointer', border: '1px solid',
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
  )
}
