export const dynamic = 'force-dynamic'

import { currentUser } from '@/lib/auth/current'
import { run, maybeOne } from '@/lib/db/sql'
import { redirect, notFound } from 'next/navigation'
import { PageTitle } from '@/components/shared/page-title'
import { examPoliciesFrom } from '@/lib/settings'
import { studentExamListSql, toStudentExams } from '@/lib/data/student-exams'
import { CoursePlayerClient, type PlayerAssessment, type PlayerLevel, type PlayerUnit } from './course-player-client'

interface RawItem {
  id: string
  type: string
  title: string
  content: { body?: string; exam_id?: string; video_url?: string } | null
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
          examId: typeof i.content?.exam_id === 'string' ? i.content.exam_id : null,
          videoUrl: typeof i.content?.video_url === 'string' ? i.content.video_url : null,
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
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound()
  const user = await currentUser()
  if (!user) redirect('/login')

  // ONE unit, read as the student (RLS-scoped): the enrolment gate, the course,
  // the student's institution, the course's levels / units / items (flat; put
  // together below), their progress on this course's items, the exam list
  // (quiz and task items run on the exam engine; it is the only way a student
  // reads an exam — metadata only), their attempts at this course's exams and
  // the exam policies. Nothing is rendered until the enrolment gate has passed.
  const [enrolment, courseRows, profileRows, levelRows, unitRows, itemRows, progressRows, examList, subRows, policyRows] =
    await run({ as: 'user', userId: user.id }, sql => [
      sql`select course_id from public.course_enrollments where course_id = ${id} and student_id = ${user.id}`,
      sql`select c.id, c.title, c.description, c.language, c.has_levels, t.full_name as teacher_name
            from public.courses c left join public.users t on t.id = c.teacher_id where c.id = ${id} and c.is_published`,
      sql`select tenant_id from public.users where id = ${user.id}`,
      sql`select id, title, order_index, is_published from public.course_levels where course_id = ${id}`,
      sql`select id, level_id, title, order_index, is_published from public.course_units where course_id = ${id}`,
      sql`select id, unit_id, type, title, content, order_index, is_published from public.unit_items where course_id = ${id}`,
      sql`select unit_item_id from public.student_progress
           where student_id = ${user.id} and unit_item_id in (select id from public.unit_items where course_id = ${id})`,
      studentExamListSql(sql),
      sql`select exam_id, status, score, max_score, grading_status from public.exam_submissions
           where student_id = ${user.id}
             and exam_id::text in (select content->>'exam_id' from public.unit_items where course_id = ${id} and content ? 'exam_id')`,
      sql`select value from public.platform_settings where key = 'exam_policies'`,
    ])

  if (!maybeOne(enrolment)) notFound()
  const course = maybeOne<{ id: string; title: string; description: string | null; language: string | null; has_levels: boolean; teacher_name: string | null }>(courseRows)
  if (!course) notFound()
  const profile = maybeOne<{ tenant_id: string | null }>(profileRows)
  const policies = examPoliciesFrom((policyRows[0] as { value?: unknown } | undefined)?.value)

  // Put the course together: items under their unit, units under their level.
  const itemsByUnit = new Map<string, RawItem[]>()
  for (const i of itemRows as unknown as (RawItem & { unit_id: string })[]) {
    const bucket = itemsByUnit.get(i.unit_id)
    if (bucket) bucket.push(i); else itemsByUnit.set(i.unit_id, [i])
  }
  const allUnits = (unitRows as unknown as (Omit<RawUnit, 'unit_items'> & { level_id: string | null })[])
    .map(u => ({ ...u, unit_items: itemsByUnit.get(u.id) ?? [] }))

  let levels: PlayerLevel[] = []
  if (course.has_levels) {
    levels = (levelRows as unknown as Omit<RawLevel, 'course_units'>[])
      .filter(l => l.is_published)
      .sort(byOrder)
      .map(l => ({ id: l.id, title: l.title, units: toPlayerUnits(allUnits.filter(u => u.level_id === l.id)) }))
      .filter(l => l.units.length > 0)
  } else {
    const units = toPlayerUnits(allUnits.filter(u => u.level_id === null))
    if (units.length > 0) levels = [{ id: 'flat', title: '', units }]
  }

  const items = levels.flatMap(l => l.units.flatMap(u => u.items))
  const linkedExamIds = [...new Set(items.flatMap(i => (i.examId ? [i.examId] : [])))]
  // Anything the exam list does not return (unpublished, another course's
  // exam) simply shows as not available.
  const feed = linkedExamIds.length > 0 ? toStudentExams(examList) : []
  const subs = subRows as unknown as { exam_id: string; status: string; score: number | null; max_score: number | null; grading_status: string }[]
  const subByExam = new Map(subs.map(sub => [sub.exam_id, sub]))
  const assessments: Record<string, PlayerAssessment> = {}
  for (const row of feed) {
    if (!linkedExamIds.includes(row.id) || row.course_id !== id) continue
    const sub = subByExam.get(row.id)
    assessments[row.id] = {
      exam: row,
      submission: sub ? { status: sub.status, score: sub.score, maxScore: sub.max_score, gradingStatus: sub.grading_status } : null,
    }
  }

  // A quiz or task item is done once its attempt is handed in, wherever it
  // was handed in (the course player or the exams page). Items whose progress
  // row is still missing are passed on so the player records them, which keeps
  // course progress (get_course_progress, the teacher's records) in step.
  const progressIds = new Set((progressRows as unknown as { unit_item_id: string }[]).map(r => r.unit_item_id))
  const submittedItemIds = items
    .filter(i => i.examId && assessments[i.examId]?.submission?.status === 'submitted')
    .map(i => i.id)

  const teacher = course.teacher_name

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
        completedIds={[...new Set([...progressIds, ...submittedItemIds])]}
        unsyncedIds={submittedItemIds.filter(itemId => !progressIds.has(itemId))}
        assessments={assessments}
        violationWarningThreshold={policies.violation_warning_threshold}
        studentId={user.id}
        tenantId={profile.tenant_id}
      />
    </>
  )
}
