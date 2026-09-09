export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { PageTitle } from '@/components/shared/page-title'
import { CoursePlayerClient, type PlayerLevel, type PlayerUnit } from './course-player-client'

interface RawItem {
  id: string
  type: string
  title: string
  content: { body?: string } | null
  order_index: number
  is_published: boolean
}

interface RawUnit {
  id: string
  title: string
  order_index: number
  is_published: boolean
  unit_items: RawItem[] | null
}

interface RawLevel {
  id: string
  title: string
  order_index: number
  is_published: boolean
  course_units: RawUnit[] | null
}

const byOrder = <T extends { order_index: number }>(a: T, b: T) => a.order_index - b.order_index

/** Drops unpublished units/items so a student never sees draft content. */
function toPlayerUnits(units: RawUnit[] | null): PlayerUnit[] {
  return (units ?? [])
    .filter(u => u.is_published)
    .sort(byOrder)
    .map(u => ({
      id: u.id,
      title: u.title,
      items: (u.unit_items ?? [])
        .filter(i => i.is_published)
        .sort(byOrder)
        .map(i => ({
          id: i.id,
          type: i.type,
          title: i.title,
          body: typeof i.content?.body === 'string' ? i.content.body : '',
        })),
    }))
    .filter(u => u.items.length > 0)
}

export default async function StudentCoursePlayerPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')

  // Enrolment is the gate — RLS scopes to the tenant, this scopes to the student.
  const { data: enrolment } = await supabase
    .from('course_enrollments')
    .select('course_id')
    .eq('course_id', id)
    .eq('student_id', user.id)
    .maybeSingle()

  if (!enrolment) notFound()

  const { data: course } = await supabase
    .from('courses')
    .select('id, title, description, language, has_levels, is_published, users!courses_teacher_id_fkey(full_name)')
    .eq('id', id)
    .eq('is_published', true)
    .maybeSingle()

  if (!course) notFound()

  let levels: PlayerLevel[] = []

  if (course.has_levels) {
    const { data } = await supabase
      .from('course_levels')
      .select('id, title, order_index, is_published, course_units(id, title, order_index, is_published, unit_items(id, type, title, content, order_index, is_published))')
      .eq('course_id', id)
      .order('order_index')

    levels = ((data ?? []) as unknown as RawLevel[])
      .filter(l => l.is_published)
      .sort(byOrder)
      .map(l => ({ id: l.id, title: l.title, units: toPlayerUnits(l.course_units) }))
      .filter(l => l.units.length > 0)
  } else {
    const { data } = await supabase
      .from('course_units')
      .select('id, title, order_index, is_published, unit_items(id, type, title, content, order_index, is_published)')
      .eq('course_id', id)
      .is('level_id', null)
      .order('order_index')

    const units = toPlayerUnits((data ?? []) as unknown as RawUnit[])
    if (units.length > 0) levels = [{ id: 'flat', title: '', units }]
  }

  const itemIds = levels.flatMap(l => l.units.flatMap(u => u.items.map(i => i.id)))

  const { data: progressRows } = itemIds.length > 0
    ? await supabase
        .from('student_progress')
        .select('unit_item_id')
        .eq('student_id', user.id)
        .in('unit_item_id', itemIds)
    : { data: [] }

  const teacher = (course.users as unknown as { full_name: string } | null)?.full_name ?? null

  const { data: profile } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .single()

  if (!profile?.tenant_id) notFound()

  return (
    <>
      <PageTitle title={course.title} />
      <CoursePlayerClient
        course={{
          id: course.id,
          title: course.title,
          description: course.description,
          language: course.language,
          teacherName: teacher,
        }}
        levels={levels}
        completedIds={(progressRows ?? []).map(r => r.unit_item_id as string)}
        studentId={user.id}
        tenantId={profile.tenant_id}
      />
    </>
  )
}
