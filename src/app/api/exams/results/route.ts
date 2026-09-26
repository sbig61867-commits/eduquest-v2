import { getTranslations } from 'next-intl/server'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { examRoster } from '@/lib/exam-roster'
import { EXAM_FILES_BUCKET, SIGNED_URL_SECONDS, signExamFiles } from '@/lib/exam-files'

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// GET /api/exams/results?exam_id=…  — results for one exam (teacher-owned):
// who submitted, their score, grading status, proctoring flags, plus the
// full group roster so the teacher sees who hasn't taken it yet.
export async function GET(request: Request) {
  const tc = await getTranslations('common')
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })

  const examId = new URL(request.url).searchParams.get('exam_id')
  if (!examId) return NextResponse.json({ ...(await apiErr('missingExamId')) }, { status: 400 })

  const admin = adminClient()
  const { data: exam } = await admin
    .from('exams')
    .select('*, groups(name), courses(title)')
    .eq('id', examId)
    .single()
  if (!exam || exam.teacher_id !== user.id) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }

  const maxScore = ((exam.questions as Array<{ points?: number }>) ?? [])
    .reduce((s, q) => s + (q.points ?? 0), 0)

  // The roster is the exam's group, or the students enrolled in its course.
  const [{ data: subs }, roster] = await Promise.all([
    admin.from('exam_submissions')
      // `*` so answer_files / teacher_comment come through once individual_tasks_migration is applied.
      .select('*, users:student_id(full_name, email)')
      .eq('exam_id', examId),
    examRoster(admin, exam),
  ])

  const subByStudent = new Map((subs ?? []).map(s => [s.student_id, s]))

  // Photos of handwritten answers (individual tasks): one signing round-trip
  // for the whole roster, keyed back to student + question.
  const filePairs = (subs ?? []).flatMap(s =>
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
  const results = (roster ?? []).map(r => {
    const u = r.users
    // An attempt that was started but not handed in is not a submission.
    const found = subByStudent.get(r.student_id)
    const s = found?.status === 'submitted' ? found : undefined
    // detector_unavailable = a detector failed to load on the student's
    // device (partial monitoring) — recorded for the teacher, never a violation.
    const events = ((s?.proctoring_events as Array<{ type?: string }> | null) ?? [])
      .filter(e => e?.type !== 'detector_unavailable')
    return {
      student_id: r.student_id,
      submission_id: s?.id ?? null,
      name: u?.full_name ?? tc('unknown'),
      email: u?.email ?? '',
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

  const groupName = (exam.groups as unknown as { name: string } | null)?.name
    ?? (exam.courses as unknown as { title: string } | null)?.title
    ?? '·'
  return NextResponse.json({
    title: exam.title, group_name: groupName, max_score: maxScore,
    submitted_count: (subs ?? []).filter(s => s.status === 'submitted').length, roster_count: roster.length,
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
  })
}
