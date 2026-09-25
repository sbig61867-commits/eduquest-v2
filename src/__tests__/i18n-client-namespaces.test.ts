import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// A client component can only read the namespaces its nearest
// <ScopedIntlProvider> serialized. When one is missing, next-intl renders the
// raw key ("staff.invitations.title") instead of failing — which is how the
// teacher invitations page shipped untranslated. This walks every page's
// import graph and checks each client `useTranslations('ns…')` against the
// namespaces its route-group layout and the page itself provide.

const SRC = path.resolve(__dirname, '..')
const APP = path.join(SRC, 'app')

function providedIn(file: string): string[] {
  const src = fs.readFileSync(file, 'utf8')
  const out: string[] = []
  for (const m of src.matchAll(/ScopedIntlProvider\s+namespaces=\{\[([^\]]*)\]\}/g)) {
    for (const ns of m[1].matchAll(/'([A-Za-z]+)'/g)) out.push(ns[1])
  }
  return out
}

function resolveImport(from: string, spec: string): string | null {
  let base: string
  if (spec.startsWith('@/')) base = path.join(SRC, spec.slice(2))
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec)
  else return null
  for (const ext of ['', '.tsx', '.ts', '/index.tsx', '/index.ts']) {
    const p = base + ext
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p
  }
  return null
}

function pagesUnder(dir: string, out: string[] = []): string[] {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f)
    if (fs.statSync(p).isDirectory()) pagesUnder(p, out)
    else if (f === 'page.tsx') out.push(p)
  }
  return out
}

/** Namespaces read by client components reachable from `entry`. */
function clientNamespaces(entry: string): Map<string, string> {
  const found = new Map<string, string>()
  const seen = new Set<string>()
  const stack = [entry]
  while (stack.length) {
    const file = stack.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    const src = fs.readFileSync(file, 'utf8')
    if (/^\s*['"]use client['"]/.test(src)) {
      for (const m of src.matchAll(/useTranslations\(\s*['"]([A-Za-z]+)/g)) {
        if (!found.has(m[1])) found.set(m[1], path.relative(SRC, file))
      }
    }
    for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const next = resolveImport(file, m[1])
      if (next && !next.includes(`${path.sep}messages${path.sep}`)) stack.push(next)
    }
  }
  return found
}

const groups = fs.readdirSync(APP).filter(d => /^\(.+\)$/.test(d) && fs.existsSync(path.join(APP, d, 'layout.tsx')))

describe('every client translation namespace reaches its page', () => {
  it('finds the route groups', () => {
    expect(groups.length).toBeGreaterThanOrEqual(5)
  })

  for (const group of groups) {
    const layoutNs = providedIn(path.join(APP, group, 'layout.tsx'))
    // Groups without their own provider inherit the root layout's.
    const inherited = layoutNs.length ? layoutNs : providedIn(path.join(APP, 'layout.tsx'))

    for (const page of pagesUnder(path.join(APP, group))) {
      const rel = path.relative(APP, page)
      it(rel, () => {
        const provided = new Set([...inherited, ...providedIn(page)])
        const missing = [...clientNamespaces(page)]
          .filter(([ns]) => !provided.has(ns))
          .map(([ns, file]) => `${ns} (used by ${file})`)
        expect(missing).toEqual([])
      })
    }
  }
})
