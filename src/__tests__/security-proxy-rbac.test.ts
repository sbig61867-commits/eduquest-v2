/**
 * Security — the routing gate (`src/proxy.ts`).
 *
 * The proxy is the ONLY place login, account status, tenant presence and
 * role-to-route mapping are enforced for page navigations. A gap here is not
 * a bug in one page, it is an open door to a whole role's area, so these
 * tests drive the real `proxy()` with a mocked session layer and assert the
 * decision (allow / redirect and where) for every role against every route
 * group — the full cross-product, not a handful of samples.
 *
 * Threat model covered here:
 *  P1  Anonymous access to any protected area redirects to /login.
 *  P2  Cross-role access is denied for every (role, area) pair that is not
 *      the role's own — this is the tenant-independent half of isolation.
 *  P3  A disabled account cannot reach anything, even with a valid session.
 *  P4  A non-owner with no tenant_id cannot reach anything (their university
 *      was deleted) — the check that keeps orphaned rows out of the app.
 *  P5  The public allowlist is exactly what it claims to be: no protected
 *      path can be reached by prefix-matching a public one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Role } from '@/types'

// ── Mock the session layer ────────────────────────────────────────────────
// `proxy()` calls updateSession() for the JWT claims. We control exactly what
// claims come back, plus a `from().select().eq().single()` chain for the
// legacy DB-fallback path (users whose claims were never backfilled).
const sessionState: {
  claims: { sub: string; app_metadata?: Record<string, unknown> } | null
  dbProfile: { role?: string; is_active?: boolean; tenant_id?: string | null } | null
} = { claims: null, dbProfile: null }

vi.mock('@/lib/supabase/middleware', () => ({
  updateSession: async (request: unknown) => {
    const { NextResponse } = await import('next/server')
    return {
      supabaseResponse: NextResponse.next({ request: request as Request }),
      claims: sessionState.claims,
      supabase: {
        from: () => ({
          select: () => ({
            eq: () => ({ single: async () => ({ data: sessionState.dbProfile }) }),
          }),
        }),
      },
    }
  },
}))

const BASE = 'https://eduquest.test'

async function visit(pathname: string): Promise<{ status: number; location: string | null }> {
  const { NextRequest } = await import('next/server')
  const { proxy } = await import('@/proxy')
  const res = await proxy(new NextRequest(new URL(pathname, BASE)))
  return { status: res.status, location: res.headers.get('location') }
}

/** Sign in as `role`; `tenantId` null models a deleted university. */
function signIn(role: Role | undefined, opts: { active?: boolean; tenantId?: string | null } = {}) {
  sessionState.claims = {
    sub: 'user-1',
    app_metadata: {
      user_role: role,
      is_active: opts.active ?? true,
      tenant_id: opts.tenantId === undefined ? 'tenant-1' : opts.tenantId,
    },
  }
  sessionState.dbProfile = null
}

function signOut() {
  sessionState.claims = null
  sessionState.dbProfile = null
}

/** Each role's own area, and a representative deep page inside it. */
const AREAS: Record<Role, { prefix: string; page: string; dashboard: string }> = {
  super_admin:      { prefix: '/super-admin', page: '/super-admin/tenants',      dashboard: '/super-admin/dashboard' },
  university_admin: { prefix: '/admin',       page: '/admin/students',           dashboard: '/admin/dashboard' },
  center_manager:   { prefix: '/center',      page: '/center/announcements',     dashboard: '/center/dashboard' },
  teacher:          { prefix: '/teacher',     page: '/teacher/exams',            dashboard: '/teacher/dashboard' },
  student:          { prefix: '/student',     page: '/student/grades',           dashboard: '/student/dashboard' },
}

const ALL_ROLES = Object.keys(AREAS) as Role[]

const isRedirectTo = (r: { status: number; location: string | null }, path: string) =>
  r.status >= 300 && r.status < 400 && (r.location ?? '').includes(path)

beforeEach(() => {
  vi.resetModules()
  signOut()
})

describe('P1 — anonymous users reach nothing protected', () => {
  it('redirects an anonymous visitor from every role area to /login', async () => {
    for (const role of ALL_ROLES) {
      for (const path of [AREAS[role].prefix, AREAS[role].page, AREAS[role].dashboard]) {
        expect(isRedirectTo(await visit(path), '/login'), `anon → ${path}`).toBe(true)
      }
    }
  })

  it('redirects an anonymous visitor from a non-public API route', async () => {
    expect(isRedirectTo(await visit('/api/admin/create-user'), '/login')).toBe(true)
    expect(isRedirectTo(await visit('/api/exam/submit'), '/login')).toBe(true)
  })

  it('lets an anonymous visitor through to the public pages', async () => {
    for (const path of ['/', '/login', '/pricing', '/features', '/privacy', '/terms', '/contact']) {
      expect((await visit(path)).status, `anon → ${path}`).toBe(200)
    }
  })
})

