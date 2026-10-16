// next/font/google, offline: Next reads Google Fonts responses from this module
// when NEXT_FONT_GOOGLE_MOCKED_RESPONSES points at it, and then never fetches
// (node_modules/next/dist/compiled/@next/font/dist/google/fetch-css-from-google-fonts.js).
// Every CSS URL gets one placeholder @font-face; the "font file" for a non-path
// URL is just its bytes (fetch-font-file.js), so nothing leaves the machine and
// the browser falls back to the stack's next font. Typography is not under test.
'use strict'
const css = url => {
  const family = decodeURIComponent((String(url).match(/family=([^:&]+)/) || [])[1] || 'EQTEST').replace(/\+/g, ' ')
  return `/* latin */\n@font-face {\n  font-family: '${family}';\n  font-style: normal;\n  font-weight: 400;\n  font-display: swap;\n  src: url(eqtest-offline-font) format('woff2');\n  unicode-range: U+0000-00FF;\n}\n`
}
module.exports = new Proxy({}, {
  get(_target, key) { return typeof key === 'string' && key.startsWith('https://fonts.googleapis.com/') ? css(key) : undefined },
  has(_target, key) { return typeof key === 'string' && key.startsWith('https://fonts.googleapis.com/') },
})
