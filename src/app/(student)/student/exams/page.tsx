export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { StudentExamsClient } from './exams-client'

export default async function StudentExamsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Get student's enrolled group IDs
  const { data: groupRows } = await supabase
    .from('group_students')
    .select('group_id')
    .eq('student_id', user.id)

  // Get student's enrolled course IDs
  const { data: courseRows } = await supabase
    .from('course_enrollments')
    .select('course_id')
    .eq('student_id', user.id)

  const groupIds  = (groupRows  ?? []).map(r => r.group_id)
  const courseIds = (courseRows ?? []).map(r => r.course_id)

  // Fetch exams only for groups/courses the student is enrolled in
  let rawExams: any[] = []

  if (groupIds.length > 0) {
    const { data } = await supabase
      .from('exams')
      .select('*, groups(name)')
      .eq('is_published', true)
      .in('group_id', groupIds)
      .order('created_at', { ascending: false })
    rawExams = [...rawExams, ...(data ?? [])]
  }

  if (courseIds.length > 0) {
    const { data } = await supabase
      .from('exams')
      .select('*, courses(title)')
      .eq('is_published', true)
      .in('course_id', courseIds)
      .order('created_at', { ascending: false })
    rawExams = [...rawExams, ...(data ?? [])]
  }

  // Strip correct_answer before sending to client — grading is server-side
  const exams = rawExams.map(exam => ({
    ...exam,
    questions: (exam.questions ?? []).map(
      ({ correct_answer: _stripped, ...rest }: Record<string, unknown>) => rest
    ),
  }))

  // Get submissions + retake permissions
  const { data: submissions } = await supabase
    .from('exam_submissions')
    .select('exam_id, score, grading_status')
    .eq('student_id', user.id)

  const { data: retakePermissions } = await supabase
    .from('exam_retake_permissions')
    .select('exam_id')
    .eq('student_id', user.id)

  const submittedIds    = new Set(submissions?.map(s => s.exam_id) ?? [])
  const retakeAllowedIds = new Set(retakePermissions?.map(r => r.exam_id) ?? [])

  // A student can take an exam if: not submitted, OR has retake permission
  const availableExams = exams.filter(e =>
    !submittedIds.has(e.id) || retakeAllowedIds.has(e.id)
  )
  const completedExams = exams.filter(e =>
    submittedIds.has(e.id) && !retakeAllowedIds.has(e.id)
  )

  return (
    <StudentExamsClient
      availableExams={availableExams}
      completedExams={completedExams}
      submissions={submissions ?? []}
      userId={user.id}
    />
  )
}
