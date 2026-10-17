import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { clientMessages } from '@/i18n/messages'

// Each marketing page now receives only its own `public` section plus
// `shell` (src/components/public/marketing-page.tsx). Sending all of
// `public` put every other page's copy into each page (~14 KB gzip on /ar,
// 2026-10-17). A section a component reads but the page does not send would
// render raw key paths, so this test reads the sources: for every page, each
// `public.<section>` its client components use must be in the list it sends.

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')

function resolveImport(from: string, spec: string): string | null {
  const base = spec.startsWith('@/') ? join(SRC, spec.slice(2)) : spec.startsWith('.') ? resolve(dirname(from), spec) : null
  if (!base) return null
  for (const ext of ['', '.tsx', '.ts', '/index.tsx', '/index.ts']) {
    const p = base + ext
    if (existsSync(p) && statSync(p).isFile()) return p
  }
  return null
}

/** The file and every local component/lib file it imports, transitively. */
function closure(entry: string, seen = new Set<string>()): Set<string> {
  if (seen.has(entry)) return seen
  seen.add(entry)
  const src = readFileSync(entry, 'utf8')
  for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
    const p = resolveImport(entry, m[1])
    if (p && /[\\/]src[\\/](components|app)[\\/]/.test(p)) closure(p, seen)
  }
  return seen
}

/** `public.<section>` names a source reads through next-intl. */
function sectionsRead(src: string): string[] {
  const out = new Set<string>()
  for (const m of src.matchAll(/useTranslations\(\s*['"]public\.([A-Za-z]+)/g)) out.add(m[1])
  for (const m of src.matchAll(/useTranslations\(\s*['"]public['"]\s*\)\s*\.raw\(\s*['"]([A-Za-z]+)/g)) out.add(m[1])
  for (const v of src.matchAll(/const\s+(\w+)\s*=\s*useTranslations\(\s*['"]public['"]\s*\)\s*(?:$|[;\n])/gm)) {
    for (const m of src.matchAll(new RegExp(`\\b${v[1]}(?:\\.raw)?\\(\\s*['"]([A-Za-z]+)`, 'g'))) out.add(m[1])
  }
  return [...out]
}

function readAll(files: Iterable<string>): string[] {
  return [...new Set([...files].flatMap(f => sectionsRead(readFileSync(f, 'utf8'))))].sort()
}

const PAGES = ['page.tsx', 'about/page.tsx', 'ai/page.tsx', 'contact/page.tsx', 'features/page.tsx',
  'pricing/page.tsx', 'privacy/page.tsx', 'security/page.tsx', 'terms/page.tsx']

describe('each marketing page sends every public section it reads', () => {
  for (const page of PAGES) {
    it(page, () => {
      const file = join(SRC, 'app', page)
      const src = readFileSync(file, 'utf8')
      const m = /<MarketingPage\s+sections=\{\[([^\]]*)\]\}/.exec(src)
      expect(m, 'page passes sections to MarketingPage').not.toBeNull()
      const sent = ['shell', ...m![1].split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean)]
      const read = readAll(closure(file))
      expect(read.length).toBeGreaterThan(0)
      expect(read.filter(s => !sent.includes(s))).toEqual([])
    })
  }

  it('demo: the layout sends shell + demo, and the tour reads nothing else', () => {
    const layout = readFileSync(join(SRC, 'app/demo/layout.tsx'), 'utf8')
    expect(layout).toContain("only={{ public: ['shell', 'demo'] }}")
    const files = new Set<string>()
    const walk = (d: string) => readdirSync(d).forEach(n => {
      const p = join(d, n)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.tsx?$/.test(n)) closure(p, files)
    })
    walk(join(SRC, 'app/demo'))
    expect(readAll(files).filter(s => !['shell', 'demo'].includes(s))).toEqual([])
  })
})

describe('clientMessages section picking', () => {
  it('sends only the named sections of a namespace', () => {
    const m = clientMessages('ar', ['common', 'public'], { public: ['shell', 'landing'] })
    expect(Object.keys(m.public as object).sort()).toEqual(['landing', 'shell'])
    expect(m.common).toEqual(clientMessages('ar', ['common']).common)
  })

  it('without a pick, the whole namespace is sent (unchanged behaviour)', () => {
    const all = clientMessages('en', ['public']).public as object
    expect(Object.keys(all)).toContain('featuresPage')
  })

  it('refuses a section that does not exist', () => {
    expect(() => clientMessages('en', ['public'], { public: ['nope'] })).toThrow(/Unknown section "public.nope"/)
  })
})
