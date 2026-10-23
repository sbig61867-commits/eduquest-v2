import { currentCtx } from '@/lib/auth/current'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { run, maybeOne } from '@/lib/db/sql'
import { rateLimit } from '@/lib/rate-limit'
import { isOwnTaskAttachment, isUuid, MAX_ATTACHMENTS } from '@/lib/exam-files'
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
  const ctx = await currentCtx()
  if (!ctx) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  const user = { id: ctx.sub }

  if (!ctx.tenant_id || !['teacher', 'university_admin'].includes(ctx.role ?? '')) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }
  const tenantId = ctx.tenant_id
  const profile = { role: ctx.role }

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
  // One unit (it used to be five round trips), as app_service pinned to the
  // institution: the group, the membership and the source exam as they stand
  // (for a precise refusal), then the insert, which happens ONLY when the group
  // is live and in this institution — the caller's own, for a teacher — the
  // student is in it, the source exam (if any) is the caller's, and the
  // caller's LIVE role still allows it.
  type Group = { teacher_id: string | null; tenant_id: string }
  const [groupRows, memberRows, sourceRows, createdRows] = await run({ as: 'service', tenantId }, sql => [
    sql`select teacher_id, tenant_id from public.groups where id = ${groupId} and deleted_at is null`,
    sql`select 1 as ok from public.group_students where group_id = ${groupId} and student_id = ${studentId}`,
    sql`select tenant_id, teacher_id from public.exams where id = ${sourceId}`,
    sql`
      with me as (
        select role, tenant_id from public.users where id = ${user.id} and is_active is not false
      ), g as (
        select id, teacher_id, tenant_id from public.groups where id = ${groupId} and deleted_at is null
      )
      insert into public.exams (type, title, group_id, teacher_id, tenant_id, assigned_student_id, source_exam_id,
                                instructions, attachments, counts_toward_grade, questions, duration_minutes, ends_at,
                                proctoring_enabled, is_published)
      select 'homework', ${title}, g.id, coalesce(g.teacher_id, ${user.id}), g.tenant_id, ${studentId}, ${sourceId},
             ${instructions || null}, ${sql.json(attachments as string[])}, ${graded}, ${sql.json(questions as unknown as Parameters<typeof sql.json>[0])},
             ${TASK_MINUTES}, ${due ? due.toISOString() : null}, false, true
        from me, g
       where g.tenant_id = me.tenant_id
         and me.role in ('teacher', 'university_admin')
         and (me.role <> 'teacher' or g.teacher_id = ${user.id})
         and exists (select 1 from public.group_students gs where gs.group_id = g.id and gs.student_id = ${studentId})
         and (${sourceId}::uuid is null or exists (
               select 1 from public.exams x where x.id = ${sourceId} and x.tenant_id = me.tenant_id
                  and (me.role <> 'teacher' or x.teacher_id = ${user.id})))
      returning id, title, created_at`,
  ])

  const data = maybeOne<{ id: string; title: string; created_at: string }>(createdRows)
  if (!data) {
    const group = maybeOne<Group>(groupRows)
    if (!group || group.tenant_id !== tenantId) return NextResponse.json({ ...(await apiErr('groupNotFound')) }, { status: 404 })
    if (profile.role === 'teacher' && group.teacher_id !== user.id) {
      return NextResponse.json({ ...(await apiErr('notYourGroup')) }, { status: 403 })
    }
    if (!maybeOne(memberRows)) return NextResponse.json({ ...(await apiErr('studentsNotInGroup')) }, { status: 400 })
    const source = maybeOne<{ tenant_id: string; teacher_id: string }>(sourceRows)
    if (sourceId && (!source || source.tenant_id !== tenantId || (profile.role === 'teacher' && source.teacher_id !== user.id))) {
      return NextResponse.json({ ...(await apiErr('examNotFound')) }, { status: 404 })
    }
    const error = new Error('insert refused')
    console.error('[api/exams/individual]', error.message)
    return NextResponse.json({ ...(await apiErr('homeworkCreateFailed')) }, { status: 500 })
  }
  return NextResponse.json(data, { status: 201 })
}
