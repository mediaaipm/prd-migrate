import { useEffect, useRef } from 'react'

const PRIORITY_COLOR = { low: '#64748b', medium: '#f59e0b', high: '#dc2626', critical: '#9f1239' }
const PRIORITY_LABEL = { low: 'Low', medium: 'Med', high: 'High', critical: 'Crit' }

// What a swimlane cell holds once it no longer fits. Cells are a fixed height so
// the grid stays a grid, which means everything past the first card lives behind
// a "+N more" chip — this is where it comes back, with the owner, the date and
// the sub-task progress the card had to drop.
//
// `tasks` is recomputed by the caller on every render rather than captured when
// the popup opened, so moving a task to another column here removes it from this
// list exactly as it removes it from the cell behind.
export default function CellPeekModal({
  tasks,
  columns,
  statusLabel,
  statusColor,
  laneTitle,
  railName,
  taskPrefix,
  formatDate,
  isOverdue,
  subCount,
  labelById,
  canSetStatus,
  statusAllowed,
  onSetStatus,
  onOpen,
  onClose,
}) {
  const panelRef = useRef(null)

  // Esc closes from anywhere, including when focus never entered the panel.
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    panelRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const readOnly = typeof onSetStatus !== 'function'

  return (
    <div className="kanban-modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`Tasks in ${statusLabel}`}
        className="kanban-modal cell-peek"
        style={{ maxWidth: 620 }}
      >
        <div className="kanban-modal-header cell-peek-header">
          <div className="cell-peek-heading">
            <div className="cell-peek-status">
              <span className="kanban-column-dot" style={{ background: statusColor }} />
              {statusLabel}
            </div>
            {/* The full coordinate — a cell only means anything as the
                intersection of its three axes. */}
            <div className="cell-peek-crumb">
              <span>{laneTitle}</span>
              {railName && <><span className="cell-peek-sep">›</span><span>{railName}</span></>}
              <span className="cell-peek-sep">·</span>
              <span>{tasks.length} task{tasks.length === 1 ? '' : 's'}</span>
            </div>
          </div>
          <button className="kanban-modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="cell-peek-list">
          {tasks.length === 0 && (
            <div className="kanban-empty" style={{ margin: 0 }}>Nothing left in this cell.</div>
          )}
          {tasks.map(t => {
            const assignees = Array.isArray(t.assignees) ? t.assignees : (t.assignee ? [t.assignee] : [])
            const overdue = t.dueDate && isOverdue?.(t.dueDate)
            const subs = subCount?.(t)
            const editable = !readOnly && canSetStatus?.(t)
            const labels = (Array.isArray(t.labelIds) ? t.labelIds : []).map(id => labelById?.[id]).filter(Boolean)
            return (
              <div className="cell-peek-row" key={t.id}>
                <span
                  className="cell-peek-pri"
                  style={{ background: PRIORITY_COLOR[t.priority] || 'transparent' }}
                  title={t.priority ? `${PRIORITY_LABEL[t.priority]} priority` : 'No priority'}
                />
                <div className="cell-peek-main">
                  <div className="cell-peek-title-row">
                    {(t.number || t.seq != null) && (
                      <span className="task-number">
                        {t.number || (taskPrefix ? `${taskPrefix}-${t.seq}` : `#${t.seq}`)}
                      </span>
                    )}
                    <button className="cell-peek-title" onClick={() => onOpen?.(t)} title="Open task">
                      {t.title}
                    </button>
                  </div>
                  <div className="cell-peek-meta">
                    {labels.map(l => (
                      <span
                        key={l.id}
                        className="kanban-label-chip kanban-label-chip--mini"
                        style={{ background: l.color }}
                        title={l.name}
                      >{l.name}</span>
                    ))}
                    {assignees.map(a => {
                      const name = typeof a === 'object' ? a?.name : a
                      return (
                        <span key={name} className="kanban-assignee-avatar cell-peek-avatar" title={name}>
                          {String(name || '?').charAt(0).toUpperCase()}
                        </span>
                      )
                    })}
                    {t.dueDate && (
                      <span className={`cell-peek-due${overdue ? ' cell-peek-due--overdue' : ''}`}>
                        {overdue ? 'Overdue ' : 'Due '}{formatDate ? formatDate(t.dueDate) : t.dueDate}
                      </span>
                    )}
                    {subs?.total > 0 && (
                      <span className="cell-peek-subs">{subs.done}/{subs.total} sub-tasks</span>
                    )}
                    {!labels.length && !assignees.length && !t.dueDate && !subs?.total && (
                      <span className="cell-peek-meta-empty">No assignee, no due date</span>
                    )}
                  </div>
                </div>
                {readOnly ? (
                  <span className="cell-peek-readonly">{statusLabel}</span>
                ) : (
                  <select
                    className="cell-peek-status-select"
                    value={t.status || 'todo'}
                    disabled={!editable}
                    title={editable ? 'Move to another column' : 'You cannot change this task’s status'}
                    onChange={e => onSetStatus(t, e.target.value)}
                  >
                    {columns.map(c => (
                      <option key={c.status} value={c.status} disabled={!statusAllowed?.(c.status)}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
