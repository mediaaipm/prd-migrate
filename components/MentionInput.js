import { useState, useRef } from 'react'

// Text input with @mention autocomplete. Type "@" then a name → dropdown of
// people; picking one inserts a token that parseMentions (KanbanBoard) resolves,
// so the server notifies the mentioned user. Insert form is @username (falls back
// to first name, spaces stripped) — the exact tokens parseMentions matches.
function tokenFor(p) {
  if (p.username) return p.username.toLowerCase()
  const first = (p.name || '').split(' ')[0]
  if (first) return first.toLowerCase()
  return (p.name || '').toLowerCase().replace(/\s+/g, '')
}

// The @token currently being typed: an "@" run right up to the cursor, no space.
function activeMention(value, caret) {
  const upto = value.slice(0, caret)
  const m = upto.match(/@([\w.\-]*)$/)
  if (!m) return null
  return { query: m[1].toLowerCase(), start: caret - m[0].length }
}

export default function MentionInput({ value, onChange, onSubmit, people = [], className = 'form-input', style, placeholder, autoFocus }) {
  const inputRef = useRef(null)
  const [caret, setCaret] = useState(0)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  const mention = open ? activeMention(value, caret) : null
  const matches = mention
    ? people.filter(p => {
        const q = mention.query
        if (!q) return true
        return tokenFor(p).includes(q) || (p.name || '').toLowerCase().includes(q)
      }).slice(0, 8)
    : []
  const showList = !!mention && matches.length > 0

  function sync(e) {
    onChange(e.target.value)
    setCaret(e.target.selectionStart || 0)
    setOpen(true)
    setActive(0)
  }

  function pick(p) {
    const m = activeMention(value, caret)
    if (!m) return
    const insert = `@${tokenFor(p)} `
    const next = value.slice(0, m.start) + insert + value.slice(caret)
    onChange(next)
    setOpen(false)
    const pos = m.start + insert.length
    requestAnimationFrame(() => {
      const el = inputRef.current
      if (el) { el.focus(); el.setSelectionRange(pos, pos); setCaret(pos) }
    })
  }

  function onKeyDown(e) {
    if (showList) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, matches.length - 1)); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(matches[active] || matches[0]); return }
      if (e.key === 'Escape') { e.preventDefault(); setOpen(false); return }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSubmit?.() }
  }

  return (
    <div className="mention-input-wrap">
      <input
        ref={inputRef}
        className={className}
        style={style}
        placeholder={placeholder}
        value={value}
        autoFocus={autoFocus}
        onChange={sync}
        onKeyUp={e => setCaret(e.target.selectionStart || 0)}
        onClick={e => setCaret(e.target.selectionStart || 0)}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
      />
      {showList && (
        <div className="assignee-suggest mention-suggest">
          {matches.map((p, i) => (
            <div
              key={p.name}
              className={`assignee-suggest-item ${i === active ? 'active' : ''}`}
              onMouseDown={e => { e.preventDefault(); pick(p) }}
              onMouseEnter={() => setActive(i)}
            >
              {p.name}{p.username ? <span className="mention-suggest-handle"> @{p.username}</span> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
