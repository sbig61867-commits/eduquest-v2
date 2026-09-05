import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// POST /api/requests/messages — append a message to a request thread
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('users').select('role, tenant_id').eq('id', user.id).single()
  if (!profile?.tenant_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: { request_id?: string; body?: string }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { request_id, body: text } = body
  if (!request_id) return NextResponse.json({ error: 'Missing request_id' }, { status: 400 })
  if (!text?.trim()) return NextResponse.json({ error: 'الرسالة فارغة' }, { status: 400 })

  const admin = adminClient()
  const { data: req } = await admin
    .from('staff_requests').select('id, tenant_id, from_user_id, to_user_id').eq('id', request_id).single()
  if (!req || req.tenant_id !== profile.tenant_id) {
    return NextResponse.json({ error: 'الطلب غير موجود' }, { status: 404 })
  }
  const isParticipant = req.from_user_id === user.id || req.to_user_id === user.id
  if (!isParticipant && profile.role !== 'university_admin' && profile.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: created, error } = await admin
    .from('request_messages')
    .insert({ request_id, sender_id: user.id, body: text.trim() })
    .select('id, body, sender_id, created_at')
    .single()

  if (error || !created) {
    console.error('[api/requests/messages POST]', error)
    return NextResponse.json({ error: 'تعذّر إرسال الرسالة' }, { status: 500 })
  }

  // Bump the parent request so the inbox re-sorts by latest activity.
  await admin.from('staff_requests').update({ updated_at: new Date().toISOString() }).eq('id', request_id)

  return NextResponse.json(created, { status: 201 })
}
