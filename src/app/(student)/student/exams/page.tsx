export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { StudentExamsClient } from './exams-client'

export default async function StudentExamsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .single()

  const { data: rawExams } = await supabase
    .from('exams')
    .select('*, groups(name)')
    .eq('is_published', true)
    .order('created_at', { ascending: false })

  // Strip correct_answer from every question before sending to client.
  // Grading is done server-side in /api/exam/submit.
  const exams = (rawExams ?? []).map(exam => ({
    ...exam,
    questions: (exam.questions ?? []).map(
      ({ correct_answer: _stripped, ...rest }: Record<string, unknown>) => rest
    ),
  }))

  const { data: submissions } = await supabase
    .from('exam_submissions')
    .select('exam_id, score')
    .eq('student_id', user.id)

  const submittedIds = new Set(submissions?.map(s => s.exam_id) ?? [])

  return (
    <StudentExamsClient
      exams={exams ?? []}
      submittedIds={submittedIds}
      userId={user.id}
      tenantId={profile?.tenant_id ?? ''}
    />
  )
}
