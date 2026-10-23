import { run } from '@/lib/db/sql'
import { studentExamListSql, toStudentExams } from '@/lib/data/student-exams'
import { buildNudges, buildStudyPlan, type Nudge, type NudgeExam, type PlanItem } from '@/lib/assistant/nudges'

/**
 * What the study assistant's orb shows: nudges, a two-week plan and the lessons
 * it can summarise (PERFORMANCE_CONTRACT.md: named columns, bounded lists, no N+1).
 *
 * ONE unit, read as the student, so RLS decides what is visible — the same
 * rows the student already sees on their pages: the exam list, the latest
 * lessons of their active groups, the announcements, their submitted attempts
 * and the titles of lessons linked from their homework.
 */

export const ASSISTANT_LESSON_LIMIT = 20
const EXAM_LIMIT = 50

export interface AssistantLesson { id: string; title: string; created_at: string }

export interface AssistantBriefing {
  nudges: Nudge[]
  plan: PlanItem[]
  lessons: AssistantLesson[]
}

export async function loadAssistantBriefing(
  userId: string,
  now: Date = new Date(),
): Promise<{ data: AssistantBriefing; error: { message: string } | null }> {
  let rows: unknown[][]
  try {
    rows = await run({ as: 'user', userId }, sql => [
      studentExamListSql(sql),
      sql`select l.id, l.title, l.created_at from public.lessons l join public.groups g on g.id = l.group_id
           where l.is_published and l.deleted_at is null and g.is_active
           order by l.created_at desc limit ${ASSISTANT_LESSON_LIMIT}`,
      sql`select id, title, created_at from public.get_student_announcements() limit 20`,
      // UNIQUE(exam_id, student_id): at most one row per listed exam.
      sql`select exam_id from public.exam_submissions where student_id = ${userId} and status = 'submitted' limit 5000`,
      // Titles of the lessons the student's homework points at.
      sql`select l.id, l.title from public.lessons l
           where l.is_published and l.deleted_at is null
             and l.id in (select e.lesson_id from public.get_student_exam_list() e where e.lesson_id is not null)
           limit ${EXAM_LIMIT}`,
    ])
  } catch (e) {
    const empty = { nudges: [], plan: [], lessons: [] }
    return { data: empty, error: { message: e instanceof Error ? e.message : String(e) } }
  }

  const exams: NudgeExam[] = toStudentExams(rows[0])
    .filter(e => e.is_published)
    .slice(0, EXAM_LIMIT)
    .map(e => ({ id: e.id, title: e.title, type: e.type, starts_at: e.starts_at, ends_at: e.ends_at, lesson_id: e.lesson_id }))
  const lessons = rows[1] as unknown as AssistantLesson[]
  const announcements = rows[2] as unknown as { id: string; title: string; created_at: string }[]
  const listed = new Set(exams.map(e => e.id))
  const lessonTitles: Record<string, string> = Object.fromEntries(lessons.map(l => [l.id, l.title]))
  for (const l of rows[4] as unknown as { id: string; title: string }[]) lessonTitles[l.id] ??= l.title

  const input = {
    now,
    exams,
    submittedExamIds: new Set((rows[3] as unknown as { exam_id: string }[]).map(s => s.exam_id).filter(id => listed.has(id))),
    lessons,
    announcements,
    lessonTitles,
  }
  return { data: { nudges: buildNudges(input), plan: buildStudyPlan(input), lessons }, error: null }
}
