export const dynamic = 'force-dynamic'

import { currentUser } from '@/lib/auth/current'
import { run } from '@/lib/db/sql'
import { redirect } from 'next/navigation'
import { ExamsClient } from './exams-client'
import type { TeacherExamRow } from '@/lib/data/teacher-exams'
import { examPoliciesFrom } from '@/lib/settings'

export default async function ExamsPage({ searchParams }: { searchParams: Promise<{ course?: string; kind?: string; results?: string }> }) {
  const user = await currentUser()
  if (!user) redirect('/login')
  const { course, kind, results } = await searchParams

  const [exams, individual, groupRows, courseRows, policyRows] = await run({ as: 'user', userId: user.id }, sql => [
    // Formal (proctorable) exams, plus course quizzes and tasks. Lesson
    // homework (type homework on a group) lives in the lesson's الواجب tab and
    // must never appear or be created here.
    // Named columns + question_count — never the questions.
    sql`select e.id, e.title, e.duration_minutes, e.is_published, e.proctoring_enabled, e.created_at, e.type, e.ends_at,
               e.assigned_student_id, public.question_count(e) as question_count,
               case when g.id is null then null else json_build_object('name', g.name) end as groups,
               case when c.id is null then null else json_build_object('title', c.title) end as courses
          from public.exams e left join public.groups g on g.id = e.group_id left join public.courses c on c.id = e.course_id
         where e.teacher_id = ${user.id} and (e.type = 'exam' or e.course_id is not null) and e.deleted_at is null
         order by e.created_at desc limit 1000`,
    // Individual follow-up tasks (one student each), so they can be opened and graded here.
    sql`select e.id, e.title, e.duration_minutes, e.is_published, e.proctoring_enabled, e.created_at, e.type, e.ends_at,
               e.assigned_student_id, public.question_count(e) as question_count,
               case when g.id is null then null else json_build_object('name', g.name) end as groups,
               json_build_object('full_name', a.full_name) as assignee
          from public.exams e left join public.groups g on g.id = e.group_id left join public.users a on a.id = e.assigned_student_id
         where e.teacher_id = ${user.id} and e.assigned_student_id is not null and e.deleted_at is null
         order by e.created_at desc limit 1000`,
    sql`select id, name from public.groups where teacher_id = ${user.id} order by name limit 500`,
    sql`select id, title from public.courses where teacher_id = ${user.id} and deleted_at is null order by title limit 500`,
    sql`select value from public.platform_settings where key = 'exam_policies'`,
  ])
  const groups = groupRows as unknown as { id: string; name: string }[]
  const courses = courseRows as unknown as { id: string; title: string }[]
  const policies = examPoliciesFrom((policyRows[0] as { value?: unknown } | undefined)?.value)

  // The course builder links here to create a quiz or task for one course.
  const openFor = course && courses.some(c => c.id === course)
    ? { courseId: course, kind: kind === 'homework' ? 'homework' as const : 'exam' as const }
    : undefined

  const all = ([...exams, ...individual] as unknown as TeacherExamRow[])
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))

  return (
    <ExamsClient
      initialExams={all}
      openResultsFor={results && all.some(e => e.id === results) ? results : undefined}
      groups={groups}
      courses={courses}
      openFor={openFor}
      proctoringDefault={policies.proctoring_default_enabled}
    />
  )
}
