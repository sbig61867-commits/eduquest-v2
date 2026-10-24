export const dynamic = 'force-dynamic'

import { currentUser } from '@/lib/auth/current'
import { run } from '@/lib/db/sql'
import { redirect } from 'next/navigation'
import { LessonsClient } from './lessons-client'
import { loadTeacherLessons } from '@/lib/data/teacher-lessons'

export default async function LessonsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const user = await currentUser()
  if (!user) redirect('/login')

  // One page of lessons with a short excerpt each — the lesson bodies stay on
  // the server; «Edit» reads one lesson's content on demand.
  const [{ data: lessons, error }, { data: groups }] = await Promise.all([
    loadTeacherLessons(user.id, (await searchParams).page),
    run({ as: 'user', userId: user.id }, sql => [sql`select id, name from public.groups where teacher_id = ${user.id} order by name limit 500`])
      .then(([rows]) => ({ data: rows as unknown as { id: string; name: string }[] })),
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
