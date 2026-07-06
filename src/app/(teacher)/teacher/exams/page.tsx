export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ExamsClient } from './exams-client'
import { getExamPolicies } from '@/lib/settings'

export default async function ExamsPage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')

  const [{ data: exams }, { data: groups }, policies] = await Promise.all([
    // Formal (proctorable) exams only — lesson homework lives in the
    // lesson's الواجب tab and must never appear or be created here.
    supabase.from('exams').select('*, groups(name)').eq('teacher_id', user.id).eq('type', 'exam').order('created_at', { ascending: false }),
    supabase.from('groups').select('id, name').eq('teacher_id', user.id),
    getExamPolicies(supabase),
  ])

  return <ExamsClient initialExams={exams ?? []} groups={groups ?? []} proctoringDefault={policies.proctoring_default_enabled} />
}
