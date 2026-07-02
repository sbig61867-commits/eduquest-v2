import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { rateLimit } from '@/lib/rate-limit'

// Public endpoint (listed in proxy PUBLIC_PREFIXES): receives contact-form
// messages from the landing page. The sender has no session, so the insert
// uses the service-role client; reads are super_admin-only via RLS.
export async function POST(request: Request) {
  // Rate limit by IP — the form is anonymous
  const ip = (request.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim()
  const rl = await rateLimit(`contact:${ip}`, { limit: 5, windowSecs: 3600 })
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many messages. Try again later.' }, { status: 429 })
  }

  let body: { name?: string; email?: string; message?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

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

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { error } = await admin.from('contact_messages').insert({ name, email, message })
  if (error) {
    console.error('[contact]', error.message)
    return NextResponse.json({ error: 'Failed to send. Try again.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true }, { status: 201 })
}
