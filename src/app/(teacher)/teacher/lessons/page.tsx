export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { LessonsClient } from './lessons-client'
import { loadTeacherLessons } from '@/lib/data/teacher-lessons'

export default async function LessonsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')

  // One page of lessons with a short excerpt each — the lesson bodies stay on
  // the server; «Edit» reads one lesson's content on demand.
  const [{ data: lessons, error }, { data: groups }] = await Promise.all([
    loadTeacherLessons(supabase, user.id, (await searchParams).page),
    supabase.from('groups').select('id, name').eq('teacher_id', user.id),
  ])
  if (error) console.error('[teacher/lessons]', error)

  return (
    <LessonsClient
      initialLessons={lessons.rows}
      groups={groups ?? []}
      pagination={{ page: lessons.page, pageCount: lessons.pageCount, total: lessons.total }}
    />
  )
}
