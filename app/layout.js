import '../styles/app.css'
import { Geist, Geist_Mono } from 'next/font/google'
import AppShell from '../components/AppShell'
import { THEMES, THEME_KEY } from '../lib/theme-registry'

// Runs before the body paints, so a themed user never sees a flash of the wrong
// palette. The id→mode map is baked in from the registry at build time — it must
// be *inlined*, but it must not be a second copy of the theme list.
const MODES = JSON.stringify(Object.fromEntries(THEMES.map(t => [t.id, t.mode])))

const THEME_BOOTSTRAP = `(function(){try{
var m=${MODES},d=document.documentElement;
var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});
if(!m[t]){t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}
d.setAttribute('data-theme',t);d.setAttribute('data-mode',m[t])
}catch(e){var x=document.documentElement;x.setAttribute('data-theme','light');x.setAttribute('data-mode','light')}})()`

// Self-hosted at build time by next/font; exposed as CSS vars that globals.css and
// the Tailwind theme (styles/app.css) both read.
const geist = Geist({ subsets: ['latin'], variable: '--font-geist', display: 'swap' })
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono', display: 'swap' })

export const metadata = { title: 'Task Manager' }

// The script rewrites data-theme/data-mode before React hydrates, so <html> is
// expected to differ from the server render — hence suppressHydrationWarning.
export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`} data-theme="light" data-mode="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  )
}
