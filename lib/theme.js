// Theme lives entirely on the client: it is a display preference, not account
// state, so it never rides on the session and never hits Redis.
//
// Two attributes are stamped on <html>:
//   data-theme — the exact theme id ('light', 'dark', 'light-neon', …)
//   data-mode  — 'light' | 'dark', the *family* it belongs to
// globals.css keys its base token sets and every dark-mode exception off
// data-mode, so a new theme inherits a working baseline; data-theme only carries
// that theme's own overrides. app/layout.js repeats the read/apply inline so
// the first paint is already correct — a React effect would run after paint and
// flash the wrong colours.
import { useEffect, useState } from 'react'

import { THEME_KEY, THEMES } from './theme-registry'

export { THEME_KEY, THEMES }

export const THEME_IDS = THEMES.map(t => t.id)

export function getTheme(id) {
  return THEMES.find(t => t.id === id) || THEMES[0]
}

export function systemTheme() {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

// null when the user has never chosen — that's the signal to follow the OS.
export function storedTheme() {
  try {
    const v = localStorage.getItem(THEME_KEY)
    return THEME_IDS.includes(v) ? v : null
  } catch {
    return null
  }
}

export function resolveTheme() {
  return storedTheme() || systemTheme()
}

// The next theme in the registry, wrapping round — one click, one step.
export function nextTheme(id) {
  const i = THEME_IDS.indexOf(id)
  return THEME_IDS[(i + 1) % THEME_IDS.length]
}

export function applyTheme(theme) {
  if (typeof document === 'undefined') return
  const t = getTheme(theme)
  document.documentElement.dataset.theme = t.id
  document.documentElement.dataset.mode = t.mode
}

export function setTheme(theme) {
  const id = getTheme(theme).id
  try { localStorage.setItem(THEME_KEY, id) } catch {}
  applyTheme(id)
  try { window.dispatchEvent(new CustomEvent('ss-theme', { detail: id })) } catch {}
}

// Forget the explicit choice and follow the OS again.
export function followSystem() {
  try { localStorage.removeItem(THEME_KEY) } catch {}
  const id = systemTheme()
  applyTheme(id)
  try { window.dispatchEvent(new CustomEvent('ss-theme', { detail: id })) } catch {}
}

/**
 * Read + cycle the theme. Starts as 'light' on the server render so markup
 * matches what _document emitted; the real value lands in the first effect.
 */
export function useTheme() {
  const [theme, setThemeState] = useState('light')
  // True while no explicit choice is stored — the theme tracks the OS.
  const [isSystem, setIsSystem] = useState(false)

  useEffect(() => {
    setThemeState(resolveTheme())
    setIsSystem(!storedTheme())

    function onThemeEvent(e) { setThemeState(e.detail); setIsSystem(!storedTheme()) }
    window.addEventListener('ss-theme', onThemeEvent)

    // Follow the OS only while the user has no explicit preference of their own.
    let mq
    function onSystem() { if (!storedTheme()) { const t = systemTheme(); applyTheme(t); setThemeState(t) } }
    try {
      mq = window.matchMedia('(prefers-color-scheme: dark)')
      mq.addEventListener('change', onSystem)
    } catch {}

    return () => {
      window.removeEventListener('ss-theme', onThemeEvent)
      try { mq && mq.removeEventListener('change', onSystem) } catch {}
    }
  }, [])

  function cycle() {
    const n = nextTheme(theme)
    setTheme(n)
    setThemeState(n)
  }

  return {
    theme,
    meta: getTheme(theme),
    next: getTheme(nextTheme(theme)),
    cycle,
    // Kept for callers that toggle rather than cycle (light ⇄ dark families).
    toggle: cycle,
    setTheme,
    isSystem,
    followSystem,
  }
}
