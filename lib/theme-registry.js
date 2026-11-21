// The theme registry, kept free of React so the root layout (a server component) can
// read it to build the pre-paint script. lib/theme.js re-exports it; this is the
// only copy of the list.
export const THEME_KEY = 'ss_theme'

/**
 * The theme registry — the single source of truth. To add a theme:
 *   1. add an entry here (id must be a valid CSS attribute value)
 *   2. add `html[data-theme="<id>"] { … }` to the variant block in globals.css,
 *      overriding only the tokens that differ from its mode's baseline
 *   3. give it a `swatch` (the same bg/card/accent/text hexes) for the picker preview
 * Nothing else needs touching: the nav's theme picker lists it, and app/layout.js reads it.
 */
export const THEMES = [
  { id: 'light',      label: 'Light',      icon: '☀️', mode: 'light', blurb: 'Clean neutral, violet accent', swatch: { bg: '#fafafa', card: '#ffffff', accent: '#7c3aed', text: '#09090b' } },
  { id: 'morning',    label: 'Morning',    icon: '🌤️', mode: 'light', blurb: 'Cool daylight blue',            swatch: { bg: '#eff6ff', card: '#ffffff', accent: '#0369a1', text: '#10263d' } },
  { id: 'sunrise',    label: 'Sunrise',    icon: '🌅', mode: 'light', blurb: 'Warm peach, burnt orange',      swatch: { bg: '#fff4ea', card: '#fffaf6', accent: '#c2410c', text: '#3b2415' } },
  { id: 'light-neon', label: 'Light Neon', icon: '🌈', mode: 'light', blurb: 'Bright lavender, magenta',      swatch: { bg: '#f2f0ff', card: '#ffffff', accent: '#c400e8', text: '#17103a' } },
  { id: 'dark',       label: 'Dark',       icon: '🌙', mode: 'dark',  blurb: 'Neutral charcoal, soft violet', swatch: { bg: '#09090b', card: '#18181b', accent: '#a78bfa', text: '#fafafa' } },
  { id: 'evening',    label: 'Evening',    icon: '🌆', mode: 'dark',  blurb: 'Indigo twilight',               swatch: { bg: '#0b1020', card: '#141b32', accent: '#818cf8', text: '#e3e8ff' } },
  { id: 'sunset',     label: 'Sunset',     icon: '🌇', mode: 'dark',  blurb: 'Dusk plum, molten orange',      swatch: { bg: '#1a0e1c', card: '#2a1526', accent: '#ff6b35', text: '#ffe9dd' } },
  { id: 'chocolate',  label: 'Chocolate',  icon: '🍫', mode: 'dark',  blurb: 'Cocoa and caramel',             swatch: { bg: '#1b1310', card: '#2a1e18', accent: '#d99058', text: '#f3e4d7' } },
  { id: 'dark-neon',  label: 'Dark Neon',  icon: '⚡', mode: 'dark',  blurb: 'Deep violet, electric cyan',    swatch: { bg: '#06020f', card: '#0e0624', accent: '#00e5ff', text: '#ece6ff' } },
  { id: 'blackhole',  label: 'Blackhole',  icon: '🕳️', mode: 'dark',  blurb: 'True black for OLED screens',   swatch: { bg: '#000000', card: '#08080b', accent: '#b06cff', text: '#eaeaf2' } },
]
