import { currentCtx } from '@/lib/auth/current'
import { getTranslations } from 'next-intl/server'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { run, maybeOne } from '@/lib/db/sql'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HOMEWORK_LIMIT = 100
const SUBMISSION_LIMIT = 5000

interface SubRow {
  id: string; exam_id: string; answers: unknown; score: number | null; max_score: number | null
  grading_status: string | null; submitted_at: string | null; full_name: string | null; email: string | null
}

// GET /api/homework/submissions?lesson_id=… — teacher's grading view.
// Returns each homework of the lesson with its submissions incl. student
// identity and answers, so the teacher can review essays and publish grades.
export async function GET(request: Request) {
  const tc = await getTranslations('common')
  const ctx = await currentCtx()
  if (!ctx) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })

  const lessonId = new URL(request.url).searchParams.get('lesson_id')
  if (!lessonId) return NextResponse.json({ ...(await apiErr('lessonIdRequired')) }, { status: 400 })
  if (!ctx.tenant_id || !UUID.test(lessonId)) return NextResponse.json({ homework: [] })

  // One unit, as app_service pinned to the teacher's institution; both
  // statements are limited to the caller's own homework (ownership).
  const [exams, subs] = await run({ as: 'service', tenantId: ctx.tenant_id }, sql => [
    sql`select id, title, questions, ends_at, created_at from public.exams
         where lesson_id = ${lessonId} and type = 'homework' and teacher_id = ${ctx.sub} and deleted_at is null
         order by created_at
         limit ${HOMEWORK_LIMIT}`,
    sql`select s.id, s.exam_id, s.answers, s.score, s.max_score, s.grading_status, s.submitted_at, u.full_name, u.email
          from public.exam_submissions s
          join public.exams e on e.id = s.exam_id
          left join public.users u on u.id = s.student_id
         where e.lesson_id = ${lessonId} and e.type = 'homework' and e.teacher_id = ${ctx.sub} and e.deleted_at is null
         order by s.submitted_at
         limit ${SUBMISSION_LIMIT}`,
  ])

  const rows = subs as unknown as SubRow[]
  const homework = (exams as unknown as { id: string }[]).map(e => ({
    ...e,
    submissions: rows.filter(s => s.exam_id === e.id).map(s => ({
      id: s.id,
      student_name: s.full_name ?? tc('unknown'),
      student_email: s.email ?? '',
      answers: s.answers,
      score: s.score,
      max_score: s.max_score,
      grading_status: s.grading_status,
      submitted_at: s.submitted_at,
    })),
  }))

  return NextResponse.json({ homework })
}

// PATCH /api/homework/submissions — save a manual grade and/or publish.
// Body: { id, score?, grading_status? }
export async function PATCH(request: Request) {
  const ctx = await currentCtx()
  if (!ctx) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  const user = { id: ctx.sub }

  let body: { id?: string; score?: number; grading_status?: string; teacher_comment?: string | null }
  try { body = await request.json() }
  catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const { id, score, grading_status, teacher_comment } = body
  if (!id) return NextResponse.json({ ...(await apiErr('missingId')) }, { status: 400 })
  if (grading_status && !['pending', 'reviewing', 'published'].includes(grading_status)) {
    return NextResponse.json({ ...(await apiErr('invalidGradingStatus')) }, { status: 400 })
  }
  if (!ctx.tenant_id || !UUID.test(id)) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })

  const hasScore = typeof score === 'number'
  if (hasScore && (!Number.isFinite(score) || score < 0)) {
    return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })
  }
  // The teacher's written review of the answer, shown to the student once the
  // grading is published (individual_tasks_migration adds the column).
  let comment: string | null = null
  if (teacher_comment !== undefined) {
    if (teacher_comment !== null && typeof teacher_comment !== 'string') {
      return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })
    }
    const text = teacher_comment?.trim() ?? ''
    if (text.length > 8000) return NextResponse.json({ ...(await apiErr('textTooLong')) }, { status: 400 })
    comment = text || null
  }
  if (!hasScore && !grading_status && teacher_comment === undefined) {
    return NextResponse.json({ ...(await apiErr('nothingToUpdate')) }, { status: 400 })
  }

  // One unit, as app_service pinned to the teacher's institution:
  //  1. the submission and its exam's teacher (for a precise refusal)
  //  2. the update, ONLY when the submission is on the caller's own exam and
  //     the score is within 0..max_score
  //  3. finalize_exam_submission also wrote the auto-score into `grades`;
  //     that row follows the teacher's manual grade, from the same update.
  const [subRows, updRows] = await run({ as: 'service', tenantId: ctx.tenant_id }, sql => [
    sql`select s.max_score, e.teacher_id from public.exam_submissions s join public.exams e on e.id = s.exam_id
         where s.id = ${id}`,
    sql`
      with upd as (
        update public.exam_submissions s set
          score = case when ${hasScore} then ${hasScore ? score! : null}::numeric else s.score end,
          is_graded = case when ${hasScore} then true else s.is_graded end,
          grading_status = coalesce(${grading_status ?? null}::text, s.grading_status),
          teacher_comment = case when ${teacher_comment !== undefined} then ${comment}::text else s.teacher_comment end
          from public.exams e
         where s.id = ${id} and e.id = s.exam_id and e.teacher_id = ${user.id} and e.tenant_id = ${ctx.tenant_id}
           and (not ${hasScore} or s.max_score is null or ${hasScore ? score! : 0}::numeric <= s.max_score)
        returning s.id, s.score
      ), g as (
        update public.grades set score = upd.score, graded_at = now()
          from upd where ${hasScore} and grades.submission_id = upd.id
        returning grades.id
      )
      select upd.id, (select count(*) from g) as grades_synced from upd`,
  ])

  if (maybeOne(updRows)) return NextResponse.json({ ok: true })

  // Nothing was written: say why.
  const sub = maybeOne<{ max_score: number | null; teacher_id: string }>(subRows)
  if (!sub || sub.teacher_id !== user.id) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }
  if (hasScore && sub.max_score != null && score! > sub.max_score) {
    return NextResponse.json({ error: `Score must be between 0 and ${sub.max_score}` }, { status: 400 })
  }
  return NextResponse.json({ ...(await apiErr('updateFailed')) }, { status: 500 })
}
