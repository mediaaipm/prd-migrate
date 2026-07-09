import { useEffect, useRef, useState } from 'react'

// The queue accepts a submission in well under a frame, so a naive `busy` state
// would flicker and read as "nothing happened". Hold the busy state for long enough
// to be seen — it exists to acknowledge the click and swallow double-clicks, not to
// represent the database write.
const MIN_BUSY_MS = 450

/**
 * Submit button that goes busy on the click, not on the response.
 *
 * onClick may be sync (the normal case: it just enqueues) or async (for the few
 * mutations that must await the server). Either way the button is disabled for the
 * whole of it, so a double-click cannot submit twice.
 */
export default function SubmitButton({
  onClick,
  children,
  busyLabel = 'Saving…',
  className = 'btn-primary',
  disabled = false,
  type = 'button',
  ...rest
}) {
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  async function handleClick(e) {
    if (busy || disabled) return
    setBusy(true)
    const floor = new Promise(r => setTimeout(r, MIN_BUSY_MS))
    try {
      await onClick?.(e)
    } finally {
      await floor
      if (alive.current) setBusy(false)
    }
  }

  return (
    <button
      type={type}
      className={className}
      disabled={busy || disabled}
      onClick={handleClick}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy ? (
        <>
          <span className="btn-spinner" aria-hidden="true" />
          {busyLabel}
        </>
      ) : children}
    </button>
  )
}
