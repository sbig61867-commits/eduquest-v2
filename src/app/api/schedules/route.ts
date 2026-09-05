import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { can } from '@/lib/permissions'

// Weekly timetables. Authoring is gated by the `manage_schedules`
// capability (university_admin / center_manager, or super_admin); the
// capability is checked with the user session and the writes then run on
// the service-role client, matching the codebase's privileged-write pattern.
function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

interface Caller { id: string; tenant_id: string }

async function authorize(): Promise<{ caller: Caller } | { error: NextResponse }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { data: profile } = await supabase
    .from('users').select('role, tenant_id, permissions').eq('id', user.id).single()

  if (!profile?.tenant_id || !can(profile.role, profile.permissions, 'manage_schedules')) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { caller: { id: user.id, tenant_id: profile.tenant_id } }
}

// POST — create a timetable for one group, or a private one for one teacher
export async function POST(request: Request) {
  const auth = await authorize()
  if ('error' in auth) return auth.error
  const { caller } = auth

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const kind = body.kind === 'teacher' ? 'teacher' : 'group'
  const targetId = String(body.target_id ?? '')
  const title = String(body.title ?? '').trim()
  if (!targetId) return NextResponse.json({ error: 'يجب اختيار المجموعة أو المعلم' }, { status: 400 })
  if (!title) return NextResponse.json({ error: 'عنوان الجدول مطلوب' }, { status: 400 })

  const admin = adminClient()

  // The target must live in the caller's tenant — and for a private
  // timetable it must actually be a teacher.
  if (kind === 'group') {
    const { data: group } = await admin.from('groups').select('id, tenant_id').eq('id', targetId).single()
    if (!group || group.tenant_id !== caller.tenant_id) {
      return NextResponse.json({ error: 'المجموعة غير موجودة' }, { status: 404 })
    }
  } else {
    const { data: teacher } = await admin.from('users').select('id, role, tenant_id').eq('id', targetId).single()
    if (!teacher || teacher.tenant_id !== caller.tenant_id || teacher.role !== 'teacher') {
      return NextResponse.json({ error: 'المعلم غير موجود' }, { status: 404 })
    }
  }

  const { data: created, error } = await admin
    .from('schedules')
    .insert({
      tenant_id: caller.tenant_id,
      created_by: caller.id,
      kind,
      group_id: kind === 'group' ? targetId : null,
      teacher_id: kind === 'teacher' ? targetId : null,
      title,
      is_published: false,
    })
    .select('id')
    .single()

  if (error) {
    // Partial unique index: one timetable per group / per teacher.
    if (error.code === '23505') {
      return NextResponse.json({ error: 'يوجد جدول لهذه المجموعة/المعلم بالفعل' }, { status: 409 })
    }
    console.error('[api/schedules POST]', error)
    return NextResponse.json({ error: 'تعذّر إنشاء الجدول' }, { status: 500 })
  }

  return NextResponse.json({ id: created!.id }, { status: 201 })
}

// PATCH — rename or publish/unpublish
export async function PATCH(request: Request) {
  const auth = await authorize()
  if ('error' in auth) return auth.error
  const { caller } = auth

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const id = String(body.id ?? '')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const admin = adminClient()
  const { data: existing } = await admin.from('schedules').select('id, tenant_id').eq('id', id).single()
  if (!existing || existing.tenant_id !== caller.tenant_id) {
    return NextResponse.json({ error: 'الجدول غير موجود' }, { status: 404 })
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.title !== undefined) {
    const t = String(body.title).trim()
    if (!t) return NextResponse.json({ error: 'عنوان الجدول مطلوب' }, { status: 400 })
    update.title = t
  }
  if (body.is_published !== undefined) update.is_published = body.is_published === true

  const { error } = await admin.from('schedules').update(update).eq('id', id)
  if (error) {
    console.error('[api/schedules PATCH]', error)
    return NextResponse.json({ error: 'تعذّر تحديث الجدول' }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}

// DELETE — remove a timetable (slots cascade)
export async function DELETE(request: Request) {
  const auth = await authorize()
  if ('error' in auth) return auth.error
  const { caller } = auth

  let body: { id?: string }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (!body.id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const admin = adminClient()
  const { data: existing } = await admin.from('schedules').select('id, tenant_id').eq('id', body.id).single()
  if (!existing || existing.tenant_id !== caller.tenant_id) {
    return NextResponse.json({ error: 'الجدول غير موجود' }, { status: 404 })
  }

  const { error } = await admin.from('schedules').delete().eq('id', body.id)
  if (error) {
    console.error('[api/schedules DELETE]', error)
    return NextResponse.json({ error: 'تعذّر حذف الجدول' }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
