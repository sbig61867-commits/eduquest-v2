export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { CourseBuildClient } from './course-build-client'

export default async function CourseBuildPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')

  // One round-trip instead of four in a row (perf audit 2026-09-30): the
  // course, both possible content shapes and its assessments. Nothing is shown
  // unless the course is this teacher's own.
  const [{ data: course }, { data: levelRows }, { data: flatRows }, { data: assessments }] = await Promise.all([
    supabase.from('courses').select('*').eq('id', id).eq('teacher_id', user.id).single(),
    supabase.from('course_levels').select('*, course_units(*, unit_items(*))').eq('course_id', id).order('order_index'),
    supabase.from('course_units').select('*, unit_items(*)').eq('course_id', id).is('level_id', null).order('order_index'),
    // Quizzes and tasks created for this course on the exams page — a quiz or
    // task item links to one of them (unit_items.content.exam_id).
    supabase.from('exams').select('id, title, type, is_published')
      .eq('course_id', id).eq('teacher_id', user.id).is('deleted_at', null)
      .order('created_at', { ascending: false }),
  ])

  if (!course) notFound()

  const levels = course.has_levels ? levelRows : null
  const flatUnits = course.has_levels ? null : flatRows

  return (
    <CourseBuildClient
      course={course}
      initialLevels={levels ?? []}
      initialFlatUnits={flatUnits ?? []}
      assessments={assessments ?? []}
    />
  )
}
