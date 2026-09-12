import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rate-limit'
import { safeFetch, BlockedUrlError } from '@/lib/safe-fetch'

// Fetches Open Graph / meta tags from an external URL so the announcement
// form can auto-fill title, description, and image — no paid API needed.
//
// This route makes the SERVER fetch a URL the caller typed, which is an SSRF
// primitive whose response is handed back to the caller. Requiring a session
// bounds who can trigger it but does not make it safe: every signed-in user,
// students included, could otherwise reach the loopback interface, the cloud
// metadata endpoint, and the private network the database sits on. The URL is
// therefore validated and every redirect hop re-validated in lib/safe-fetch,
// and the route is rate limited so it cannot be used as a scanner.

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
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { url?: string }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const raw = String(body.url ?? '').trim()
  if (!raw) return NextResponse.json({ error: 'url مطلوب' }, { status: 400 })

  // Without a limit, one account turns this into an internal port scanner.
  const rl = await rateLimit(`preview-url:${user.id}`, { limit: 20, windowSecs: 600 })
  if (!rl.allowed) {
    return NextResponse.json({ error: 'محاولات كثيرة، حاول بعد قليل' }, { status: 429 })
  }

  try {
    const res = await safeFetch(raw, {
      timeoutMs: 6000,
      maxRedirects: 3,
      headers: { 'User-Agent': 'EduQuest/1.0 (link preview)', Accept: 'text/html' },
    })
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
    // A blocked URL is the caller's mistake (or probe) — say so plainly and
    // never echo the underlying network error, which would leak whether an
    // internal host exists.
    if (e instanceof BlockedUrlError) {
      return NextResponse.json({ error: e.message }, { status: 400 })
    }
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: `تعذّر جلب الرابط: ${msg}` }, { status: 422 })
  }
}
