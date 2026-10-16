import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// In the light theme (src/app/globals.css) `.bg-white` is pinned to #ffffff,
// while text-slate-950/900/800 are remapped to ivory/white. The two together
// are white on white: the selected filter chip on the landing and AI pages
// read as an empty pill (found 2026-10-16). The design tokens bg-fg/text-canvas
// flip together and keep the contrast in both themes.
const PAIR = /bg-white\b[^'"`]*\btext-slate-(?:950|900|800)\b|\btext-slate-(?:950|900|800)\b[^'"`]*\bbg-white\b/

// Shrink-only. Not yet checked by eye in the light theme (super_admin only).
const KNOWN = new Set(['src/app/(super-admin)/super-admin/reports/reports-client.tsx'])

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return name === '__tests__' ? [] : files(p)
    return /\.(tsx|ts)$/.test(name) ? [p] : []
  })
}

describe('light theme: no white-pinned surface with theme-flipping dark text', () => {
  const hits = files(join(process.cwd(), 'src'))
    .map(p => relative(process.cwd(), p).split('\\').join('/'))
    .filter(p => readFileSync(p, 'utf8').split('\n').some(line => PAIR.test(line)))

  it('no new file pairs bg-white with text-slate-950/900/800', () => {
    expect(hits.filter(p => !KNOWN.has(p))).toEqual([])
  })

  it('the known list only shrinks', () => {
    expect([...KNOWN].filter(p => !hits.includes(p))).toEqual([])
  })
})
