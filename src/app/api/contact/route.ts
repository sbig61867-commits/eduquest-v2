import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { run } from '@/lib/db/sql'
import { rateLimit } from '@/lib/rate-limit'

// Public endpoint (listed in proxy PUBLIC_PREFIXES): receives contact-form
// messages from the landing page. The sender has no session, so the insert
// runs as app_service in platform scope (contact_messages has no institution;
// app_service may insert there and read only in platform scope).
export async function POST(request: Request) {
  // Rate limit by IP — the form is anonymous
  const ip = (request.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim()
  const rl = await rateLimit(`contact:${ip}`, { limit: 5, windowSecs: 3600 })
  if (!rl.allowed) {
    return NextResponse.json({ ...(await apiErr('tooManyMessages')) }, { status: 429 })
  }

  let body: { name?: string; email?: string; message?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const name = body.name?.trim() ?? ''
  const email = body.email?.trim().toLowerCase() ?? ''
  const message = body.message?.trim() ?? ''

  if (!name || name.length > 100) {
    return NextResponse.json({ error: 'invalid_name' }, { status: 400 })
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 400 })
  }
  if (!message || message.length > 2000) {
    return NextResponse.json({ error: 'invalid_message' }, { status: 400 })
  }

  try {
    await run({ as: 'service', platform: true }, sql => [
      sql`insert into public.contact_messages (name, email, message) values (${name}, ${email}, ${message})`,
    ])
  } catch (e) {
    console.error('[contact]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('sendFailed')) }, { status: 500 })
  }

  return NextResponse.json({ ok: true }, { status: 201 })
}
