import { useEffect, useRef, useState } from 'react'

// Lightweight right-click menu rendered at the cursor. Closes on any outside
// click, scroll, escape, or resize. `items` is [{ label, icon?, danger?, onClick }].
export default function TaskContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null)
  const [pos, setPos] = useState({ left: x, top: y })

  // Keep the menu inside the viewport.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const left = x + r.width > window.innerWidth ? Math.max(8, window.innerWidth - r.width - 8) : x
    const top = y + r.height > window.innerHeight ? Math.max(8, window.innerHeight - r.height - 8) : y
    setPos({ left, top })
  }, [x, y])

  useEffect(() => {
    const close = () => onClose()
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('click', close)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="ctx-menu"
      style={{ left: pos.left, top: pos.top }}
      onClick={e => e.stopPropagation()}
      onContextMenu={e => { e.preventDefault(); e.stopPropagation() }}
    >
      {items.map((it, i) => (
        <button
          key={i}
          className={`ctx-menu-item${it.danger ? ' ctx-menu-item--danger' : ''}`}
          onClick={() => { onClose(); it.onClick?.() }}
        >
          {it.icon && <span className="ctx-menu-icon">{it.icon}</span>}
          {it.label}
        </button>
      ))}
    </div>
  )
}
