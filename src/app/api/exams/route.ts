import { normalizeSebKey } from '@/lib/seb'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAdminDb } from '@/lib/db'
import type { Question } from '@/types'
import { deleteEntity } from '@/lib/delete-entity'

function adminClient() {
  return getAdminDb()
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
// Same untimed sentinel /api/homework uses: it only satisfies the finalize
// RPC's deadline check; the real cutoff of a task is its due date (ends_at).
const HOMEWORK_MINUTES = 43200

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

  let body: {
    title?: string; group_id?: string; course_id?: string; kind?: 'exam' | 'homework'
    duration_minutes?: number; proctoring_enabled?: boolean; questions?: Question[]; due_date?: string | null
    /** Optional SEB Config Key (64 hex); requires seb_config_key_migration.sql. */
    seb_config_key?: string | null
  }
  try { body = await request.json() }
  catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const { title, group_id, course_id, duration_minutes, proctoring_enabled, questions, due_date } = body
  // SEB is for proctored exams only; a malformed key is refused, not ignored.
  const sebRaw = typeof body.seb_config_key === 'string' ? body.seb_config_key.trim() : ''
  const sebKey = sebRaw ? normalizeSebKey(sebRaw) : null
  if (sebRaw && !sebKey) return NextResponse.json({ ...(await apiErr('sebKeyInvalid')) }, { status: 400 })
  const kind = body.kind ?? 'exam'
  // An exam belongs to exactly one group OR one course (DB CHECK
  // exam_must_belong_to_group_or_course). Group homework is created from its
  // lesson through /api/homework, so 'homework' here is a course task only.
  if (!title?.trim() || (!group_id === !course_id) || (kind !== 'exam' && kind !== 'homework') || (kind === 'homework' && !course_id)) {
    return NextResponse.json({ ...(await apiErr('titleAndGroupRequired')) }, { status: 400 })
  }

  const minutes = kind === 'homework' ? HOMEWORK_MINUTES : duration_minutes === undefined ? 60 : validDuration(duration_minutes)
  if (minutes === null) {
    return NextResponse.json(
      { ...(await apiErr('examDurationRange', { min: MIN_EXAM_MINUTES, max: MAX_EXAM_MINUTES })) },
      { status: 400 }
    )
  }
  const dueAt = kind === 'homework' && due_date ? new Date(due_date) : null
  if (dueAt && Number.isNaN(dueAt.getTime())) {
    return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })
  }

  // The target is client-supplied and decides who the exam is served to:
  // verify it belongs to this teacher (or, for an admin, to this tenant).
  const target = group_id
    ? await adminClient().from('groups').select('id, teacher_id, tenant_id').eq('id', group_id).single()
    : await adminClient().from('courses').select('id, teacher_id, tenant_id, deleted_at').eq('id', course_id!).single()
  const owner = target.data as { teacher_id: string | null; tenant_id: string; deleted_at?: string | null } | null
  if (!owner || owner.tenant_id !== profile.tenant_id || owner.deleted_at) {
    return NextResponse.json({ ...(await apiErr(group_id ? 'groupNotFound' : 'courseNotFound')) }, { status: 404 })
  }
  if (profile.role === 'teacher' && owner.teacher_id !== user.id) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }

  const { data, error } = await adminClient()
    .from('exams')
    .insert({
      type: kind,
      title: title.trim(),
      group_id: group_id ?? null,
      course_id: course_id ?? null,
      teacher_id: user.id,
      tenant_id: profile.tenant_id,
      duration_minutes: minutes,
      // A course task is untimed and unproctored, like lesson homework.
      proctoring_enabled: kind === 'exam' ? (proctoring_enabled ?? false) : false,
      ends_at: dueAt ? dueAt.toISOString() : null,
      questions: questions ?? [],
      // Only sent when set, so creating exams keeps working before the migration.
      ...(sebKey && kind === 'exam' && proctoring_enabled ? { seb_config_key: sebKey } : {}),
    })
    .select('*, groups(name), courses(title)')
    .single()

  if (error) {
    console.error('[api/exams POST]', error)
    // 42703 = undefined column: the SEB migration is not applied yet.
    if (sebKey && error.code === '42703') return NextResponse.json({ ...(await apiErr('sebNeedsMigration')) }, { status: 409 })
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
