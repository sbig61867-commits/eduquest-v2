import type { SupabaseClient } from '@supabase/supabase-js'
import { loadStudentExamList } from '@/lib/data/student-exams'
import { buildNudges, buildStudyPlan, type Nudge, type NudgeExam, type PlanItem } from '@/lib/assistant/nudges'

/**
 * What the study assistant's orb shows: nudges, a two-week plan and the lessons
 * it can summarise (PERFORMANCE_CONTRACT.md: named columns, bounded lists, no N+1).
 *
 * Every read goes through the student's own session, so RLS decides what is
 * visible — the same rows the student already sees on their pages. Four reads,
 * in parallel, then one bounded read for the titles of lessons linked from exams.
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
  db: SupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<{ data: AssistantBriefing; error: { message: string } | null }> {
  const [examsRes, lessonsRes, annRes] = await Promise.all([
    loadStudentExamList(db),
    db.from('lessons')
      .select('id, title, created_at, groups!inner(is_active)')
      .eq('is_published', true).is('deleted_at', null).eq('groups.is_active', true)
      .order('created_at', { ascending: false }).limit(ASSISTANT_LESSON_LIMIT),
    db.rpc('get_student_announcements'),
  ])

  const exams: NudgeExam[] = examsRes.data
    .filter(e => e.is_published)
    .slice(0, EXAM_LIMIT)
    .map(e => ({ id: e.id, title: e.title, type: e.type, starts_at: e.starts_at, ends_at: e.ends_at, lesson_id: e.lesson_id }))
  const lessons = ((lessonsRes.data ?? []) as unknown as AssistantLesson[])
    .map(l => ({ id: l.id, title: l.title, created_at: l.created_at }))
  const announcements = ((annRes.data ?? []) as unknown as { id: string; title: string; created_at: string }[])
    .slice(0, 20)
    .map(a => ({ id: a.id, title: a.title, created_at: a.created_at }))

  const examIds = exams.map(e => e.id)
  const lessonTitles: Record<string, string> = Object.fromEntries(lessons.map(l => [l.id, l.title]))
  const missingLessonIds = [...new Set(exams.map(e => e.lesson_id).filter((id): id is string => !!id && !(id in lessonTitles)))].slice(0, EXAM_LIMIT)

  const [subsRes, linkedRes] = await Promise.all([
    examIds.length
      // UNIQUE(exam_id, student_id): at most one row per listed exam.
      ? db.from('exam_submissions').select('exam_id').eq('student_id', userId).eq('status', 'submitted').in('exam_id', examIds).limit(examIds.length)
      : Promise.resolve({ data: [], error: null }),
    missingLessonIds.length
      ? db.from('lessons').select('id, title').in('id', missingLessonIds).eq('is_published', true).is('deleted_at', null).limit(missingLessonIds.length)
      : Promise.resolve({ data: [], error: null }),
  ])
  for (const l of ((linkedRes.data ?? []) as { id: string; title: string }[])) lessonTitles[l.id] = l.title

  const input = {
    now,
    exams,
    submittedExamIds: new Set(((subsRes.data ?? []) as { exam_id: string }[]).map(s => s.exam_id)),
    lessons,
    announcements,
    lessonTitles,
  }
  const error = examsRes.error ?? lessonsRes.error ?? annRes.error ?? subsRes.error ?? linkedRes.error ?? null
  return {
    data: { nudges: buildNudges(input), plan: buildStudyPlan(input), lessons },
    error: error ? { message: error.message } : null,
  }
}
