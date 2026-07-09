import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
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
  const router = useRouter()

  useEffect(() => {
    if (!pending) return

    // Browsers ignore the custom string and show their own copy, but returnValue
    // must be set for the prompt to appear at all.
    const onBeforeUnload = e => {
      e.preventDefault()
      e.returnValue = LEAVE_WARNING
      return LEAVE_WARNING
    }

    // Client-side navigation never triggers beforeunload, so it needs its own gate.
    const onRouteChange = () => {
      if (window.confirm(`${LEAVE_WARNING}\n\nLeave anyway?`)) return
      router.events.emit('routeChangeError')
      // Next has no cancel API; throwing out of the handler aborts the transition.
      // eslint-disable-next-line no-throw-literal
      throw 'routeChange aborted by unsaved-work guard'
    }

    window.addEventListener('beforeunload', onBeforeUnload)
    router.events.on('routeChangeStart', onRouteChange)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      router.events.off('routeChangeStart', onRouteChange)
    }
  }, [pending, router])
}
