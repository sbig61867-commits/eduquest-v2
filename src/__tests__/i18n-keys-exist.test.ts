import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// next-intl renders a missing key as its raw path ("student.player.player.done")
// instead of failing. The parity test only compares ar against en, so a key
// that is missing from BOTH never fails anything — the course player shipped
// four such buttons. This resolves every literal `t('…')` call against the
// namespace of the translator it was called on and fails on a key that
// does not exist.

const SRC = path.resolve(__dirname, '..')

function loadCatalogue(): Record<string, unknown> {
  const dir = path.join(SRC, 'messages', 'en')
  const out: Record<string, unknown> = {}
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith('.json')) out[f.replace(/\.json$/, '')] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
  }
  return out
}

function exists(catalogue: Record<string, unknown>, dotted: string): boolean {
  let node: unknown = catalogue
  for (const key of dotted.split('.')) {
    if (node && typeof node === 'object' && key in (node as Record<string, unknown>)) node = (node as Record<string, unknown>)[key]
    else return false
  }
  return true
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f)
    if (fs.statSync(p).isDirectory()) {
      if (f !== '__tests__' && f !== 'messages') sourceFiles(p, out)
    } else if (/\.tsx?$/.test(f)) out.push(p)
  }
  return out
}

// `const t = useTranslations('ns')` / `const t = await getTranslations('ns')`
// (also the `{ locale, namespace: 'ns' }` form).
const DECLARATION = /const\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*(?:\{[^}]*namespace:\s*)?['"]([\w.]+)['"]/g

function missingKeys(): string[] {
  const catalogue = loadCatalogue()
  const missing: string[] = []
  for (const file of sourceFiles(SRC)) {
    const src = fs.readFileSync(file, 'utf8')
    const decls = [...src.matchAll(DECLARATION)].map(m => ({ name: m[1], ns: m[2], at: m.index ?? 0 }))
    for (const name of new Set(decls.map(d => d.name))) {
      const call = new RegExp(String.raw`\b${name}(?:\.rich|\.markup|\.raw)?\(\s*['"]([\w.]+)['"]`, 'g')
      for (const m of src.matchAll(call)) {
        const at = m.index ?? 0
        // Components in one file are sequential: the translator in scope is
        // the nearest one declared before the call.
        const decl = decls.filter(d => d.name === name && d.at < at).pop()
        if (!decl) continue
        if (!exists(catalogue, `${decl.ns}.${m[1]}`)) {
          const line = src.slice(0, at).split('\n').length
          missing.push(`${path.relative(SRC, file)}:${line}  ${decl.ns}.${m[1]}`)
        }
      }
    }
  }
  return missing
}

describe('every literal translation key exists', () => {
  it('resolves each t(…) call against its namespace', () => {
    expect(missingKeys()).toEqual([])
  })
})
