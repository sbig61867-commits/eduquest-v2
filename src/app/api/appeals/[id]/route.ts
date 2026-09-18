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

const RESOLUTIONS = new Set(['upheld', 'rejected'])

// PATCH /api/appeals/[id] — the exam's teacher (or an admin in the same
// tenant) resolves an appeal. Body: { status: 'upheld' | 'rejected', response }
// 'upheld' means the teacher agrees the violation was wrong; the caller is
// responsible for separately correcting the submission record if needed —
// this endpoint only records the resolution, it does not mutate
// proctoring_events (that array is the append-only audit trail; editing it
// after the fact would undermine its own purpose as evidence).
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'غير مصرّح' }, { status: 401 })

  const { data: profile } = await supabase
    .from('users').select('role, tenant_id').eq('id', user.id).single()
  if (!profile?.tenant_id) return NextResponse.json({ error: 'ممنوع' }, { status: 403 })

  let body: { status?: string; response?: string }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 }) }

  const status = body.status
  const response = body.response?.trim()
  if (!status || !RESOLUTIONS.has(status)) {
    return NextResponse.json({ error: 'الحالة غير صالحة' }, { status: 400 })
  }
  if (!response || response.length < 3) {
    return NextResponse.json({ error: 'يرجى كتابة رد على الطالب' }, { status: 400 })
  }

  const admin = adminClient()
  const { data: appeal } = await admin
    .from('exam_appeals').select('id, tenant_id, teacher_id, status').eq('id', id).single()
  if (!appeal || appeal.tenant_id !== profile.tenant_id) {
    return NextResponse.json({ error: 'الطعن غير موجود' }, { status: 404 })
  }

  const isOwner = appeal.teacher_id === user.id
  const isAdmin = profile.role === 'university_admin' || profile.role === 'super_admin'
  if (!isOwner && !isAdmin) return NextResponse.json({ error: 'ممنوع' }, { status: 403 })
  if (appeal.status !== 'pending') {
    return NextResponse.json({ error: 'تم البت في هذا الطعن مسبقاً' }, { status: 409 })
  }

  const { error } = await admin
    .from('exam_appeals')
    .update({ status, teacher_response: response, resolved_by: user.id, resolved_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'pending') // race guard, mirrors the codebase's invitation-revoke pattern

  if (error) {
    console.error('[api/appeals PATCH]', error)
    return NextResponse.json({ error: 'تعذّر حفظ القرار' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, status })
}
