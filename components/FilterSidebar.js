import { useEffect } from 'react'

// Slide-in right drawer for the controls that are needed occasionally rather than
// every minute (search, status/priority/category filters, date ranges, exports).
// Keeping them here leaves the toolbar to the actions used on every visit.
export default function FilterSidebar({ open, onClose, title = 'Filters & tools', activeCount = 0, onClear, footer, children }) {
  useEffect(() => {
    if (!open) return
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <>
      <div className="filter-sidebar-overlay" onClick={onClose} />
      <aside className="filter-sidebar" role="dialog" aria-label={title}>
        <div className="filter-sidebar-head">
          <span className="filter-sidebar-title">
            {title}
            {activeCount > 0 && <span className="filter-sidebar-badge">{activeCount}</span>}
          </span>
          <div className="filter-sidebar-head-actions">
            {activeCount > 0 && onClear && (
              <button className="btn-ghost" style={{ fontSize: 11, padding: '3px 8px' }} onClick={onClear}>Clear all</button>
            )}
            <button className="btn-ghost filter-sidebar-close" onClick={onClose} title="Close (Esc)">&#x2715;</button>
          </div>
        </div>
        <div className="filter-sidebar-body">{children}</div>
        {footer && <div className="filter-sidebar-foot">{footer}</div>}
      </aside>
    </>
  )
}

// One labelled block inside the drawer.
export function SidebarSection({ label, count, onClear, children }) {
  return (
    <div className="filter-sidebar-section">
      <div className="filter-sidebar-section-head">
        <span>{label}{count ? ` (${count})` : ''}</span>
        {count > 0 && onClear && (
          <button className="btn-ghost" style={{ fontSize: 11, padding: '1px 6px' }} onClick={onClear}>Clear</button>
        )}
      </div>
      {children}
    </div>
  )
}

// Inline checkbox list — the drawer has room, so no nested popover.
export function SidebarCheckList({ options, selected, onToggle, scroll }) {
  return (
    <div className={`filter-sidebar-list${scroll ? ' scroll' : ''}`}>
      {options.map(o => (
        <label key={o.value} className="filter-sidebar-item">
          <input type="checkbox" checked={selected.includes(o.value)} onChange={() => onToggle(o.value)} />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  )
}
