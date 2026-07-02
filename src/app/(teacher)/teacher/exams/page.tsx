export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ExamsClient } from './exams-client'
import { getExamPolicies } from '@/lib/settings'

export default async function ExamsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: exams }, { data: groups }, policies] = await Promise.all([
    supabase.from('exams').select('*, groups(name)').eq('teacher_id', user.id).order('created_at', { ascending: false }),
    supabase.from('groups').select('id, name').eq('teacher_id', user.id),
    getExamPolicies(supabase),
  ])

  return <ExamsClient initialExams={exams ?? []} groups={groups ?? []} proctoringDefault={policies.proctoring_default_enabled} />
}