describe('P2 — cross-role access is denied for every pair', () => {
  it('allows each role only into its own area and denies all four others', async () => {
    for (const actor of ALL_ROLES) {
      for (const target of ALL_ROLES) {
        signIn(actor)
        const res = await visit(AREAS[target].page)
        if (actor === target) {
          expect(res.status, `${actor} → own ${AREAS[target].page}`).toBe(200)
        } else {
          expect(
            isRedirectTo(res, '/login?error=unauthorized'),
            `${actor} must NOT reach ${AREAS[target].page}`,
          ).toBe(true)
        }
      }
    }
  })

  it('denies a student the admin and super-admin areas specifically', async () => {
    signIn('student')
    expect(isRedirectTo(await visit('/admin/students'), 'unauthorized')).toBe(true)
    expect(isRedirectTo(await visit('/super-admin/tenants'), 'unauthorized')).toBe(true)
    expect(isRedirectTo(await visit('/teacher/exams'), 'unauthorized')).toBe(true)
  })

  it('denies a teacher the centre-manager and admin areas', async () => {
    signIn('teacher')
    expect(isRedirectTo(await visit('/center/dashboard'), 'unauthorized')).toBe(true)
    expect(isRedirectTo(await visit('/admin/dashboard'), 'unauthorized')).toBe(true)
  })

  it('does not let a centre manager inherit the university_admin area', async () => {
    // These two roles are adjacent in the product and easy to conflate in
    // code; the gate must keep them apart.
    signIn('center_manager')
    expect(isRedirectTo(await visit('/admin/students'), 'unauthorized')).toBe(true)
    expect((await visit('/center/dashboard')).status).toBe(200)
  })
})

describe('P3 — a disabled account is locked out everywhere', () => {
  it('redirects a disabled user out of every area with account_disabled', async () => {
    for (const role of ALL_ROLES) {
      signIn(role, { active: false })
      const res = await visit(AREAS[role].page)
      expect(isRedirectTo(res, 'account_disabled'), `disabled ${role}`).toBe(true)
    }
  })

  it('leaves a disabled user on /login instead of bouncing them to a dashboard', async () => {
    signIn('teacher', { active: false })
    expect((await visit('/login')).status).toBe(200)
  })
})

describe('P4 — a user with no tenant cannot enter the app', () => {
  it('redirects every non-owner role with a null tenant to university_removed', async () => {
    for (const role of ALL_ROLES.filter(r => r !== 'super_admin')) {
      signIn(role, { tenantId: null })
      expect(isRedirectTo(await visit(AREAS[role].page), 'university_removed'), role).toBe(true)
    }
  })

  it('still admits the owner, who is cross-tenant by design', async () => {
    signIn('super_admin', { tenantId: null })
    expect((await visit('/super-admin/tenants')).status).toBe(200)
  })
})

describe('P5 — the public allowlist cannot be widened by prefix matching', () => {
  it('does not treat a protected path that merely starts like a public one as public', async () => {
    // '/login' is public by EXACT match; these must not inherit that.
    for (const path of ['/loginx', '/login/admin', '/pricing-internal', '/terms-of-god-mode']) {
      expect(isRedirectTo(await visit(path), '/login'), `${path} must be gated`).toBe(true)
    }
  })

  it('keeps the invitation-acceptance API public — the joiner has no session yet', async () => {
    expect((await visit('/api/auth/accept-invitation')).status).toBe(200)
    expect((await visit('/join/some-token')).status).toBe(200)
  })

  it('does not make the whole admin API public via the public /api prefixes', async () => {
    for (const path of ['/api/admin/toggle-user', '/api/admin/delete-tenant', '/api/invitations']) {
      expect(isRedirectTo(await visit(path), '/login'), `${path} must be gated`).toBe(true)
    }
  })

  it('sends a signed-in user from / and /login to their own dashboard, not another role\'s', async () => {
    for (const role of ALL_ROLES) {
      signIn(role)
      expect(isRedirectTo(await visit('/login'), AREAS[role].dashboard), role).toBe(true)
    }
  })
})

describe('P6 — a session with no usable role is rejected, not defaulted', () => {
  it('redirects a user whose claims and DB row both lack a role', async () => {
    sessionState.claims = { sub: 'user-1', app_metadata: { is_active: true, tenant_id: 't1' } }
    sessionState.dbProfile = { role: undefined, is_active: true, tenant_id: 't1' }
    expect(isRedirectTo(await visit('/admin/students'), '/login')).toBe(true)
  })

  it('does not let an unrecognised role string match any area', async () => {
    sessionState.claims = {
      sub: 'user-1',
      app_metadata: { user_role: 'root', is_active: true, tenant_id: 't1' },
    }
    for (const role of ALL_ROLES) {
      expect(isRedirectTo(await visit(AREAS[role].page), 'unauthorized'), role).toBe(true)
    }
  })
})
