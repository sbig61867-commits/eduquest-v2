export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ExamsClient } from './exams-client'

export default async function ExamsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: exams }, { data: groups }] = await Promise.all([
    supabase.from('exams').select('*, groups(name)').eq('teacher_id', user.id).order('created_at', { ascending: false }),
    supabase.from('groups').select('id, name').eq('teacher_id', user.id),
  ])

  return <ExamsClient initialExams={exams ?? []} groups={groups ?? []} />
}
