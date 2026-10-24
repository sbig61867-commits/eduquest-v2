export const dynamic = 'force-dynamic'

import { currentUser } from '@/lib/auth/current'
import { run } from '@/lib/db/sql'
import { redirect, notFound } from 'next/navigation'
import { CourseBuildClient } from './course-build-client'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function CourseBuildPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await currentUser()
  if (!user) redirect('/login')

  // One round-trip instead of four in a row (perf audit 2026-09-30): the
  // course, both possible content shapes and its assessments. Nothing is shown
  // unless the course is this teacher's own.
  if (!UUID.test(id)) notFound()
  const [courses, levelRows, flatRows, assessments] = await run({ as: 'user', userId: user.id }, sql => [
    sql`select id, title, description, language, has_levels, is_published, tenant_id
          from public.courses where id = ${id} and teacher_id = ${user.id}`,
    sql`select l.id, l.title, l.order_index, l.is_published,
               coalesce((select json_agg(json_build_object('id', u.id, 'title', u.title, 'order_index', u.order_index,
                                  'is_published', u.is_published, 'level_id', u.level_id,
                                  'unit_items', coalesce((select json_agg(json_build_object('id', i.id, 'title', i.title, 'type', i.type, 'order_index', i.order_index,
                         'is_published', i.is_published, 'content', i.content) order by i.order_index)
                    from public.unit_items i where i.unit_id = u.id), '[]')) order by u.order_index)
                           from public.course_units u where u.level_id = l.id), '[]') as course_units
          from public.course_levels l
         where l.course_id = ${id} and exists (select 1 from public.courses c where c.id = ${id} and c.teacher_id = ${user.id})
         order by l.order_index`,
    sql`select u.id, u.title, u.order_index, u.is_published, u.level_id, coalesce((select json_agg(json_build_object('id', i.id, 'title', i.title, 'type', i.type, 'order_index', i.order_index,
                         'is_published', i.is_published, 'content', i.content) order by i.order_index)
                    from public.unit_items i where i.unit_id = u.id), '[]') as unit_items
          from public.course_units u
         where u.course_id = ${id} and u.level_id is null
           and exists (select 1 from public.courses c where c.id = ${id} and c.teacher_id = ${user.id})
         order by u.order_index`,
    // Quizzes and tasks created for this course on the exams page — a quiz or
    // task item links to one of them (unit_items.content.exam_id).
    sql`select id, title, type, is_published from public.exams
         where course_id = ${id} and teacher_id = ${user.id} and deleted_at is null
         order by created_at desc limit 500`,
  ])
  type P = Parameters<typeof CourseBuildClient>[0]
  const course = courses[0] as unknown as P['course'] | undefined
  if (!course) notFound()

  const levels = course.has_levels ? levelRows : null
  const flatUnits = course.has_levels ? null : flatRows

  return (
    <CourseBuildClient
      course={course}
      initialLevels={(levels ?? []) as unknown as P['initialLevels']}
      initialFlatUnits={(flatUnits ?? []) as unknown as P['initialFlatUnits']}
      assessments={assessments as unknown as P['assessments']}
    />
  )
}
