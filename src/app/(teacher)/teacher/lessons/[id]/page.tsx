export const dynamic = 'force-dynamic'

import { currentUser } from '@/lib/auth/current'
import { run } from '@/lib/db/sql'
import { redirect, notFound } from 'next/navigation'
import { LessonDetailClient } from './lesson-detail-client'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function LessonDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await currentUser()
  if (!user) redirect('/login')

  if (!UUID.test(id)) notFound()
  const [lessons, homework, groups] = await run({ as: 'user', userId: user.id }, sql => [
    sql`select l.id, l.title, l.content, l.is_published,
               case when g.id is null then null else json_build_object('id', g.id, 'name', g.name) end as groups
          from public.lessons l left join public.groups g on g.id = l.group_id
         where l.id = ${id} and l.teacher_id = ${user.id}`,
    sql`select e.id, e.title, e.is_published, e.questions, e.ends_at,
               json_build_array(json_build_object('count', (select count(*)::int from public.exam_submissions s where s.exam_id = e.id))) as exam_submissions
          from public.exams e
         where e.lesson_id = ${id} and e.type = 'homework' and e.teacher_id = ${user.id}
         order by e.created_at limit 200`,
    sql`select id, name from public.groups where teacher_id = ${user.id} order by name limit 500`,
  ])
  type P = Parameters<typeof LessonDetailClient>[0]
  const lesson = lessons[0] as unknown as P['lesson'] | undefined
  if (!lesson) notFound()

  return (
    <LessonDetailClient
      lesson={lesson}
      initialHomework={homework as unknown as P['initialHomework']}
      groups={groups as unknown as P['groups']}
    />
  )
}
