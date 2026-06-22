export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { LessonsClient } from './lessons-client'

export default async function LessonsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const [{ data: lessons }, { data: groups }] = await Promise.all([
    supabase.from('lessons').select('*, groups(name)').eq('teacher_id', user?.id ?? '').order('created_at', { ascending: false }),
    supabase.from('groups').select('id, name').eq('teacher_id', user?.id ?? ''),
  ])

  return <LessonsClient initialLessons={lessons ?? []} groups={groups ?? []} />
}
