import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import type { Question } from '@/types'

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

async function getTeacherProfile(userId: string) {
  const supabase = await createClient()
  const { data } = await supabase
    .from('users').select('role, tenant_id').eq('id', userId).single()
  return data
}

async function ownsExam(examId: string, teacherId: string, tenantId: string) {
  const { data } = await adminClient()
    .from('exams').select('id, teacher_id, tenant_id').eq('id', examId).single()
  return data && data.tenant_id === tenantId && data.teacher_id === teacherId
}

// POST /api/exams — create exam
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const profile = await getTeacherProfile(user.id)
  if (!profile?.tenant_id || !['teacher', 'university_admin', 'super_admin'].includes(profile.role ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { title?: string; group_id?: string; duration_minutes?: number; proctoring_enabled?: boolean; questions?: Question[] }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { title, group_id, duration_minutes, proctoring_enabled, questions } = body
  if (!title?.trim() || !group_id) {
    return NextResponse.json({ error: 'title and group_id are required' }, { status: 400 })
  }

  // Verify group belongs to this teacher in this tenant
  const { data: group } = await adminClient()
    .from('groups').select('id, teacher_id, tenant_id').eq('id', group_id).single()
  if (!group || group.tenant_id !== profile.tenant_id) {
    return NextResponse.json({ error: 'Group not found' }, { status: 404 })
  }
  if (profile.role === 'teacher' && group.teacher_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data, error } = await adminClient()
    .from('exams')
    .insert({
      title: title.trim(),
      group_id,
      teacher_id: user.id,
      tenant_id: profile.tenant_id,
      duration_minutes: duration_minutes ?? 60,
      proctoring_enabled: proctoring_enabled ?? false,
      questions: questions ?? [],
    })
    .select('*, groups(name)')
    .single()

  if (error) {
    console.error('[api/exams POST]', error)
    return NextResponse.json({ error: 'Failed to create exam' }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}

// PATCH /api/exams — update exam (publish/unpublish or edit)
export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const profile = await getTeacherProfile(user.id)
  if (!profile?.tenant_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: { id?: string; is_published?: boolean; title?: string; duration_minutes?: number }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { id, ...rest } = body
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  if (!(await ownsExam(id, user.id, profile.tenant_id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const update: Record<string, unknown> = {}
  if (rest.is_published !== undefined) update.is_published = rest.is_published
  if (rest.title !== undefined) update.title = rest.title
  if (rest.duration_minutes !== undefined) update.duration_minutes = rest.duration_minutes

  const { data, error } = await adminClient()
    .from('exams').update(update).eq('id', id).select('*, groups(name)').single()

  if (error) {
    console.error('[api/exams PATCH]', error)
    return NextResponse.json({ error: 'Failed to update exam' }, { status: 500 })
  }

  return NextResponse.json(data)
}

// DELETE /api/exams — delete exam
export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const profile = await getTeacherProfile(user.id)
  if (!profile?.tenant_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: { id?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { id } = body
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  if (!(await ownsExam(id, user.id, profile.tenant_id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { error } = await adminClient().from('exams').delete().eq('id', id)
  if (error) {
    console.error('[api/exams DELETE]', error)
    return NextResponse.json({ error: 'Failed to delete exam' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
