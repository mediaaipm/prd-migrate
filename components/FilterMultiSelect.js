import { useState, useEffect, useRef } from 'react'

// Multi-select checkbox dropdown. Fixed-position menu escapes the .section-card
// overflow clip (same technique as the specific-due-dates picker).
export default function FilterMultiSelect({ label, options, selected, onToggle, onClear }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const wrapRef = useRef(null)
  const btnRef = useRef(null)

  function openMenu() {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 4, left: r.left })
    }
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    function onDocClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    function onDismiss() { setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    window.addEventListener('scroll', onDismiss, true)
    window.addEventListener('resize', onDismiss)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      window.removeEventListener('scroll', onDismiss, true)
      window.removeEventListener('resize', onDismiss)
    }
  }, [open])

  return (
    <div className="tt-due-picker" ref={wrapRef}>
      <button
        type="button"
        ref={btnRef}
        className={`form-input filter-select tt-due-picker-btn${selected.length ? ' active' : ''}`}
        onClick={() => open ? setOpen(false) : openMenu()}
        style={{ fontSize: 12, padding: '5px 8px' }}
        title={label}
      >
        {selected.length ? `${label}: ${selected.length}` : `All ${label.toLowerCase()}`} ▾
      </button>
      {open && (
        <div className="tt-due-picker-menu" style={pos ? { top: pos.top, left: pos.left } : undefined}>
          <div className="tt-due-picker-head">
            <span>{label}</span>
            {selected.length > 0 && (
              <button className="btn-ghost" style={{ fontSize: 11, padding: '2px 6px' }} onClick={onClear}>Clear</button>
            )}
          </div>
          {options.map(o => (
            <label key={o.value} className="tt-due-picker-item">
              <input type="checkbox" checked={selected.includes(o.value)} onChange={() => onToggle(o.value)} />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

// Checkbox popover over the concrete dates present in the data ("Pick dates").
export function DatePicker({ label, dates, selected, onToggle, onClear, format }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const wrapRef = useRef(null)
  const btnRef = useRef(null)

  function openMenu() {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 4, left: r.left })
    }
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    function onDocClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    function onDismiss() { setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    window.addEventListener('scroll', onDismiss, true)
    window.addEventListener('resize', onDismiss)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      window.removeEventListener('scroll', onDismiss, true)
      window.removeEventListener('resize', onDismiss)
    }
  }, [open])

  return (
    <div className="tt-due-picker" ref={wrapRef}>
      <button
        type="button"
        ref={btnRef}
        className={`form-input filter-select tt-due-picker-btn${selected.length ? ' active' : ''}`}
        onClick={() => open ? setOpen(false) : openMenu()}
        style={{ fontSize: 12, padding: '5px 8px' }}
        title="Pick specific due dates"
      >
        {selected.length ? `${selected.length} date${selected.length !== 1 ? 's' : ''}` : 'Pick dates'} ▾
      </button>
      {open && (
        <div className="tt-due-picker-menu" style={pos ? { top: pos.top, left: pos.left } : undefined}>
          <div className="tt-due-picker-head">
            <span>{label || 'Due dates'}</span>
            {selected.length > 0 && (
              <button className="btn-ghost" style={{ fontSize: 11, padding: '2px 6px' }} onClick={onClear}>Clear</button>
            )}
          </div>
          {dates.map(d => (
            <label key={d} className="tt-due-picker-item">
              <input type="checkbox" checked={selected.includes(d)} onChange={() => onToggle(d)} />
              <span>{format ? format(d) : d}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
