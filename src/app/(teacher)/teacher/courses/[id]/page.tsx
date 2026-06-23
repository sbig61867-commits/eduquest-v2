export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { CourseBuildClient } from './course-build-client'

export default async function CourseBuildPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: course } = await supabase
    .from('courses')
    .select('*')
    .eq('id', id)
    .eq('teacher_id', user.id)
    .single()

  if (!course) notFound()

  const { data: levels } = course.has_levels
    ? await supabase
        .from('course_levels')
        .select('*, course_units(*, unit_items(*))')
        .eq('course_id', id)
        .order('order_index')
    : { data: null }

  const { data: flatUnits } = !course.has_levels
    ? await supabase
        .from('course_units')
        .select('*, unit_items(*)')
        .eq('course_id', id)
        .is('level_id', null)
        .order('order_index')
    : { data: null }

  return (
    <CourseBuildClient
      course={course}
      initialLevels={levels ?? []}
      initialFlatUnits={flatUnits ?? []}
    />
  )
}
