import { NextResponse, type NextRequest } from 'next/server'
import { readSession } from '@/lib/auth/proxy-session'
import { loadCtx, type SessionCtx } from '@/lib/auth/session'
import { run, maybeOne } from '@/lib/db/sql'
import { LOCALE_COOKIE, LOCALE_COOKIE_OPTIONS } from '@/i18n/config'
import { resolveLocale } from '@/i18n/resolve'
import { LOCALE_HEADER, isMarketingPath, splitLocalizedPath } from '@/i18n/public-routes'
import type { Locale } from '@/i18n/config'
import type { Role } from '@/types'

// Exact matches — only these exact paths are public
const PUBLIC_EXACT = new Set(['/', '/login', '/privacy', '/terms', '/features', '/about', '/security', '/ai', '/features/live-monitoring', '/features/ai-assistant', '/contact', '/cookies', '/pricing', '/forgot-password', '/reset-password', '/robots.txt', '/sitemap.xml'])

// Prefix matches — these paths AND all their sub-paths are public.
// /api/auth/accept-invitation MUST be public: the joining user has no session
// yet (they're creating their account), so gating it would 307-redirect the
// POST to /login and the client would see a non-JSON body as "Registration failed".
// /auth/signout is public so an already-expired session can still clear its cookies.
// /models/ holds the on-device proctoring models (static files copied by
// scripts/copy-human-models.mjs); the proxy matcher only skips images.
// /api/proctor/evidence/cleanup has no user session (a scheduled job calls it)
// and is gated by CRON_SECRET inside the route instead.
const PUBLIC_PREFIXES = ['/auth/callback', '/auth/signout', '/join/', '/api/auth/accept-invitation', '/api/auth/sign-in', '/api/contact', '/api/auth/forgot-password', '/api/auth/reset-password', '/api/auth/login-id', '/api/proctor/evidence/cleanup', '/api/cron/', '/api/proctor/second-camera/event', '/cam/', '/models/', '/demo-', '/demo']

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

const CHANGE_PASSWORD_PATH = '/change-password'

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

// Identity (role, is_active, institution, must_change_password) comes from
// tm_ctx, a token we sign and refresh every 15 minutes (src/lib/auth). Reading
// it costs no network call and no query on a normal request.

/**
 * Establish the `eq_locale` cookie — once, not per request.
 *
 * The locale chain (user → tenant → platform) lives in the database, but
 * reading it on every navigation would undo the no-query fast path. So the
 * chain is collapsed exactly once, on the first authenticated request that
 * arrives without the cookie (right after login, or after the user clears it),
 * and every request afterwards reads the cookie alone — zero queries.
 *
 * The cookie is written even when the query fails or returns nothing: that
 * caps the cost of the exceptional path at one query per session, and the
 * fallback is the platform default, which would have been rendered anyway.
 *
 * Not in tm_ctx: locale is a display preference with no authorization value,
 * and a cookie makes a language switch immediate.
 */
async function ensureLocaleCookie(
  request: NextRequest,
  response: NextResponse,
  userId: string
): Promise<void> {
  if (request.cookies.get(LOCALE_COOKIE)) return

  let user: unknown
  let tenant: unknown
  try {
    const [rows] = await run({ as: 'user', userId }, sql => [
      sql`select u.locale, t.default_locale from public.users u left join public.tenants t on t.id = u.tenant_id where u.id = ${userId}`,
    ])
    const row = maybeOne<{ locale?: unknown; default_locale?: unknown }>(rows)
    user = row?.locale
    tenant = row?.default_locale
  } catch {
    // A transient database error. Fall through to default.
  }

  response.cookies.set(LOCALE_COOKIE, resolveLocale({ user, tenant }), LOCALE_COOKIE_OPTIONS)
}

/**
 * Serve `/<locale><path>` (a marketing page in a named language) from the
 * existing `<path>` route: rewrite, hand the locale to the renderer on
 * LOCALE_HEADER, and carry over any session cookies updateSession() refreshed.
 *
 * With `rememberLocale`, the visitor's `eq_locale` cookie is set to match
 * (only when it differs), so the language they picked by URL follows them to
 * /login and into the app. Signed-out marketing pages pass false: a response
 * that sets a cookie is never edge-cached, and a first visit has no cookie yet,
 * so setting it here would make every new visitor miss the cache. PublicNav
 * writes the same cookie in the browser instead.
 */
