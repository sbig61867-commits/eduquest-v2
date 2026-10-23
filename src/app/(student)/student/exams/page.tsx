export const dynamic = 'force-dynamic'

import { currentUser } from '@/lib/auth/current'
import { run } from '@/lib/db/sql'
import { redirect } from 'next/navigation'
import { StudentExamsClient } from './exams-client'
import { examPoliciesFrom } from '@/lib/settings'
import { withSignedAttachments } from '@/lib/exam-files'
import { studentExamListSql, toStudentExams } from '@/lib/data/student-exams'

export default async function StudentExamsPage({ searchParams }: { searchParams: Promise<{ open?: string }> }) {
  const { open: openExamId } = await searchParams
  const user = await currentUser()
  if (!user) redirect('/login')

  // The student's exam list: only the exams they are enrolled in (group or
  // course), metadata only — no questions (PERFORMANCE_CONTRACT.md P3). The
  // questions reach the exam screen from /api/exam/start once an attempt
  // starts. Students have no direct SELECT on the exams table (see
  // exam_answer_leak_fix_migration.sql).
  // ONE unit, read as the student.
  const [examList, rawSubmissions, retakePermissions, policyRows] = await run({ as: 'user', userId: user.id }, sql => [
    studentExamListSql(sql),
    sql`select exam_id, score, max_score, grading_status, teacher_comment from public.exam_submissions where student_id = ${user.id}`,
    sql`select exam_id from public.exam_retake_permissions where student_id = ${user.id}`,
    sql`select value from public.platform_settings where key = 'exam_policies'`,
  ])
  const listedExams = toStudentExams(examList)
  const policies = examPoliciesFrom((policyRows[0] as { value?: unknown } | undefined)?.value)

  // Reshape flat rows into the nested shape the client component expects.
  // Individual tasks may carry the teacher's images: private files, signed here
  // for this student (the list only ever returns their own tasks).
  const shaped = listedExams.map(row => ({
    ...row,
    groups:  row.group_name   ? { name: row.group_name }    : null,
    courses: row.course_title ? { title: row.course_title } : null,
  }))
  const exams = await withSignedAttachments(shaped)
  const submissions = (rawSubmissions as Record<string, unknown>[]).map(sub => ({
    exam_id: sub.exam_id as string,
    score: sub.score as number | null,
    max_score: sub.max_score as number | null,
    grading_status: sub.grading_status as string,
    // The teacher's review reaches the student only once grading is published.
    teacher_comment: sub.grading_status === 'published' ? ((sub.teacher_comment as string | null) ?? null) : null,
  }))

  const submittedIds    = new Set(submissions?.map(s => s.exam_id) ?? [])
  const retakeAllowedIds = new Set((retakePermissions as unknown as { exam_id: string }[]).map(r => r.exam_id))

  // A student can take an exam if: not submitted, OR has retake permission
  const availableExams = exams.filter((e: { id: string }) =>
    !submittedIds.has(e.id) || retakeAllowedIds.has(e.id)
  )
  const completedExams = exams.filter((e: { id: string }) =>
    submittedIds.has(e.id) && !retakeAllowedIds.has(e.id)
  )

  return (
    <StudentExamsClient
      availableExams={availableExams}
      completedExams={completedExams}
      submissions={submissions}
      userId={user.id}
      violationWarningThreshold={policies.violation_warning_threshold}
      openExamId={openExamId}
    />
  )
}
