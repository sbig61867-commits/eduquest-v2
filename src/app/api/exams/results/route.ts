import { currentCtx } from '@/lib/auth/current'
import { isViolation } from '@/lib/proctoring-events'
import { findSimilarPairs, type SimilarityQuestion } from '@/lib/answer-similarity'
import { getTranslations } from 'next-intl/server'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { getAdminDb } from '@/lib/db'
import { run, maybeOne } from '@/lib/db/sql'
import { EXAM_FILES_BUCKET, SIGNED_URL_SECONDS, signExamFiles } from '@/lib/exam-files'

// Storage (exam files) stays on the Supabase client until step 11 moves files to R2.
function storageClient() {
  return getAdminDb()
}

type ExamRow = {
  id: string; teacher_id: string; title: string; questions: unknown[] | null; group_id: string | null; course_id: string | null
  assigned_student_id: string | null; counts_toward_grade: boolean | null; instructions: string | null; attachments: unknown
  group_name: string | null; course_title: string | null
}
type ResultRow = {
  student_id: string; full_name: string | null; email: string | null
  id: string | null; status: string | null; answers: Record<string, string> | null; score: number | null; max_score: number | null
  grading_status: string | null; submitted_at: string | null; proctoring_events: unknown; answer_files: Record<string, string> | null
  teacher_comment: string | null
}

// GET /api/exams/results?exam_id=…  — results for one exam (teacher-owned):
// who submitted, their score, grading status, proctoring flags, plus the
// full group roster so the teacher sees who hasn't taken it yet.
export async function GET(request: Request) {
  const tc = await getTranslations('common')
  const ctx = await currentCtx()
  if (!ctx) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  const user = { id: ctx.sub }

  const examId = new URL(request.url).searchParams.get('exam_id')
  if (!examId) return NextResponse.json({ ...(await apiErr('missingExamId')) }, { status: 400 })

  if (!/^[0-9a-f-]{36}$/i.test(examId) || !ctx.tenant_id) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })

  // One unit, as app_service pinned to the teacher's institution, every
  // statement limited to an exam this teacher owns:
  //  1. the exam with its group or course name
  //  2. its roster (group members, or the course's enrolled students; the
  //     assigned student only for an individual task) with each student's
  //     name and submission, joined — no second read for names
  //  3. how many submissions are in (all of them, roster or not, as before)
  const [examRows, resultRows, countRows] = await run({ as: 'service', tenantId: ctx.tenant_id }, sql => [
    sql`select e.id, e.teacher_id, e.title, e.questions, e.group_id, e.course_id, e.assigned_student_id,
               e.counts_toward_grade, e.instructions, e.attachments, g.name as group_name, c.title as course_title
          from public.exams e
          left join public.groups g on g.id = e.group_id
          left join public.courses c on c.id = e.course_id
         where e.id = ${examId} and e.teacher_id = ${user.id}`,
    sql`with e as (
          select id, group_id, course_id, assigned_student_id from public.exams where id = ${examId} and teacher_id = ${user.id}
        ), roster as (
          select gs.student_id from e join public.group_students gs on gs.group_id = e.group_id
          union
          select ce.student_id from e join public.course_enrollments ce on ce.course_id = e.course_id where e.group_id is null
        )
        select r.student_id, u.full_name, u.email,
               s.id, s.status, s.answers, s.score, s.max_score, s.grading_status, s.submitted_at,
               s.proctoring_events, s.answer_files, s.teacher_comment
          from roster r
          cross join e
          left join public.users u on u.id = r.student_id
          left join public.exam_submissions s on s.exam_id = e.id and s.student_id = r.student_id
         where e.assigned_student_id is null or r.student_id = e.assigned_student_id`,
    sql`select count(*) filter (where s.status = 'submitted')::int as n
          from public.exam_submissions s join public.exams e on e.id = s.exam_id
         where s.exam_id = ${examId} and e.teacher_id = ${user.id}`,
  ])
  const exam = maybeOne<ExamRow>(examRows)
  if (!exam) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }
  const roster = resultRows as unknown as ResultRow[]
  const subs = roster.filter(r => r.id)
  const admin = storageClient()

  const maxScore = ((exam.questions as Array<{ points?: number }>) ?? [])
    .reduce((s, q) => s + (q.points ?? 0), 0)


  // Photos of handwritten answers (individual tasks): one signing round-trip
  // for the whole roster, keyed back to student + question.
  const filePairs = subs.flatMap(s =>
    s.status === 'submitted'
      ? Object.entries((s.answer_files as Record<string, string> | null) ?? {}).map(([qid, path]) => ({ student: s.student_id as string, qid, path }))
      : [])
  const signedFiles = new Map<string, Record<string, string>>()
  if (filePairs.length > 0) {
    const { data: signed } = await admin.storage.from(EXAM_FILES_BUCKET).createSignedUrls(filePairs.map(f => f.path), SIGNED_URL_SECONDS)
    filePairs.forEach((f, i) => {
      const url = signed?.[i]?.signedUrl
      if (url) signedFiles.set(f.student, { ...(signedFiles.get(f.student) ?? {}), [f.qid]: url })
    })
  }

  // One row per enrolled student — submitted or not. Includes the submission
  // id + raw answers so the teacher can review and manually grade (this route
  // is teacher-owned, so exposing correct answers/answers here is safe).
  const results = roster.map(r => {
    // An attempt that was started but not handed in is not a submission.
    const s = r.status === 'submitted' ? r : undefined
    // Only violations count; signals (pasting) and monitoring info (a
    // detector that failed to load, coverage) never flag an attempt.
    const events = ((s?.proctoring_events as Array<{ type?: string }> | null) ?? [])
      .filter(isViolation)
    return {
      student_id: r.student_id,
      submission_id: s?.id ?? null,
      name: r.full_name ?? tc('unknown'),
      email: r.email ?? '',
      submitted: !!s,
      answers: (s?.answers as Record<string, string> | null) ?? {},
      score: s?.score ?? null,
      max_score: s?.max_score ?? maxScore,
      grading_status: s?.grading_status ?? null,
      submitted_at: s?.submitted_at ?? null,
      violations: events.length,
      answer_file_urls: signedFiles.get(r.student_id) ?? {},
      teacher_comment: (s?.teacher_comment as string | null | undefined) ?? null,
    }
  })
  // Submitted first, then by score desc.
  results.sort((a, b) => Number(b.submitted) - Number(a.submitted) || (b.score ?? -1) - (a.score ?? -1))

  const groupName = exam.group_name ?? exam.course_title ?? '·'
  return NextResponse.json({
    title: exam.title, group_name: groupName, max_score: maxScore,
    submitted_count: maybeOne<{ n: number }>(countRows)?.n ?? 0, roster_count: roster.length,
    // Full questions (incl. correct_answer) so the teacher can view the exam
    // content and review answers — teacher-owned route only.
    questions: exam.questions ?? [],
    // Lets the results link each student to an individual follow-up task.
    group_id: exam.group_id ?? null,
    // Individual follow-up task: what the student was sent.
    individual: !!exam.assigned_student_id,
    counts_toward_grade: exam.counts_toward_grade !== false,
    instructions: exam.instructions ?? null,
    attachment_urls: await signExamFiles(Array.isArray(exam.attachments) ? exam.attachments : [], admin),
    results,
    // Collusion hints between submitted students (computed here, stored nowhere).
    similarity: exam.assigned_student_id ? [] : findSimilarPairs(
      (exam.questions ?? []) as SimilarityQuestion[],
      results.filter(r => r.submitted).map(r => ({ studentId: r.student_id, name: r.name, answers: r.answers })),
    ),
  })
}
