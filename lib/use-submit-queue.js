import { useEffect, useState } from 'react'
import { setNavigationGuard } from './router-compat'
import { getState, subscribe } from './submit-queue'

const EMPTY = { items: [], pending: 0, parked: [] }

// Live view of the queue. Starts empty so the server render and the first client
// render agree; the real state arrives in the effect.
export function useQueueState() {
  const [state, setState] = useState(EMPTY)
  useEffect(() => {
    setState(getState())
    return subscribe(setState)
  }, [])
  return state
}

export const LEAVE_WARNING = 'We are saving your progress. Please wait a moment before leaving this page.'

/**
 * Blocks tab close, reload, and in-app navigation while writes are still in flight.
 * Parked (failed) items do not block — the user has already been shown the error and
 * must be able to leave.
 */
export function useUnloadGuard(pending) {
  useEffect(() => {
    if (!pending) return

    // Browsers ignore the custom string and show their own copy, but returnValue
    // must be set for the prompt to appear at all.
    const onBeforeUnload = e => {
      e.preventDefault()
      e.returnValue = LEAVE_WARNING
      return LEAVE_WARNING
    }

    const confirmLeave = () => window.confirm(`${LEAVE_WARNING}\n\nLeave anyway?`)

    // Client-side navigation never triggers beforeunload, and the App Router has no
    // cancellable route event, so in-app links are caught on their way to <Link>:
    // a capture listener on the document runs before React's own click handling,
    // and stopping the event there cancels the transition.
    const onClick = e => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = e.target && e.target.closest ? e.target.closest('a[href]') : null
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return
      let next
      try { next = new URL(a.href, window.location.href) } catch { return }
      // Another origin is a full page load — beforeunload already covers it.
      if (next.origin !== window.location.origin) return
      // Same page (query/hash changes) is not leaving.
      if (next.pathname === window.location.pathname) return
      if (confirmLeave()) return
      e.preventDefault()
      e.stopPropagation()
    }

    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('click', onClick, true)
    // Programmatic navigation (router.push from a notification, the editor
    // redirect) goes through lib/router-compat.js, which asks this.
    setNavigationGuard(confirmLeave)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('click', onClick, true)
      setNavigationGuard(null)
    }
  }, [pending])
}
