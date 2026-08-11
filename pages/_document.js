import { Html, Head, Main, NextScript } from 'next/document'

// Runs before the body paints, so a dark-mode user never sees a white flash.
// Kept as a string literal (not an import) because it must be inlined — anything
// that arrives as a separate request is already too late.
const THEME_BOOTSTRAP = `(function(){try{
var t=localStorage.getItem('ss_theme');
if(t!=='light'&&t!=='dark'){t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}
document.documentElement.setAttribute('data-theme',t)
}catch(e){document.documentElement.setAttribute('data-theme','light')}})()`

export default function Document() {
  return (
    <Html lang="en" data-theme="light">
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
