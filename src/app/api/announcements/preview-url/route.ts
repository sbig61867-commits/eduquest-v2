import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Fetches Open Graph / meta tags from an external URL so the announcement
// form can auto-fill title, description, and image — no paid API needed.
// Auth is required to prevent open SSRF abuse.

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

  let url: URL
  try { url = new URL(raw) } catch { return NextResponse.json({ error: 'رابط غير صالح' }, { status: 400 }) }
  if (!['http:', 'https:'].includes(url.protocol)) {
    return NextResponse.json({ error: 'يجب أن يبدأ الرابط بـ https://' }, { status: 400 })
  }

  try {
    const res = await fetch(url.toString(), {
      headers: { 'User-Agent': 'EduQuest/1.0 (link preview)', Accept: 'text/html' },
      signal: AbortSignal.timeout(6000),
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
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: `تعذّر جلب الرابط: ${msg}` }, { status: 422 })
  }
}
