// App-layer security checks, run against the local isolated stack — never
// production (playwright.local.config.ts). Replaces the parts of
// tests/security-auth.spec.ts that needed the live site or a real account.
//
// What is checked: the proxy (src/proxy.ts) — sign-in gate, role routing,
// deactivated accounts, the live is_active re-check on writes, forged tokens —
// plus API handlers' own role checks and the security headers.
// The decisions are read from the response itself (redirects are NOT followed),
// so no target page is rendered and the fake Supabase sees no unmocked call.
//
// What it cannot prove: RLS and cross-institution isolation. Those live in
// Postgres and are verified on the real database with forced-rollback check
// files (supabase/tests/*_check.sql).
import { test, expect, SUPABASE } from './fixtures'
import type { APIResponse, Page } from '@playwright/test'

const DASHBOARDS = ['/teacher/dashboard', '/student/dashboard', '/admin/dashboard', '/super-admin/dashboard', '/center/dashboard']

/** GET without following redirects; returns status + Location path(+query). */
async function probe(page: Page, path: string, method: 'GET' | 'POST' = 'GET'): Promise<{ status: number; location: string; res: APIResponse }> {
  const res = method === 'GET'
    ? await page.request.get(path, { maxRedirects: 0 })
    : await page.request.post(path, { maxRedirects: 0, data: {} })
  const raw = res.headers()['location'] ?? ''
  const location = raw ? (() => { const u = new URL(raw, 'http://127.0.0.1:3123'); return u.pathname + u.search })() : ''
  return { status: res.status(), location, res }
}
const isRedirect = (s: number) => s >= 300 && s < 400

test.describe('no session', () => {
  test.use({ signedInAs: null })

  for (const path of DASHBOARDS) {
    test(`${path} → /login`, async ({ page }) => {
      const r = await probe(page, path)
      expect(isRedirect(r.status), `${path} answered ${r.status}`).toBe(true)
      expect(r.location).toBe('/login')
    })
  }

  for (const [method, path] of [
    ['GET', '/api/notifications'], ['GET', '/api/admin/tenant-users?tenant_id=x'], ['POST', '/api/admin/create-user'],
    ['POST', '/api/exam/submit'], ['POST', '/api/ai/generate-lesson'], ['POST', '/api/announcements/preview-url'],
  ] as const) {
    test(`${method} ${path} never reaches the handler`, async ({ page }) => {
      const r = await probe(page, path, method)
      expect(isRedirect(r.status), `${method} ${path} answered ${r.status}`).toBe(true)
      expect(r.location).toBe('/login')
    })
  }

  test('login page renders the sign-in form', async ({ page }) => {
    await page.goto('/login')
    await expect(page.locator('input[type="password"]')).toBeVisible({ timeout: 60_000 })
    await expect(page.locator('button[type="submit"]')).toBeVisible()
  })

  test('security headers', async ({ page }) => {
    const h = (await page.request.get('/login')).headers()
    expect(h['x-frame-options']).toBe('DENY')
    expect(h['x-content-type-options']).toBe('nosniff')
    expect(h['content-security-policy']).toContain("frame-ancestors 'none'")
    expect(h['content-security-policy']).toContain("object-src 'none'")
    expect(h['strict-transport-security']).toContain('max-age=')
    expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin')
  })
})

test.describe('student', () => {
  test.use({ signedInAs: { role: 'student' } })

  for (const path of ['/teacher/dashboard', '/admin/dashboard', '/super-admin/dashboard', '/center/dashboard']) {
    test(`cannot reach ${path}`, async ({ page }) => {
      const r = await probe(page, path)
      expect(isRedirect(r.status)).toBe(true)
      expect(r.location).toBe('/login?error=unauthorized')
    })
  }

  test('owner-only APIs refuse a student (handler role check)', async ({ page }) => {
    expect((await probe(page, '/api/admin/tenant-users?tenant_id=11111111-1111-4111-8111-111111111111')).status).toBe(403)
    expect((await probe(page, '/api/admin/member-lookup?code=EQT-S12345678')).status).toBe(403)
  })

  test('signed in, /login sends the student to their own dashboard', async ({ page }) => {
    const r = await probe(page, '/login')
    expect(isRedirect(r.status)).toBe(true)
    expect(r.location).toBe('/student/dashboard')
  })
})

test.describe('teacher', () => {
  for (const path of ['/admin/dashboard', '/student/dashboard', '/super-admin/dashboard', '/center/dashboard']) {
    test(`cannot reach ${path}`, async ({ page }) => {
      const r = await probe(page, path)
      expect(isRedirect(r.status)).toBe(true)
      expect(r.location).toBe('/login?error=unauthorized')
    })
  }
})

test.describe('university_admin', () => {
  test.use({ signedInAs: { role: 'university_admin' } })
  test('cannot reach the owner panel or a teacher page', async ({ page }) => {
    for (const path of ['/super-admin/dashboard', '/teacher/dashboard']) {
      const r = await probe(page, path)
      expect(r.location, path).toBe('/login?error=unauthorized')
    }
  })
})

test.describe('deactivated account (token says inactive)', () => {
  test.use({ signedInAs: { role: 'student', is_active: false } })
  test('every protected page sends it to /login?error=account_disabled', async ({ page }) => {
    for (const path of ['/student/dashboard', '/teacher/dashboard']) {
      const r = await probe(page, path)
      expect(r.location, path).toBe('/login?error=account_disabled')
    }
  })
})

test.describe('account disabled AFTER its token was issued (stale token)', () => {
  test.use({ signedInAs: { role: 'teacher', is_active: true, live_is_active: false } })
  test('a write is refused from the live row, not the token', async ({ page }) => {
    const r = await probe(page, '/api/admin/toggle-user', 'POST')
    expect(r.status).toBe(403)
    expect(await r.res.json()).toMatchObject({ error: 'Account disabled' })
  })
})

test.describe('forged token', () => {
  test.use({ signedInAs: { role: 'student' } })
  test('a student token edited to claim super_admin is not a session', async ({ page }) => {
    const session = await (await fetch(`${SUPABASE}/__eqtest/session`)).json() as { access_token: string } & Record<string, unknown>
    const [head, body, sig] = session.access_token.split('.')
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString())
    claims.app_metadata = { ...claims.app_metadata, user_role: 'super_admin', role: 'super_admin', tenant_id: null }
    const forged = `${head}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${sig}`
    const value = 'base64-' + Buffer.from(JSON.stringify({ ...session, access_token: forged })).toString('base64url')
    await page.context().addCookies([{ name: 'sb-127-auth-token', value, url: 'http://127.0.0.1:3123', sameSite: 'Lax' }])

    const r = await probe(page, '/super-admin/dashboard')
    // Either the bad signature voids the session (/login), or the client falls
    // back to a refresh and gets the REAL claims back (student → unauthorized).
    // What must never happen: the forged super_admin claim being honoured.
    expect(isRedirect(r.status), `forged token answered ${r.status}`).toBe(true)
    expect(['/login', '/login?error=unauthorized']).toContain(r.location)
  })
})
