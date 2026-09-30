export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { PageTitle } from '@/components/shared/page-title'
import { getExamPolicies } from '@/lib/settings'
import type { Exam } from '@/types'
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
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')

  // One round-trip for everything that does not depend on anything else — the
  // gate, the course, the profile and both possible content shapes — instead
  // of five in a row (perf audit 2026-09-30). Every read is RLS-scoped, and
  // nothing is rendered until the enrolment gate below has passed.
  const [{ data: enrolment }, { data: course }, { data: profile }, { data: levelRows }, { data: flatUnits }] = await Promise.all([
    // Enrolment is the gate — RLS scopes to the tenant, this scopes to the student.
    supabase.from('course_enrollments').select('course_id').eq('course_id', id).eq('student_id', user.id).maybeSingle(),
    supabase.from('courses')
      .select('id, title, description, language, has_levels, is_published, users!courses_teacher_id_fkey(full_name)')
      .eq('id', id).eq('is_published', true).maybeSingle(),
    supabase.from('users').select('tenant_id').eq('id', user.id).single(),
    supabase.from('course_levels')
      .select('id, title, order_index, is_published, course_units(id, title, order_index, is_published, unit_items(id, type, title, content, order_index, is_published))')
      .eq('course_id', id).order('order_index'),
    supabase.from('course_units')
      .select('id, title, order_index, is_published, unit_items(id, type, title, content, order_index, is_published)')
      .eq('course_id', id).is('level_id', null).order('order_index'),
  ])

  if (!enrolment) notFound()
  if (!course) notFound()

  let levels: PlayerLevel[] = []

  if (course.has_levels) {
    levels = ((levelRows ?? []) as unknown as RawLevel[])
      .filter(l => l.is_published)
      .sort(byOrder)
      .map(l => ({ id: l.id, title: l.title, units: toPlayerUnits(l.course_units) }))
      .filter(l => l.units.length > 0)
  } else {
    const units = toPlayerUnits((flatUnits ?? []) as unknown as RawUnit[])
    if (units.length > 0) levels = [{ id: 'flat', title: '', units }]
  }

  const items = levels.flatMap(l => l.units.flatMap(u => u.items))
  const itemIds = items.map(i => i.id)
  const linkedExamIds = [...new Set(items.flatMap(i => (i.examId ? [i.examId] : [])))]

  // Quiz and task items run on the exam engine. get_student_exams is the only
  // way a student reads an exam: it returns published exams of their groups
  // and courses with correct_answer stripped. Anything it does not return
  // (unpublished, another course's exam) simply shows as not available.
  const [{ data: progressRows }, { data: feed }, { data: subs }, policies] = await Promise.all([
    itemIds.length > 0
      ? supabase.from('student_progress').select('unit_item_id').eq('student_id', user.id).in('unit_item_id', itemIds)
      : Promise.resolve({ data: [] as { unit_item_id: string }[] }),
    linkedExamIds.length > 0 ? supabase.rpc('get_student_exams') : Promise.resolve({ data: [] }),
    linkedExamIds.length > 0
      ? supabase.from('exam_submissions').select('exam_id, status, score, max_score, grading_status').eq('student_id', user.id).in('exam_id', linkedExamIds)
      : Promise.resolve({ data: [] as { exam_id: string; status: string; score: number | null; max_score: number | null; grading_status: string }[] }),
    getExamPolicies(supabase),
  ])

  type FeedRow = Exam & { course_id: string | null; group_name: string | null; course_title: string | null }
  const subByExam = new Map((subs ?? []).map(sub => [sub.exam_id, sub]))
  const assessments: Record<string, PlayerAssessment> = {}
  for (const row of (feed ?? []) as FeedRow[]) {
    if (!linkedExamIds.includes(row.id) || row.course_id !== id) continue
    const sub = subByExam.get(row.id)
    assessments[row.id] = {
      exam: { ...row, questions: row.questions ?? [] },
      submission: sub ? { status: sub.status, score: sub.score, maxScore: sub.max_score, gradingStatus: sub.grading_status } : null,
    }
  }

  // A quiz or task item is done once its attempt is handed in, wherever it
  // was handed in (the course player or the exams page). Items whose progress
  // row is still missing are passed on so the player records them, which keeps
  // course progress (get_course_progress, the teacher's records) in step.
  const progressIds = new Set((progressRows ?? []).map(r => r.unit_item_id as string))
  const submittedItemIds = items
    .filter(i => i.examId && assessments[i.examId]?.submission?.status === 'submitted')
    .map(i => i.id)

  const teacher = (course.users as unknown as { full_name: string } | null)?.full_name ?? null

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
