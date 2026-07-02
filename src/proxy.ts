import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'
import type { Role } from '@/types'

// Exact matches — only these exact paths are public
const PUBLIC_EXACT = new Set(['/', '/login', '/privacy', '/terms'])

// Prefix matches — these paths AND all their sub-paths are public.
// /api/auth/accept-invitation MUST be public: the joining user has no session
// yet (they're creating their account), so gating it would 307-redirect the
// POST to /login and the client would see a non-JSON body as "Registration failed".
const PUBLIC_PREFIXES = ['/auth/callback', '/join/', '/api/auth/accept-invitation']

function isPublicRoute(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true
  return PUBLIC_PREFIXES.some(prefix => pathname.startsWith(prefix))
}

const ROLE_ROUTES: Record<string, Role[]> = {
  '/super-admin': ['super_admin'],
  '/admin': ['university_admin'],
  '/teacher': ['teacher'],
  '/student': ['student'],
}

const ROLE_DASHBOARDS: Record<Role, string> = {
  super_admin: '/super-admin/dashboard',
  university_admin: '/admin/dashboard',
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
