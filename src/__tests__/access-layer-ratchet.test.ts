import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

// Stage 3 ratchet (shrink-only). Code outside the access layer must not import
// Supabase directly; it reaches the database through @/lib/db. The baseline is
// the number of files that still import it. Migrating a file lowers the number;
// adding a new direct import fails this test.
const BASELINE = 1
const ROOT = join(__dirname, '..')
const ALLOWED = ['lib/supabase', 'lib/db']

function files(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) files(p, out)
    else if (/\.(ts|tsx)$/.test(f) && !/__tests__/.test(p)) out.push(p)
  }
  return out
}

describe('access layer ratchet', () => {
  it(`files importing @supabase directly outside the access layer: at most ${BASELINE}`, () => {
    const direct = files(ROOT).filter(p => {
      const rel = relative(ROOT, p).split('\\').join('/')
      if (ALLOWED.some(a => rel.startsWith(a))) return false
      return /from ['"]@supabase\//.test(readFileSync(p, 'utf8'))
    })
    expect(direct.length, direct.map(p => relative(ROOT, p)).join('\n')).toBeLessThanOrEqual(BASELINE)
  })
})
