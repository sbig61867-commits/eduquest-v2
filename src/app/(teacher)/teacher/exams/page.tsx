export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ExamsClient } from './exams-client'
import { TEACHER_EXAM_COLUMNS, type TeacherExamRow } from '@/lib/data/teacher-exams'
import { getExamPolicies } from '@/lib/settings'

export default async function ExamsPage({ searchParams }: { searchParams: Promise<{ course?: string; kind?: string; results?: string }> }) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')
  const { course, kind, results } = await searchParams

  const [{ data: exams }, { data: individual }, { data: groups }, { data: courses }, policies] = await Promise.all([
    // Formal (proctorable) exams, plus course quizzes and tasks. Lesson
    // homework (type homework on a group) lives in the lesson's الواجب tab and
    // must never appear or be created here.
    // Named columns + question_count (a computed field) — never the questions.
    supabase.from('exams').select(`${TEACHER_EXAM_COLUMNS}, groups(name), courses(title)`).eq('teacher_id', user.id)
      .or('type.eq.exam,course_id.not.is.null').is('deleted_at', null)
      .order('created_at', { ascending: false }),
    // Individual follow-up tasks (one student each), so they can be opened and
    // graded here. A separate query: before individual_tasks_migration is
    // applied the column does not exist, this one fails alone and the page
    // still lists everything else.
    supabase.from('exams').select(`${TEACHER_EXAM_COLUMNS}, groups(name), assignee:users!exams_assigned_student_id_fkey(full_name)`)
      .eq('teacher_id', user.id).not('assigned_student_id', 'is', null).is('deleted_at', null)
      .order('created_at', { ascending: false }),
    supabase.from('groups').select('id, name').eq('teacher_id', user.id),
    supabase.from('courses').select('id, title').eq('teacher_id', user.id).is('deleted_at', null).order('title'),
    getExamPolicies(supabase),
  ])

  // The course builder links here to create a quiz or task for one course.
  const openFor = course && (courses ?? []).some(c => c.id === course)
    ? { courseId: course, kind: kind === 'homework' ? 'homework' as const : 'exam' as const }
    : undefined

  const all = ([...(exams ?? []), ...(individual ?? [])] as unknown as TeacherExamRow[])
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))

  return (
    <ExamsClient
      initialExams={all}
      openResultsFor={results && all.some(e => e.id === results) ? results : undefined}
      groups={groups ?? []}
      courses={courses ?? []}
      openFor={openFor}
      proctoringDefault={policies.proctoring_default_enabled}
    />
  )
}
