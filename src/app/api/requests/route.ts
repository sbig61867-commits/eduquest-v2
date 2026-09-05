import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

// Staff request/inbox channel between a teacher and their university_admin.
// Auth uses the user session (RLS); the actual writes use the service-role
// client after app-level authorization, matching the rest of the codebase.
function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

const REQUEST_TYPES = ['grade_sheet', 'report', 'general'] as const
const STATUSES = ['pending', 'accepted', 'rejected', 'completed', 'cancelled'] as const

// State machine: which transitions are valid and who may make them.
// sender  = from_user_id  (teacher who opened the request)
// recipient = to_user_id  (admin)
const ALLOWED_TRANSITIONS: Record<string, { allowedBy: 'sender' | 'recipient' | 'either'; from: string[] }> = {
  cancelled:  { allowedBy: 'sender',    from: ['pending', 'accepted'] },
  accepted:   { allowedBy: 'recipient', from: ['pending'] },
  rejected:   { allowedBy: 'recipient', from: ['pending'] },
  completed:  { allowedBy: 'either',    from: ['accepted'] },
}

async function getProfile(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data } = await supabase.from('users').select('role, tenant_id').eq('id', userId).single()
  return data
}

// POST /api/requests — create a request (+ optional first message)
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const profile = await getProfile(supabase, user.id)
  if (!profile?.tenant_id || !['teacher', 'university_admin'].includes(profile.role ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { to_user_id?: string; type?: string; subject?: string; group_id?: string; message?: string }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { to_user_id, type = 'general', subject, group_id, message } = body
  if (!to_user_id) return NextResponse.json({ error: 'المستلِم مطلوب' }, { status: 400 })
  if (!subject?.trim()) return NextResponse.json({ error: 'الموضوع مطلوب' }, { status: 400 })
  if (!REQUEST_TYPES.includes(type as typeof REQUEST_TYPES[number])) {
    return NextResponse.json({ error: 'نوع الطلب غير صالح' }, { status: 400 })
  }
  if (to_user_id === user.id) return NextResponse.json({ error: 'لا يمكن إرسال طلب لنفسك' }, { status: 400 })

  const admin = adminClient()

  // Verify the recipient is staff in the same tenant, and enforce direction:
  // teacher ↔ university_admin only.
  const { data: recipient } = await admin
    .from('users').select('id, role, tenant_id').eq('id', to_user_id).single()
  if (!recipient || recipient.tenant_id !== profile.tenant_id) {
    return NextResponse.json({ error: 'المستلِم غير موجود في مؤسستك' }, { status: 404 })
  }
  const allowedRecipientRole = profile.role === 'teacher' ? 'university_admin' : 'teacher'
  if (recipient.role !== allowedRecipientRole) {
    return NextResponse.json({ error: 'وجهة الطلب غير مسموحة' }, { status: 403 })
  }

  // If a group is attached, verify it belongs to the tenant (and, for a
  // teacher sender, that they own it).
  if (group_id) {
    const { data: group } = await admin.from('groups').select('id, teacher_id, tenant_id').eq('id', group_id).single()
    if (!group || group.tenant_id !== profile.tenant_id) {
      return NextResponse.json({ error: 'المجموعة غير موجودة' }, { status: 404 })
    }
    if (profile.role === 'teacher' && group.teacher_id !== user.id) {
      return NextResponse.json({ error: 'ليست مجموعتك' }, { status: 403 })
    }
  }

  const { data: created, error } = await admin
    .from('staff_requests')
    .insert({
      tenant_id: profile.tenant_id,
      from_user_id: user.id,
      to_user_id,
      type,
      subject: subject.trim(),
      group_id: group_id ?? null,
      status: 'pending',
    })
    .select('id')
    .single()

  if (error || !created) {
    console.error('[api/requests POST]', error)
    return NextResponse.json({ error: 'تعذّر إنشاء الطلب' }, { status: 500 })
  }

  if (message?.trim()) {
    await admin.from('request_messages').insert({
      request_id: created.id, sender_id: user.id, body: message.trim(),
    })
  }

  return NextResponse.json({ id: created.id }, { status: 201 })
}

// PATCH /api/requests — change status (accept/reject/complete/cancel)
export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const profile = await getProfile(supabase, user.id)
  if (!profile?.tenant_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: { id?: string; status?: string }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { id, status } = body
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  if (!status || !STATUSES.includes(status as typeof STATUSES[number])) {
    return NextResponse.json({ error: 'حالة غير صالحة' }, { status: 400 })
  }

  const admin = adminClient()
  const { data: req } = await admin
    .from('staff_requests').select('id, tenant_id, from_user_id, to_user_id, status').eq('id', id).single()
  if (!req || req.tenant_id !== profile.tenant_id) {
    return NextResponse.json({ error: 'الطلب غير موجود' }, { status: 404 })
  }
  const isParticipant = req.from_user_id === user.id || req.to_user_id === user.id
  if (!isParticipant && profile.role !== 'university_admin' && profile.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Validate state machine: check valid from-state and who may make this transition.
  const transition = ALLOWED_TRANSITIONS[status]
  if (!transition) {
    return NextResponse.json({ error: 'الانتقال إلى هذه الحالة غير مسموح' }, { status: 400 })
  }
  if (!transition.from.includes(req.status)) {
    return NextResponse.json({ error: `لا يمكن تغيير حالة الطلب من ${req.status} إلى ${status}` }, { status: 409 })
  }
  const isSender    = req.from_user_id === user.id
  const isRecipient = req.to_user_id   === user.id
  const isSuperAdmin = profile.role === 'super_admin'
  if (
    !isSuperAdmin &&
    transition.allowedBy === 'sender'    && !isSender    ||
    !isSuperAdmin &&
    transition.allowedBy === 'recipient' && !isRecipient
  ) {
    return NextResponse.json({ error: 'ليس لديك صلاحية هذا الإجراء على الطلب' }, { status: 403 })
  }

  const { error } = await admin
    .from('staff_requests')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) {
    console.error('[api/requests PATCH]', error)
    return NextResponse.json({ error: 'تعذّر تحديث الحالة' }, { status: 500 })
  }
  return NextResponse.json({ success: true, status })
}
