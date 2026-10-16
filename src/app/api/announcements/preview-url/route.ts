import { apiErr, type ApiErrorCode } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { BlockedAddressError, fetchPublic, isBlockedAddress } from '@/lib/public-fetch'
import { createClient } from '@/lib/supabase/server'
import { can } from '@/lib/permissions'
import { rateLimit } from '@/lib/rate-limit'

// Fetches Open Graph / meta tags from an external URL so the announcement
// form can auto-fill title, description, and image — no paid API needed.
//
// This endpoint makes the SERVER issue an arbitrary outbound request, so it is
// a server-side request forgery (SSRF) primitive and is guarded accordingly.
// Requiring a session is NOT sufficient on its own — any student account is a
// session — so on top of auth we require the `manage_announcements` capability
// (the only people who have a reason to preview a link), rate-limit it, and
// pin the request to a public unicast address. The authoritative check runs
// at connect time inside fetchPublic (src/lib/public-fetch.ts), so a DNS answer
// that changes between this pre-check and the connection cannot slip through.

/** Resolve the host and reject unless every answer is a public unicast address. */
async function assertPublicHost(rawHostname: string): Promise<ApiErrorCode | null> {
  // URL keeps IPv6 literals in brackets ([::1]); isIP() wants them bare.
  const hostname = rawHostname.replace(/^\[|\]$/g, '')
  if (isIP(hostname)) {
    return isBlockedAddress(hostname) ? 'internalAddressBlocked' : null
  }
  let addrs: { address: string }[]
  try {
    addrs = await lookup(hostname, { all: true })
  } catch {
    return 'unresolvableHost'
  }
  if (addrs.length === 0) return 'unresolvableHost'
  if (addrs.some(a => isBlockedAddress(a.address))) {
    return 'internalAddressBlocked'
  }
  return null
}

function extractMeta(html: string) {
  const og = (prop: string) => {
    const m = html.match(new RegExp(`<meta[^>]+property=["']og:${prop}["'][^>]+content=["']([^"']+)["']`, 'i'))
      ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:${prop}["']`, 'i'))
    return m?.[1]?.trim() ?? null
  }
  const meta = (name: string) => {
    const m = html.match(new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i'))
      ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${name}["']`, 'i'))
    return m?.[1]?.trim() ?? null
  }
  const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? null

  return {
    title: og('title') ?? meta('title') ?? titleTag,
    description: og('description') ?? meta('description'),
    image: og('image'),
  }
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })

  // Only announcement authors get to make the server fetch a URL. Previously
  // any signed-in account — a student's included — could drive this.
  const { data: profile } = await supabase
    .from('users').select('role, tenant_id, permissions').eq('id', user.id).single()
  if (!profile?.tenant_id || !can(profile.role, profile.permissions, 'manage_announcements')) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }

  const rl = await rateLimit(`preview-url:${user.id}`, { limit: 30, windowSecs: 3600 })
  if (!rl.allowed) {
    return NextResponse.json({ ...(await apiErr('rateLimited')) }, { status: 429 })
  }

  let body: { url?: string }
  try { body = await request.json() } catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const raw = String(body.url ?? '').trim()
  if (!raw) return NextResponse.json({ ...(await apiErr('urlRequired')) }, { status: 400 })

  let url: URL
  try { url = new URL(raw) } catch { return NextResponse.json({ ...(await apiErr('invalidUrl')) }, { status: 400 }) }
  if (!['http:', 'https:'].includes(url.protocol)) {
    return NextResponse.json({ ...(await apiErr('urlHttpsRequired')) }, { status: 400 })
  }

  const blocked = await assertPublicHost(url.hostname)
  if (blocked) return NextResponse.json({ ...(await apiErr(blocked)) }, { status: 400 })

  try {
    // node:http never follows redirects, and a 3xx is refused below: following
    // one would let a public host bounce us to 169.254.169.254.
    const res = await fetchPublic(url, {
      headers: { 'User-Agent': 'EduQuest/1.0 (link preview)', Accept: 'text/html' },
      timeoutMs: 6000,
      maxBytes: 65536, // enough to capture OG tags in the <head>
    })
    if (res.status >= 300 && res.status < 400) {
      return NextResponse.json({ ...(await apiErr('urlRedirects')) }, { status: 422 })
    }
    if (res.status < 200 || res.status >= 300) return NextResponse.json({ ...(await apiErr('siteReturned', { status: res.status })) }, { status: 422 })
    if (!res.contentType.includes('text/html')) return NextResponse.json({ ...(await apiErr('urlNotHtml')) }, { status: 422 })
    const html = new TextDecoder().decode(res.body)
    const meta = extractMeta(html)
    return NextResponse.json(meta)
  } catch (e) {
    // The connect-time guard refused an internal address (DNS rebinding).
    if (e instanceof BlockedAddressError) {
      return NextResponse.json({ ...(await apiErr('internalAddressBlocked')) }, { status: 400 })
    }
    // Do not echo the fetch error back: its text ("ECONNREFUSED 10.0.0.5:22")
    // turns this endpoint into a blind SSRF oracle for mapping the internal
    // network. Log it server-side, return a fixed message.
    console.error('[announcements/preview-url]', e)
    return NextResponse.json({ ...(await apiErr('urlFetchFailed')) }, { status: 422 })
  }
}
