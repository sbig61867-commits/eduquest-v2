import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'
import { LOCALE_COOKIE, LOCALE_COOKIE_OPTIONS } from '@/i18n/config'
import { resolveLocale } from '@/i18n/resolve'
import { LOCALE_HEADER, splitLocalizedPath } from '@/i18n/public-routes'
import type { Locale } from '@/i18n/config'
import type { Role } from '@/types'

// Exact matches — only these exact paths are public
const PUBLIC_EXACT = new Set(['/', '/login', '/privacy', '/terms', '/features', '/features/live-monitoring', '/features/ai-assistant', '/contact', '/cookies', '/pricing', '/forgot-password', '/reset-password', '/robots.txt', '/sitemap.xml'])

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

/**
 * Establish the `eq_locale` cookie — once, not per request.
 *
 * The locale chain (user → tenant → platform) lives in the database, but
 * reading it on every navigation would undo the whole reason the proxy uses
 * getClaims() instead of getUser(): no per-request DB round-trip. So the chain
 * is collapsed exactly once, on the first authenticated request that arrives
 * without the cookie (i.e. right after login, or after the user clears it),
 * and every request afterwards reads the cookie alone — zero queries.
 *
 * The cookie is written even when the query fails or returns nothing. That is
 * deliberate: it caps the cost of the exceptional path at one query per
 * session rather than one per request, and the value it falls back to is the
 * platform default, which is what would have been rendered anyway.
 *
 * Tolerating a failed query also makes this safe to ship BEFORE
 * supabase/locale_preferences_migration.sql is applied — `users.locale` and
 * `tenants.default_locale` do not exist yet, PostgREST 400s, and the platform
 * default stands. Same pattern as src/lib/structure-mode.ts.
 *
 * Not in the JWT: locale is a display preference with no authorization value,
 * and app_metadata only re-mints on token refresh (~1h), so a language switch
 * would appear to do nothing for an hour. A cookie is both cheaper and
 * immediate.
 */
async function ensureLocaleCookie(
  request: NextRequest,
  response: NextResponse,
  supabase: Awaited<ReturnType<typeof updateSession>>['supabase'],
  userId: string
): Promise<void> {
  if (request.cookies.get(LOCALE_COOKIE)) return

  let user: unknown
  let tenant: unknown
  try {
    const { data } = await supabase
      .from('users')
      .select('locale, tenants(default_locale)')
      .eq('id', userId)
      .single()
    const row = data as { locale?: unknown; tenants?: { default_locale?: unknown } | null } | null
    user = row?.locale
    tenant = row?.tenants?.default_locale
  } catch {
    // Pre-migration, or a transient Supabase error. Fall through to default.
  }

  response.cookies.set(LOCALE_COOKIE, resolveLocale({ user, tenant }), LOCALE_COOKIE_OPTIONS)
}

/**
 * Serve `/<locale><path>` (a marketing page in a named language) from the
 * existing `<path>` route: rewrite, hand the locale to the renderer on
 * LOCALE_HEADER, and carry over any session cookies updateSession() refreshed.
 *
 * The visitor's `eq_locale` cookie is set to match, so the language they
 * picked by URL follows them to /login and into the app.
 */
function rewriteLocalized(request: NextRequest, sessionResponse: NextResponse, locale: Locale, path: string) {
  const url = request.nextUrl.clone()
  url.pathname = path
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set(LOCALE_HEADER, locale)
  const response = NextResponse.rewrite(url, { request: { headers: requestHeaders } })
  for (const cookie of sessionResponse.cookies.getAll()) response.cookies.set(cookie)
  response.cookies.set(LOCALE_COOKIE, locale, LOCALE_COOKIE_OPTIONS)
  return response
}

export async function proxy(request: NextRequest) {
  const { supabaseResponse, claims: user, supabase } = await updateSession(request)
  // `/en/pricing` is handled as `/pricing` in English; see src/i18n/public-routes.ts.
  const localized = splitLocalizedPath(request.nextUrl.pathname)
  const pathname = localized?.path ?? request.nextUrl.pathname

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
      if (isActive === false) {
        return localized ? rewriteLocalized(request, supabaseResponse, localized.locale, localized.path) : supabaseResponse
      }
      if (role && ROLE_DASHBOARDS[role]) {
        return NextResponse.redirect(new URL(ROLE_DASHBOARDS[role], request.url))
      }
    }
    if (localized) return rewriteLocalized(request, supabaseResponse, localized.locale, localized.path)
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

  // Last thing before the response leaves: no-op on every request that already
  // carries the cookie, which is all of them after the first.
  await ensureLocaleCookie(request, supabaseResponse, supabase, user.sub)

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
