import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

// Stage 4 ratchet (shrink-only). Code outside the identity layer must not call
// the auth provider directly; it goes through @/lib/auth. The baseline is the
// number of files that still do. Moving a file lowers the number; adding a new
// direct call fails this test.
const BASELINE = 18
const ROOT = join(__dirname, '..')
const ALLOWED = ['lib/supabase', 'lib/db', 'lib/auth']
const DIRECT = /\.auth\.(getUser|getClaims|signIn|signOut|updateUser|admin|resetPasswordForEmail|exchangeCodeForSession|onAuthStateChange|getSession|refreshSession)/

function files(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) files(p, out)
    else if (/\.(ts|tsx)$/.test(f) && !/__tests__/.test(p)) out.push(p)
  }
  return out
}

describe('auth layer ratchet', () => {
  it(`files calling the auth provider directly outside the identity layer: at most ${BASELINE}`, () => {
    const direct = files(ROOT).filter(p => {
      const rel = relative(ROOT, p).split('\\').join('/')
      if (ALLOWED.some(a => rel.startsWith(a))) return false
      return DIRECT.test(readFileSync(p, 'utf8'))
    })
    expect(direct.length, direct.map(p => relative(ROOT, p)).join('\n')).toBeLessThanOrEqual(BASELINE)
  })
})
