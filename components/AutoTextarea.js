import { useRef, useEffect } from 'react'

// Textarea that grows with its content up to maxHeight, then scrolls.
export default function AutoTextarea({ value, minRows = 2, maxHeight = 320, className = '', ...rest }) {
  const ref = useRef(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    const h = Math.min(el.scrollHeight, maxHeight)
    el.style.height = h + 'px'
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }, [value, maxHeight])

  return (
    <textarea
      ref={ref}
      rows={minRows}
      value={value}
      className={('auto-textarea ' + className).trim()}
      {...rest}
    />
  )
}
