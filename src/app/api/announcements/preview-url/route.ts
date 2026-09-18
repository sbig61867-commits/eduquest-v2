import { NextResponse } from 'next/server'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
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
// pin the request to a public unicast address.

// Private / loopback / link-local / CGNAT ranges, plus the cloud metadata
// endpoint at 169.254.169.254 that link-local already covers. Reaching any of
// these from the server is never a legitimate link preview.
function isBlockedAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v6 = ip.toLowerCase()
    if (v6 === '::' || v6 === '::1') return true
    if (v6.startsWith('fe80') || v6.startsWith('fc') || v6.startsWith('fd')) return true
    // IPv4-mapped (::ffff:10.0.0.1) — re-check the embedded v4 address.
    const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isBlockedAddress(mapped[1])
    return false
  }
  const p = ip.split('.').map(Number)
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true
  const [a, b] = p
  return (
    a === 0 || a === 10 || a === 127 ||                 // this-network, private, loopback
    (a === 100 && b >= 64 && b <= 127) ||               // CGNAT 100.64/10
    (a === 169 && b === 254) ||                         // link-local + cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||                // private 172.16/12
    (a === 192 && b === 168) ||                         // private 192.168/16
    (a === 192 && b === 0) ||                           // IETF protocol assignments
    (a === 198 && (b === 18 || b === 19)) ||            // benchmarking
    a >= 224                                            // multicast + reserved
  )
}

/** Resolve the host and reject unless every answer is a public unicast address. */
async function assertPublicHost(hostname: string): Promise<string | null> {
  if (isIP(hostname)) {
    return isBlockedAddress(hostname) ? 'الرابط يشير إلى عنوان داخلي غير مسموح' : null
  }
  let addrs: { address: string }[]
  try {
    addrs = await lookup(hostname, { all: true })
  } catch {
    return 'تعذّر التعرف على اسم النطاق'
  }
  if (addrs.length === 0) return 'تعذّر التعرف على اسم النطاق'
  if (addrs.some(a => isBlockedAddress(a.address))) {
    return 'الرابط يشير إلى عنوان داخلي غير مسموح'
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
  if (!user) return NextResponse.json({ error: 'غير مصرّح' }, { status: 401 })

  // Only announcement authors get to make the server fetch a URL. Previously
  // any signed-in account — a student's included — could drive this.
  const { data: profile } = await supabase
    .from('users').select('role, tenant_id, permissions').eq('id', user.id).single()
  if (!profile?.tenant_id || !can(profile.role, profile.permissions, 'manage_announcements')) {
    return NextResponse.json({ error: 'ممنوع' }, { status: 403 })
  }

  const rl = await rateLimit(`preview-url:${user.id}`, { limit: 30, windowSecs: 3600 })
  if (!rl.allowed) {
    return NextResponse.json({ error: 'تجاوزت الحد المسموح، حاول لاحقاً' }, { status: 429 })
  }

  let body: { url?: string }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 }) }

  const raw = String(body.url ?? '').trim()
  if (!raw) return NextResponse.json({ error: 'url مطلوب' }, { status: 400 })

  let url: URL
  try { url = new URL(raw) } catch { return NextResponse.json({ error: 'رابط غير صالح' }, { status: 400 }) }
  if (!['http:', 'https:'].includes(url.protocol)) {
    return NextResponse.json({ error: 'يجب أن يبدأ الرابط بـ https://' }, { status: 400 })
  }

  const blocked = await assertPublicHost(url.hostname)
  if (blocked) return NextResponse.json({ error: blocked }, { status: 400 })

  try {
    // redirect: 'manual' matters — following redirects would let a public host
    // bounce us to 169.254.169.254 and defeat the check above.
    const res = await fetch(url.toString(), {
      headers: { 'User-Agent': 'EduQuest/1.0 (link preview)', Accept: 'text/html' },
      signal: AbortSignal.timeout(6000),
      redirect: 'manual',
    })
    if (res.status >= 300 && res.status < 400) {
      return NextResponse.json({ error: 'الرابط يعيد التوجيه، استخدم الرابط النهائي مباشرة' }, { status: 422 })
    }
    if (!res.ok) return NextResponse.json({ error: `الموقع أعاد ${res.status}` }, { status: 422 })
    const ct = res.headers.get('content-type') ?? ''
    if (!ct.includes('text/html')) return NextResponse.json({ error: 'الرابط لا يشير إلى صفحة HTML' }, { status: 422 })
    // Read at most 64 KB — enough to capture OG tags in the <head>
    const reader = res.body?.getReader()
    if (!reader) return NextResponse.json({ error: 'لا يمكن قراءة المحتوى' }, { status: 422 })
    const chunks: Uint8Array[] = []
    let total = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done || !value) break
      chunks.push(value)
      total += value.length
      if (total > 65536) break
    }
    const html = new TextDecoder().decode(Buffer.concat(chunks))
    const meta = extractMeta(html)
    return NextResponse.json(meta)
  } catch (e) {
    // Do not echo the fetch error back: its text ("ECONNREFUSED 10.0.0.5:22")
    // turns this endpoint into a blind SSRF oracle for mapping the internal
    // network. Log it server-side, return a fixed message.
    console.error('[announcements/preview-url]', e)
    return NextResponse.json({ error: 'تعذّر جلب الرابط' }, { status: 422 })
  }
}
