import { useState, useEffect, useRef } from 'react'

export default function AssigneeInput({ value = [], options = [], onChange }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const wrapRef = useRef(null)

  const matches = options
    .filter(o => !value.includes(o.name))
    .filter(o => o.name.toLowerCase().includes(query.trim().toLowerCase()))
    .slice(0, 8)

  useEffect(() => {
    function onDoc(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  function add(name) {
    if (!name || value.includes(name)) return
    onChange([...value, name])
    setQuery('')
    setActive(0)
    setOpen(false)
  }

  function remove(name) {
    onChange(value.filter(a => a !== name))
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(a => Math.min(a + 1, matches.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      if (matches[active]) add(matches[active].name)
      else if (query.trim()) add(query.trim())
    }
    else if (e.key === 'Backspace' && !query && value.length) remove(value[value.length - 1])
    else if (e.key === 'Escape') setOpen(false)
  }

  return (
    <div className="assignee-input" ref={wrapRef}>
      <span className="task-assignees-label">Assignees:</span>
      <div className="assignee-input-field">
        {value.map(name => (
          <span key={name} className="assignee-token">
            {name}
            <button type="button" className="assignee-token-x" onClick={() => remove(name)} aria-label={`Remove ${name}`}>×</button>
          </span>
        ))}
        <input
          className="assignee-input-text"
          placeholder={value.length ? '' : 'Type a name…'}
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); setActive(0) }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          onBlur={() => { if (query.trim()) add(query.trim()) }}
        />
      </div>
      {open && matches.length > 0 && (
        <div className="assignee-suggest">
          {matches.map((o, i) => (
            <div
              key={o.name}
              className={`assignee-suggest-item ${i === active ? 'active' : ''}`}
              onMouseDown={e => { e.preventDefault(); add(o.name) }}
              onMouseEnter={() => setActive(i)}
            >
              {o.name}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
