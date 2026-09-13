import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'
import type { Role } from '@/types'

// Exact matches — only these exact paths are public
const PUBLIC_EXACT = new Set(['/', '/login', '/privacy', '/terms', '/features', '/features/live-monitoring', '/features/ai-assistant', '/contact', '/cookies', '/pricing', '/forgot-password', '/reset-password', '/robots.txt'])

// Prefix matches — these paths AND all their sub-paths are public.
// /api/auth/accept-invitation MUST be public: the joining user has no session
// yet (they're creating their account), so gating it would 307-redirect the
// POST to /login and the client would see a non-JSON body as "Registration failed".
const PUBLIC_PREFIXES = ['/auth/callback', '/join/', '/api/auth/accept-invitation', '/api/contact', '/api/auth/forgot-password', '/demo-', '/demo']

function isPublicRoute(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true
  return PUBLIC_PREFIXES.some(prefix => pathname.startsWith(prefix))
}

// A state-changing API call — the only requests worth spending a DB round-trip
// on to re-verify account status against the live row rather than the JWT.
const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE'])

function isMutatingApiRequest(request: NextRequest, pathname: string): boolean {
  return pathname.startsWith('/api/') && MUTATING_METHODS.has(request.method)
}

const ROLE_ROUTES: Record<string, Role[]> = {
  '/super-admin': ['super_admin'],
  '/admin': ['university_admin'],
  '/center': ['center_manager'],
  '/teacher': ['teacher'],
  '/student': ['student'],
}

const ROLE_DASHBOARDS: Record<Role, string> = {
  super_admin: '/super-admin/dashboard',
  university_admin: '/admin/dashboard',
  center_manager: '/center/dashboard',
  teacher: '/teacher/dashboard',
  student: '/student/dashboard',
}

// Identity (role + is_active) is carried in the JWT's app_metadata, synced from
// public.users by the `on_user_claims_change` trigger. getClaims() validates the
// token locally (cached JWKS — no network round-trip) and returns app_metadata,
// so the proxy gets both with NO extra network call on every request — the main
// per-navigation latency win.
// A one-time DB fallback covers legacy users whose claims were never backfilled.
type Claims = { role: Role | undefined; isActive: boolean | undefined }

function claimsFromUser(user: { app_metadata?: Record<string, unknown> }): Claims {
  const meta = user.app_metadata ?? {}
  return {
    role: meta.user_role as Role | undefined,
    isActive: typeof meta.is_active === 'boolean' ? meta.is_active : undefined,
  }
}

export async function proxy(request: NextRequest) {
  const { supabaseResponse, claims: user, supabase } = await updateSession(request)
  const pathname = request.nextUrl.pathname

  // ── Public routes ──
  if (isPublicRoute(pathname)) {
    // Logged-in users are bounced to their dashboard only from '/' and '/login'.
    // /join/ must stay accessible (super admin testing an invitation link),
    // /privacy and /terms must stay readable while logged in, and /api/ public
    // routes must never be turned into a dashboard redirect.
    if (user && (pathname === '/' || pathname === '/login')) {
      let { role, isActive } = claimsFromUser(user)
      if (!role || isActive === undefined) {
        const { data: profile } = await supabase
          .from('users').select('role, is_active').eq('id', user.sub).single()
        role     = (profile?.role as Role | undefined) ?? role
        isActive = profile?.is_active ?? isActive
      }
      // Don't redirect disabled users — they stay on /login to see the error message
      if (isActive === false) return supabaseResponse
      if (role && ROLE_DASHBOARDS[role]) {
        return NextResponse.redirect(new URL(ROLE_DASHBOARDS[role], request.url))
      }
    }
    return supabaseResponse
  }

  // ── Protected routes — must be logged in ──
  if (!user) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Read role + is_active + tenant_id from JWT claims; fall back to DB only if absent.
  let { role, isActive } = claimsFromUser(user)
  let tenantId: string | null | undefined = (user.app_metadata?.tenant_id as string | null) ?? undefined

  if (role === undefined || isActive === undefined) {
    const { data: profile } = await supabase
      .from('users').select('role, is_active, tenant_id').eq('id', user.sub).single()
    role     = (profile?.role as Role | undefined) ?? role
    isActive = profile?.is_active ?? isActive
    tenantId = profile?.tenant_id ?? tenantId
  }

  if (isActive === false) {
    return NextResponse.redirect(new URL('/login?error=account_disabled', request.url))
  }

  // `is_active` above came from the JWT, which is only re-minted when the
  // access token refreshes (~1h). So an account disabled a minute ago still
  // presents is_active: true, and every API route handler trusts the session
  // without re-reading the flag — a suspended teacher could keep creating and
  // grading for up to an hour with a stale-but-valid token. <TenantWatcher>
  // catches this in ~60s, but only for a real browser sitting on a page; a
  // script holding the token ignores it entirely.
  //
  // Re-read the live flag from the DB for WRITES only. Reads stay on the
  // pure-JWT fast path, so the per-navigation latency win that motivated
  // getClaims() is preserved — mutations are rare and already do DB work.
  if (isMutatingApiRequest(request, pathname)) {
    const { data: live } = await supabase
      .from('users').select('is_active').eq('id', user.sub).single()
    // Fail closed on an explicit false; a missing row or query error leaves
    // the JWT verdict standing rather than locking everyone out on a blip.
    if (live?.is_active === false) {
      return NextResponse.json({ error: 'Account disabled' }, { status: 403 })
    }
  }

  if (!role) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // university_admin/teacher/student without a tenant = their university was deleted
  if (role !== 'super_admin' && !tenantId) {
    return NextResponse.redirect(new URL('/login?error=university_removed', request.url))
  }

  // RBAC check
  for (const [routePrefix, allowedRoles] of Object.entries(ROLE_ROUTES)) {
    if (pathname.startsWith(routePrefix) && !allowedRoles.includes(role)) {
      return NextResponse.redirect(new URL('/login?error=unauthorized', request.url))
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