function rewriteLocalized(
  request: NextRequest,
  sessionResponse: NextResponse,
  locale: Locale,
  path: string,
  rememberLocale = true,
) {
  const url = request.nextUrl.clone()
  url.pathname = path
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set(LOCALE_HEADER, locale)
  const response = NextResponse.rewrite(url, { request: { headers: requestHeaders } })
  for (const cookie of sessionResponse.cookies.getAll()) response.cookies.set(cookie)
  if (rememberLocale && request.cookies.get(LOCALE_COOKIE)?.value !== locale) {
    response.cookies.set(LOCALE_COOKIE, locale, LOCALE_COOKIE_OPTIONS)
  }
  return response
}

/**
 * Edge caching for public marketing pages. `/ar/…` and `/en/…` render the
 * same HTML for every signed-out visitor (the language comes from the URL, the
 * theme is applied in the browser — src/lib/theme.ts), so Vercel's CDN may
 * keep a copy for a few minutes and answer from the edge nearest the visitor
 * instead of rendering again. Only the CDN caches it (browsers still
 * revalidate), a deploy purges it, and anything personal is excluded: signed-
 * in users, responses that set cookies, and anything but a full page load.
 */
const EDGE_CACHE = 'public, max-age=300, stale-while-revalidate=86400'

function withEdgeCache(request: NextRequest, response: NextResponse, signedIn: boolean): NextResponse {
  const cacheable =
    request.method === 'GET'
    && !signedIn
    // Full document loads only. Next.js strips the RSC/prefetch headers before
    // the proxy sees them, so the Accept header is what tells a page load
    // (text/html) from an RSC navigation or prefetch (never cached here).
    && (request.headers.get('accept') ?? '').includes('text/html')
    && !request.nextUrl.searchParams.has('_rsc')
    && response.cookies.getAll().length === 0
  if (cacheable) {
    response.headers.set('Vercel-CDN-Cache-Control', EDGE_CACHE)
    response.headers.set('CDN-Cache-Control', EDGE_CACHE)
  }
  return response
}

export async function proxy(request: NextRequest) {
  const { response: sessionResponse, ctx: user } = await readSession(request)
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
      const role = user.role as Role | null
      // Don't redirect disabled users — they stay on /login to see the error message
      if (!user.is_active) {
        return localized ? rewriteLocalized(request, sessionResponse, localized.locale, localized.path) : sessionResponse
      }
      if (user.must_change_password) {
        return NextResponse.redirect(new URL(CHANGE_PASSWORD_PATH, request.url))
      }
      if (role && ROLE_DASHBOARDS[role]) {
        return NextResponse.redirect(new URL(ROLE_DASHBOARDS[role], request.url))
      }
    }
    if (localized) {
      const marketing = isMarketingPath(localized.path)
      const rewritten = rewriteLocalized(request, sessionResponse, localized.locale, localized.path, !!user || !marketing)
      return marketing ? withEdgeCache(request, rewritten, !!user) : rewritten
    }
    return sessionResponse
  }

  // ── Protected routes — must be logged in ──
  if (!user) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  const role = user.role as Role | null
  const tenantId = user.tenant_id

  if (!user.is_active) {
    return NextResponse.redirect(new URL('/login?error=account_disabled', request.url))
  }

  // `is_active` above came from tm_ctx, which is up to 15 minutes old. Reads
  // are safe anyway (the database denies a deactivated account on every query),
  // but routes authorize with the session and then write as app_service, so a
  // suspended account must be stopped before a write, not 15 minutes later.
  // Re-read the live flag for WRITES only; reads keep the no-query fast path.
  if (isMutatingApiRequest(request, pathname)) {
    const live: SessionCtx | null = await loadCtx(user.sub).catch(() => null)
    // Fail closed on an explicit false; a missing row or query error leaves
    // the session verdict standing rather than locking everyone out on a blip.
    if (live && !live.is_active) {
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

  // A temporary password set by staff must be replaced before anything else.
  // The flag rides in tm_ctx and costs no query; /api/auth/change-password
  // clears it and issues a fresh tm_ctx.
  if (user.must_change_password && pathname !== CHANGE_PASSWORD_PATH && pathname !== '/api/auth/change-password') {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Password change required' }, { status: 403 })
    }
    return NextResponse.redirect(new URL(CHANGE_PASSWORD_PATH, request.url))
  }
  if (pathname === CHANGE_PASSWORD_PATH) return sessionResponse

  // RBAC check
  for (const [routePrefix, allowedRoles] of Object.entries(ROLE_ROUTES)) {
    if (pathname.startsWith(routePrefix) && !allowedRoles.includes(role)) {
      return NextResponse.redirect(new URL('/login?error=unauthorized', request.url))
    }
  }

  // Last thing before the response leaves: no-op on every request that already
  // carries the cookie, which is all of them after the first.
  await ensureLocaleCookie(request, sessionResponse, user.sub)

  return sessionResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
