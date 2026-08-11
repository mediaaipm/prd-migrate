// Theme (light/dark) lives entirely on the client: it is a display preference, not
// account state, so it never rides on the session and never hits Redis.
//
// The chosen theme is stamped on <html data-theme>; globals.css does the rest.
// pages/_document.js repeats the read/apply inline so the first paint is already
// correct — a React effect would run after paint and flash white.
import { useEffect, useState } from 'react'

export const THEME_KEY = 'ss_theme'
export const THEMES = ['light', 'dark']

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
    return THEMES.includes(v) ? v : null
  } catch {
    return null
  }
}

export function resolveTheme() {
  return storedTheme() || systemTheme()
}

export function applyTheme(theme) {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light'
}

export function setTheme(theme) {
  try { localStorage.setItem(THEME_KEY, theme) } catch {}
  applyTheme(theme)
  try { window.dispatchEvent(new CustomEvent('ss-theme', { detail: theme })) } catch {}
}

/**
 * Read + toggle the theme. Starts as 'light' on the server render so markup
 * matches what _document emitted; the real value lands in the first effect.
 */
export function useTheme() {
  const [theme, setThemeState] = useState('light')

  useEffect(() => {
    setThemeState(resolveTheme())

    function onThemeEvent(e) { setThemeState(e.detail) }
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

  function toggle() {
    setTheme(theme === 'dark' ? 'light' : 'dark')
    setThemeState(theme === 'dark' ? 'light' : 'dark')
  }

  return { theme, toggle, setTheme }
}
