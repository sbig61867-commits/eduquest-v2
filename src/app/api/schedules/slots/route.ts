import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { can } from '@/lib/permissions'

// Individual timetable entries. Same authorization model as
// /api/schedules: `manage_schedules` checked on the user session, writes
// performed with the service-role client, and every row re-verified to
// belong to the caller's tenant before it is touched.
function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/

async function authorize(): Promise<{ tenantId: string } | { error: NextResponse }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { data: profile } = await supabase
    .from('users').select('role, tenant_id, permissions').eq('id', user.id).single()

  if (!profile?.tenant_id || !can(profile.role, profile.permissions, 'manage_schedules')) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { tenantId: profile.tenant_id }
}

/** Shared field validation for POST and PATCH. */
function readSlotFields(body: Record<string, unknown>, partial: boolean) {
  const out: Record<string, unknown> = {}

  if (!partial || body.title !== undefined) {
    const title = String(body.title ?? '').trim()
    if (!title) return { error: 'عنوان الموعد مطلوب' }
    out.title = title
  }
  if (!partial || body.day_of_week !== undefined) {
    const day = Number(body.day_of_week)
    if (!Number.isInteger(day) || day < 0 || day > 6) return { error: 'اليوم غير صالح' }
    out.day_of_week = day
  }
  if (!partial || body.start_time !== undefined) {
    const t = String(body.start_time ?? '')
    if (!TIME_RE.test(t)) return { error: 'وقت البداية غير صالح' }
    out.start_time = t
  }
  if (!partial || body.end_time !== undefined) {
    const t = String(body.end_time ?? '')
    if (!TIME_RE.test(t)) return { error: 'وقت النهاية غير صالح' }
    out.end_time = t
  }
  for (const f of ['location', 'note'] as const) {
    if (body[f] !== undefined) out[f] = body[f] ? String(body[f]).trim() : null
  }
  if (body.teacher_id !== undefined) out.teacher_id = body.teacher_id ? String(body.teacher_id) : null

  // Only comparable when both ends are present (always true on POST).
  if (out.start_time && out.end_time && String(out.end_time) <= String(out.start_time)) {
    return { error: 'وقت النهاية يجب أن يكون بعد وقت البداية' }
  }
  return { fields: out }
}

/** A slot's teacher must belong to the same tenant and actually be a teacher. */
async function validateTeacher(
  admin: ReturnType<typeof adminClient>, tenantId: string, teacherId: unknown,
): Promise<boolean> {
  if (!teacherId) return true
  const { data } = await admin.from('users').select('id, role, tenant_id').eq('id', String(teacherId)).single()
  return !!data && data.tenant_id === tenantId && data.role === 'teacher'
}

export async function POST(request: Request) {
  const auth = await authorize()
  if ('error' in auth) return auth.error

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const scheduleId = String(body.schedule_id ?? '')
  if (!scheduleId) return NextResponse.json({ error: 'Missing schedule_id' }, { status: 400 })

  const parsed = readSlotFields(body, false)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const admin = adminClient()
  const { data: schedule } = await admin
    .from('schedules').select('id, tenant_id').eq('id', scheduleId).single()
  if (!schedule || schedule.tenant_id !== auth.tenantId) {
    return NextResponse.json({ error: 'الجدول غير موجود' }, { status: 404 })
  }
  if (!(await validateTeacher(admin, auth.tenantId, parsed.fields.teacher_id))) {
    return NextResponse.json({ error: 'المعلم المحدد غير صالح' }, { status: 400 })
  }

  const { data: created, error } = await admin
    .from('schedule_slots')
    .insert({ ...parsed.fields, schedule_id: scheduleId, tenant_id: auth.tenantId })
    .select('id')
    .single()

  if (error) {
    console.error('[api/schedules/slots POST]', error)
    return NextResponse.json({ error: 'تعذّر إضافة الموعد' }, { status: 500 })
  }
  return NextResponse.json({ id: created!.id }, { status: 201 })
}

export async function PATCH(request: Request) {
  const auth = await authorize()
  if ('error' in auth) return auth.error

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const id = String(body.id ?? '')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const admin = adminClient()
  const { data: existing } = await admin
    .from('schedule_slots').select('id, tenant_id, start_time, end_time').eq('id', id).single()
  if (!existing || existing.tenant_id !== auth.tenantId) {
    return NextResponse.json({ error: 'الموعد غير موجود' }, { status: 404 })
  }

  const parsed = readSlotFields(body, true)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })

  // Re-check the ordering against the stored values when only one end moves.
  const start = String(parsed.fields.start_time ?? existing.start_time)
  const end   = String(parsed.fields.end_time   ?? existing.end_time)
  if (end.slice(0, 5) <= start.slice(0, 5)) {
    return NextResponse.json({ error: 'وقت النهاية يجب أن يكون بعد وقت البداية' }, { status: 400 })
  }
  if (!(await validateTeacher(admin, auth.tenantId, parsed.fields.teacher_id))) {
    return NextResponse.json({ error: 'المعلم المحدد غير صالح' }, { status: 400 })
  }

  const { error } = await admin.from('schedule_slots').update(parsed.fields).eq('id', id)
  if (error) {
    console.error('[api/schedules/slots PATCH]', error)
    return NextResponse.json({ error: 'تعذّر تحديث الموعد' }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}

export async function DELETE(request: Request) {
  const auth = await authorize()
  if ('error' in auth) return auth.error

  let body: { id?: string }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (!body.id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const admin = adminClient()
  const { data: existing } = await admin
    .from('schedule_slots').select('id, tenant_id').eq('id', body.id).single()
  if (!existing || existing.tenant_id !== auth.tenantId) {
    return NextResponse.json({ error: 'الموعد غير موجود' }, { status: 404 })
  }

  const { error } = await admin.from('schedule_slots').delete().eq('id', body.id)
  if (error) {
    console.error('[api/schedules/slots DELETE]', error)
    return NextResponse.json({ error: 'تعذّر حذف الموعد' }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
