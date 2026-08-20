// Theme lives entirely on the client: it is a display preference, not account
// state, so it never rides on the session and never hits Redis.
//
// Two attributes are stamped on <html>:
//   data-theme — the exact theme id ('light', 'dark', 'light-neon', …)
//   data-mode  — 'light' | 'dark', the *family* it belongs to
// globals.css keys its base token sets and every dark-mode exception off
// data-mode, so a new theme inherits a working baseline; data-theme only carries
// that theme's own overrides. pages/_document.js repeats the read/apply inline so
// the first paint is already correct — a React effect would run after paint and
// flash the wrong colours.
import { useEffect, useState } from 'react'

export const THEME_KEY = 'ss_theme'

/**
 * The theme registry — the single source of truth. To add a theme:
 *   1. add an entry here (id must be a valid CSS attribute value)
 *   2. add `html[data-theme="<id>"] { … }` to the variant block in globals.css,
 *      overriding only the tokens that differ from its mode's baseline
 * Nothing else needs touching: the nav cycles the list, and _document reads it.
 */
export const THEMES = [
  { id: 'light',      label: 'Light',      icon: '☀️', mode: 'light' },
  { id: 'dark',       label: 'Dark',       icon: '🌙', mode: 'dark'  },
  { id: 'light-neon', label: 'Light Neon', icon: '🌈', mode: 'light' },
  { id: 'dark-neon',  label: 'Dark Neon',  icon: '⚡', mode: 'dark'  },
  { id: 'sunrise',    label: 'Sunrise',    icon: '🌅', mode: 'light' },
  { id: 'morning',    label: 'Morning',    icon: '🌤️', mode: 'light' },
  { id: 'sunset',     label: 'Sunset',     icon: '🌇', mode: 'dark'  },
  { id: 'evening',    label: 'Evening',    icon: '🌆', mode: 'dark'  },
  { id: 'chocolate',  label: 'Chocolate',  icon: '🍫', mode: 'dark'  },
  { id: 'blackhole',  label: 'Blackhole',  icon: '🕳️', mode: 'dark'  },
]

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

/**
 * Read + cycle the theme. Starts as 'light' on the server render so markup
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
  }
}
