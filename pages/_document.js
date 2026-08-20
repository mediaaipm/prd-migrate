import { Html, Head, Main, NextScript } from 'next/document'
import { THEMES, THEME_KEY } from '../lib/theme'

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

export default function Document() {
  return (
    <Html lang="en" data-theme="light" data-mode="light">
      <Head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}
