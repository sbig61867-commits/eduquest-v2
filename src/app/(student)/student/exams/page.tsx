export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { StudentExamsClient } from './exams-client'
import { getExamPolicies } from '@/lib/settings'

export default async function StudentExamsPage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')

  // Fetch enrolled exams via the SECURITY DEFINER RPC. It returns only the
  // exams the student is enrolled in (group or course) and strips
  // correct_answer server-side, so answers never reach the client. Students
  // have no direct SELECT on the exams table (see exam_answer_leak_fix_migration.sql).
  const [{ data: rpcExams }, { data: submissions }, { data: retakePermissions }, policies] = await Promise.all([
    supabase.rpc('get_student_exams'),
    supabase.from('exam_submissions').select('exam_id, score, max_score, grading_status').eq('student_id', user.id),
    supabase.from('exam_retake_permissions').select('exam_id').eq('student_id', user.id),
    getExamPolicies(supabase),
  ])

  type RpcExamRow = { id: string; title: string; created_at: string; questions: unknown[]; group_name: string | null; course_title: string | null; [key: string]: unknown }
  // Reshape flat RPC rows into the nested shape the client component expects.
  const exams = (rpcExams ?? []).map((row: RpcExamRow) => ({
    ...row,
    questions: row.questions ?? [],
    groups:  row.group_name   ? { name: row.group_name }    : null,
    courses: row.course_title ? { title: row.course_title } : null,
  }))

  const submittedIds    = new Set(submissions?.map(s => s.exam_id) ?? [])
  const retakeAllowedIds = new Set(retakePermissions?.map(r => r.exam_id) ?? [])

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
      submissions={submissions ?? []}
      userId={user.id}
      violationWarningThreshold={policies.violation_warning_threshold}
    />
  )
}
