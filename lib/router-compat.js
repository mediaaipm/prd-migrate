'use client'

import { useMemo } from 'react'
import { useParams, usePathname, useSearchParams, useRouter as useNavRouter } from 'next/navigation'

// The pages-router `useRouter()` surface the views were written against, on top of
// next/navigation. Same shape the views read:
//   query     search params with route params on top; a repeated key is an array
//   pathname  the real path (pages gave the route pattern; every caller works with both)
//   isReady   always true — the App Router has the query on first render
//   push / replace (href, as, { shallow, scroll }) — `as` is ignored, `shallow` is
//             what the App Router does anyway for a same-route URL change
//   reload / back
//
// Navigation goes through the unsaved-work guard (lib/use-submit-queue.js), which the
// pages router fed through `router.events.routeChangeStart`.

let navigationGuard = null

// Set by useUnloadGuard while writes are in flight; returns false to cancel.
export function setNavigationGuard(fn) {
  navigationGuard = fn
}

function allowed(href) {
  if (!navigationGuard) return true
  try {
    const next = new URL(href, window.location.href)
    // A change of query on the same page (tabs, filters) is not leaving the page.
    if (next.pathname === window.location.pathname) return true
  } catch {}
  return navigationGuard(href)
}

export function useRouter() {
  const nav = useNavRouter()
  const params = useParams()
  const pathname = usePathname() || '/'
  const searchParams = useSearchParams()

  return useMemo(() => {
    const query = {}
    if (searchParams) {
      for (const key of new Set(searchParams.keys())) {
        const all = searchParams.getAll(key)
        query[key] = all.length > 1 ? all : all[0]
      }
    }
    Object.assign(query, params || {})
    const search = searchParams ? searchParams.toString() : ''
    const scroll = opts => !(opts && opts.scroll === false)

    return {
      query,
      pathname,
      asPath: pathname + (search ? `?${search}` : ''),
      isReady: true,
      push(href, _as, opts) { if (allowed(href)) nav.push(href, { scroll: scroll(opts) }) },
      replace(href, _as, opts) { if (allowed(href)) nav.replace(href, { scroll: scroll(opts) }) },
      prefetch(href) { nav.prefetch(href) },
      back() { nav.back() },
      reload() { window.location.reload() },
    }
  }, [nav, params, pathname, searchParams])
}
