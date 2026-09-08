export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { LessonsClient } from './lessons-client'
import { PageTitle } from '@/components/shared/page-title'

export default async function LessonsPage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')

  const [{ data: lessons }, { data: groups }] = await Promise.all([
    supabase.from('lessons').select('*, groups(name)').eq('teacher_id', user.id).order('created_at', { ascending: false }),
    supabase.from('groups').select('id, name').eq('teacher_id', user.id),
  ])

  return (
    <>
      <PageTitle title="Lessons" />
      <LessonsClient initialLessons={lessons ?? []} groups={groups ?? []} />
    </>
  )
}
