import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import type { Question } from '@/types'
import { deleteEntity } from '@/lib/delete-entity'

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

// Returns the owned row (so callers can also branch on its type) or null.
async function ownsExam(examId: string, teacherId: string, tenantId: string) {
  const { data } = await adminClient()
    .from('exams').select('id, teacher_id, tenant_id, type').eq('id', examId).single()
  if (!data || data.tenant_id !== tenantId || data.teacher_id !== teacherId) return null
  return data
}

// A formal exam must stay inside timer range. The student UI treats a
// duration of 0 (or >= 43200, the homework sentinel) as "untimed", which
// hides the countdown and disables auto-submit — so an out-of-range value
// saved here would silently turn a proctored exam into an open-ended one.
// This route only ever writes type='exam'; homework sets its own sentinel
// through /api/homework with the service-role client.
const MIN_EXAM_MINUTES = 1
const MAX_EXAM_MINUTES = 600

function validDuration(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null
  if (n < MIN_EXAM_MINUTES || n > MAX_EXAM_MINUTES) return null
  return n
}

// POST /api/exams — create exam
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })

  const profile = await getTeacherProfile(user.id)
  if (!profile?.tenant_id || !['teacher', 'university_admin', 'super_admin'].includes(profile.role ?? '')) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }

  let body: { title?: string; group_id?: string; duration_minutes?: number; proctoring_enabled?: boolean; questions?: Question[] }
  try { body = await request.json() }
  catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const { title, group_id, duration_minutes, proctoring_enabled, questions } = body
  if (!title?.trim() || !group_id) {
    return NextResponse.json({ ...(await apiErr('titleAndGroupRequired')) }, { status: 400 })
  }

  const minutes = duration_minutes === undefined ? 60 : validDuration(duration_minutes)
  if (minutes === null) {
    return NextResponse.json(
      { ...(await apiErr('examDurationRange', { min: MIN_EXAM_MINUTES, max: MAX_EXAM_MINUTES })) },
      { status: 400 }
    )
  }

  // Verify group belongs to this teacher in this tenant
  const { data: group } = await adminClient()
    .from('groups').select('id, teacher_id, tenant_id').eq('id', group_id).single()
  if (!group || group.tenant_id !== profile.tenant_id) {
    return NextResponse.json({ ...(await apiErr('groupNotFound')) }, { status: 404 })
  }
  if (profile.role === 'teacher' && group.teacher_id !== user.id) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }

  const { data, error } = await adminClient()
    .from('exams')
    .insert({
      type: 'exam',
      title: title.trim(),
      group_id,
      teacher_id: user.id,
      tenant_id: profile.tenant_id,
      duration_minutes: minutes,
      proctoring_enabled: proctoring_enabled ?? false,
      questions: questions ?? [],
    })
    .select('*, groups(name)')
    .single()

  if (error) {
    console.error('[api/exams POST]', error)
    return NextResponse.json({ ...(await apiErr('examCreateFailed')) }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}

// PATCH /api/exams — update exam (publish/unpublish or edit)
export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })

  const profile = await getTeacherProfile(user.id)
  if (!profile?.tenant_id) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })

  let body: { id?: string; is_published?: boolean; title?: string; duration_minutes?: number }
  try { body = await request.json() }
  catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const { id, ...rest } = body
  if (!id) return NextResponse.json({ ...(await apiErr('missingId')) }, { status: 400 })

  const owned = await ownsExam(id, user.id, profile.tenant_id)
  if (!owned) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }

  const update: Record<string, unknown> = {}
  if (rest.is_published !== undefined) update.is_published = rest.is_published
  if (rest.title !== undefined) update.title = rest.title
  if (rest.duration_minutes !== undefined) {
    // Homework is deliberately untimed (sentinel duration) and is edited
    // through /api/homework — forcing it into the exam timer range here
    // would turn a due-date assignment into a timed test.
    if (owned.type === 'homework') {
      return NextResponse.json({ ...(await apiErr('homeworkEditFromLesson')) }, { status: 400 })
    }
    const minutes = validDuration(rest.duration_minutes)
    if (minutes === null) {
      return NextResponse.json(
        { ...(await apiErr('examDurationRange', { min: MIN_EXAM_MINUTES, max: MAX_EXAM_MINUTES })) },
        { status: 400 }
      )
    }
    update.duration_minutes = minutes
  }

  const { data, error } = await adminClient()
    .from('exams').update(update).eq('id', id).select('*, groups(name)').single()

  if (error) {
    console.error('[api/exams PATCH]', error)
    return NextResponse.json({ ...(await apiErr('examUpdateFailed')) }, { status: 500 })
  }

  return NextResponse.json(data)
}

// DELETE /api/exams — delete exam
export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })

  const profile = await getTeacherProfile(user.id)
  if (!profile?.tenant_id) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })

  let body: { id?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const { id } = body
  if (!id) return NextResponse.json({ ...(await apiErr('missingId')) }, { status: 400 })

  if (!(await ownsExam(id, user.id, profile.tenant_id))) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }

  // Archive by default; hard delete only when the owner enabled it.
  const { error, mode } = await deleteEntity(adminClient(), supabase, 'exam', id, user.id, profile.tenant_id)
  if (error) {
    console.error('[api/exams DELETE]', error)
    return NextResponse.json({ ...(await apiErr('examDeleteFailed')) }, { status: 500 })
  }
  return NextResponse.json({ ok: true, mode })
}
