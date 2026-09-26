import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rate-limit'
import { examFilesAdmin, isOwnTaskAttachment, isUuid, MAX_ATTACHMENTS } from '@/lib/exam-files'
import type { Question } from '@/types'

// POST /api/exams/individual — send ONE student a follow-up task of their own
// (their weak points, what to rework, optional images). It is an ordinary
// homework row with assigned_student_id set, so it runs on the exam engine
// unchanged; get_student_exams / start_exam_attempt show and open it to that
// student only (individual_tasks_migration.sql).
//
// Everything the client sends is re-checked here, with the user's session for
// identity and the service role only for the final write:
//   the group is the teacher's own (or the admin's tenant's),
//   the student is a member of it (a DB trigger enforces it too),
//   the source exam, when given, is the teacher's own exam in that tenant,
//   every attachment path was uploaded by this teacher (/api/exams/files).

const QUESTION_TYPES = new Set<Question['type']>(['essay', 'short_answer', 'mcq', 'true_false'])
const MAX_QUESTIONS = 20
/** Same untimed sentinel as lesson homework: the real cutoff is the due date. */
const TASK_MINUTES = 43200

function cleanQuestions(raw: unknown, graded: boolean): Question[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_QUESTIONS) return null
  const out: Question[] = []
  for (const [i, q] of raw.entries()) {
    const r = (q ?? {}) as Record<string, unknown>
    const text = typeof r.text === 'string' ? r.text.trim() : ''
    const type = (QUESTION_TYPES.has(r.type as Question['type']) ? r.type : 'essay') as Question['type']
    if (!text || text.length > 4000) return null
    const options = type === 'mcq' && Array.isArray(r.options)
      ? r.options.filter((o): o is string => typeof o === 'string' && o.trim().length > 0).map(o => o.trim().slice(0, 500)).slice(0, 8)
      : undefined
    if (type === 'mcq' && (!options || options.length < 2)) return null
    const correct = typeof r.correct_answer === 'string' ? r.correct_answer.trim().slice(0, 500) : ''
    const points = graded ? Math.min(100, Math.max(1, Math.round(Number(r.points) || 5))) : 0
    out.push({ id: String(i + 1), text, type, ...(options ? { options } : {}), correct_answer: correct, points })
  }
  return out
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })

  const { data: profile } = await supabase.from('users').select('role, tenant_id').eq('id', user.id).single()
  if (!profile?.tenant_id || !['teacher', 'university_admin'].includes(profile.role ?? '')) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }
  const tenantId = profile.tenant_id as string

  const limit = await rateLimit(`individual_task:${user.id}`, { limit: 120, windowSecs: 3600 })
  if (!limit.allowed) return NextResponse.json({ ...(await apiErr('rateLimited')) }, { status: 429 })

  let body: Record<string, unknown>
  try { body = await request.json() }
  catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const studentId = body.student_id
  const groupId = body.group_id
  const sourceId = body.source_exam_id ?? null
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const instructions = typeof body.instructions === 'string' ? body.instructions.trim() : ''
  const graded = body.counts_toward_grade !== false
  if (!isUuid(studentId) || !isUuid(groupId) || (sourceId !== null && !isUuid(sourceId))) {
    return NextResponse.json({ ...(await apiErr('missingGroupOrStudent')) }, { status: 400 })
  }
  if (!title) return NextResponse.json({ ...(await apiErr('titleRequired')) }, { status: 400 })
  if (title.length > 200) return NextResponse.json({ ...(await apiErr('titleTooLong')) }, { status: 400 })
  if (instructions.length > 8000) return NextResponse.json({ ...(await apiErr('instructionsTooLong')) }, { status: 400 })

  const questions = cleanQuestions(body.questions, graded)
  if (!questions) return NextResponse.json({ ...(await apiErr('questionRequired')) }, { status: 400 })

  const attachments = Array.isArray(body.attachments) ? body.attachments : []
  if (attachments.length > MAX_ATTACHMENTS || !attachments.every(p => isOwnTaskAttachment(p, tenantId, user.id))) {
    return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })
  }

  const due = typeof body.due_date === 'string' && body.due_date ? new Date(body.due_date) : null
  if (due && (Number.isNaN(due.getTime()) || due.getTime() < Date.now())) {
    return NextResponse.json({ ...(await apiErr('invalidEndDate')) }, { status: 400 })
  }

  // Ownership and membership, read through the user's own session (RLS).
  const { data: group } = await supabase
    .from('groups').select('id, teacher_id, tenant_id').eq('id', groupId).is('deleted_at', null).maybeSingle()
  if (!group || group.tenant_id !== tenantId) return NextResponse.json({ ...(await apiErr('groupNotFound')) }, { status: 404 })
  if (profile.role === 'teacher' && group.teacher_id !== user.id) {
    return NextResponse.json({ ...(await apiErr('notYourGroup')) }, { status: 403 })
  }
  const { data: member } = await supabase
    .from('group_students').select('student_id').eq('group_id', groupId).eq('student_id', studentId).maybeSingle()
  if (!member) return NextResponse.json({ ...(await apiErr('studentsNotInGroup')) }, { status: 400 })

  if (sourceId) {
    const { data: source } = await supabase
      .from('exams').select('id, tenant_id, teacher_id').eq('id', sourceId).maybeSingle()
    if (!source || source.tenant_id !== tenantId || (profile.role === 'teacher' && source.teacher_id !== user.id)) {
      return NextResponse.json({ ...(await apiErr('examNotFound')) }, { status: 404 })
    }
  }

  const { data, error } = await examFilesAdmin()
    .from('exams')
    .insert({
      type: 'homework',
      title,
      group_id: groupId,
      teacher_id: group.teacher_id ?? user.id,
      tenant_id: tenantId,
      assigned_student_id: studentId,
      source_exam_id: sourceId,
      instructions: instructions || null,
      attachments,
      counts_toward_grade: graded,
      questions,
      duration_minutes: TASK_MINUTES,
      ends_at: due ? due.toISOString() : null,
      proctoring_enabled: false,
      is_published: true,
    })
    .select('id, title, created_at')
    .single()

  if (error) {
    console.error('[api/exams/individual]', error.message)
    return NextResponse.json({ ...(await apiErr('homeworkCreateFailed')) }, { status: 500 })
  }
  return NextResponse.json(data, { status: 201 })
}
