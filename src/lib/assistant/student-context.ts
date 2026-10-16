// ── Student assistant: account context ───────────────────────────
// Reads the student's own lessons, assignments, exams, visible grades and
// announcements, all through the student's session (RLS). Lists are capped,
// bodies are cut, and the result goes through the same answer policy as lessons.

import type { SupabaseClient } from '@supabase/supabase-js'
import { isScoreVisible } from '@/lib/score-visibility'
import { pickExamMetaForAssistant, sanitizeLessonForAssistant } from './context-policy'
import { foldArabic, OVERVIEW_RE } from '@/content/assistant/patterns'

export const ACCOUNT_LIMITS = { lessons: 30, exams: 20, grades: 20, announcements: 10 } as const
const ANNOUNCEMENT_BODY_CHARS = 200
export const MAX_ACCOUNT_CHARS = 4000

/** Lower-cases, folds Arabic letter variants and strips marks, for matching only. */
export function normaliseForMatch(s: string): string {
  return foldArabic(
    s.normalize('NFKC').replace(/[​-‏‪-‮⁦-⁩﻿]/g, ''),
  )
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** The longest lesson title that appears in the message. Titles under 3 characters never match. */
export function matchLessonTitle(message: string, lessons: { id: string; title: string }[]): string | null {
  const m = normaliseForMatch(message)
  let best: { id: string; len: number } | null = null
  for (const l of lessons) {
    const title = normaliseForMatch(l.title)
    if (title.length < 3 || !m.includes(title)) continue
    if (!best || title.length > best.len) best = { id: l.id, len: title.length }
  }
  return best?.id ?? null
}


/** True when the message asks about the student's account rather than a lesson's content. */
export function wantsAccountOverview(message: string): boolean {
  return OVERVIEW_RE.test(message)
}

interface ExamRow { id: string; title: string; type: string; starts_at: string | null; ends_at: string | null; has_manual_questions: boolean; group_name: string | null; course_title: string | null }

/**
 * Builds a bounded plain-text account snapshot. Returns null when nothing can
 * be read or the text fails the answer policy (fail closed for this section only).
 */
export async function loadAccountText(supabase: SupabaseClient, userId: string): Promise<string | null> {
  const [lessonsRes, examsRes, gradesRes, annRes] = await Promise.all([
    supabase.from('lessons')
      .select('title, created_at, groups!inner(name, is_active)')
      .eq('is_published', true).is('deleted_at', null).eq('groups.is_active', true)
      .order('created_at', { ascending: false }).limit(ACCOUNT_LIMITS.lessons),
    supabase.rpc('get_student_exam_list'),
    supabase.from('exam_submissions')
      .select('exam_id, score, max_score, grading_status, submitted_at')
      .eq('student_id', userId).not('score', 'is', null)
      .order('submitted_at', { ascending: false }).limit(ACCOUNT_LIMITS.grades),
    supabase.rpc('get_student_announcements'),
  ])

  const lines: string[] = []

  const lessons = (lessonsRes.data ?? []) as unknown as { title: string; groups: { name: string } | null }[]
  if (lessons.length) {
    lines.push('Lessons:')
    for (const l of lessons) lines.push(`- ${l.title}${l.groups?.name ? ` (${l.groups.name})` : ''}`)
  }

  const examRows = (examsRes.data ?? []) as Record<string, unknown>[]
  const examById = new Map<string, ExamRow>()
  const exams: string[] = []
  for (const row of examRows.slice(0, ACCOUNT_LIMITS.exams)) {
    const picked = pickExamMetaForAssistant(row)
    if (!picked.ok) continue
    const e = picked.value
    const isHomework = e.type === 'homework'
    exams.push(`- ${isHomework ? 'Assignment' : 'Exam'}: ${e.title}${e.ends_at ? ` (due ${String(e.ends_at).slice(0, 10)})` : ''}`)
    examById.set(String(e.id), {
      id: String(e.id),
      title: String(e.title),
      type: String(e.type),
      starts_at: (e.starts_at as string | null) ?? null,
      ends_at: (e.ends_at as string | null) ?? null,
      has_manual_questions: Boolean(e.has_manual_questions),
      group_name: (e.group_name as string | null) ?? null,
      course_title: (e.course_title as string | null) ?? null,
    })
  }
  if (exams.length) { lines.push('Exams and assignments:'); lines.push(...exams) }

  const grades = (gradesRes.data ?? []) as { exam_id: string; score: number; max_score: number | null; grading_status: string | null }[]
  const visible: string[] = []
  for (const g of grades) {
    const exam = examById.get(g.exam_id)
    if (!exam) continue
    if (!isScoreVisible(g.grading_status, exam.type, exam.has_manual_questions)) continue
    visible.push(`- ${exam.title}: ${g.score}${g.max_score != null ? `/${g.max_score}` : ''}`)
  }
  if (visible.length) { lines.push('Published grades:'); lines.push(...visible) }

  const announcements = (annRes.data ?? []) as { title: string; body: string | null; created_at: string }[]
  if (announcements.length) {
    lines.push('Announcements:')
    for (const a of announcements.slice(0, ACCOUNT_LIMITS.announcements)) {
      const body = (a.body ?? '').slice(0, ANNOUNCEMENT_BODY_CHARS)
      lines.push(`- ${a.title} (${String(a.created_at).slice(0, 10)})${body ? `: ${body}` : ''}`)
    }
  }

  if (lines.length === 0) return null
  const text = lines.join('\n').slice(0, MAX_ACCOUNT_CHARS)
  const policy = sanitizeLessonForAssistant(text)
  return policy.ok ? policy.text : null
}

/** Lesson titles the student can open, for matching the message to a lesson. */
export async function loadLessonIndex(supabase: SupabaseClient): Promise<{ id: string; title: string }[]> {
  const { data } = await supabase.from('lessons')
    .select('id, title, groups!inner(is_active)')
    .eq('is_published', true).is('deleted_at', null).eq('groups.is_active', true)
    .order('created_at', { ascending: false }).limit(ACCOUNT_LIMITS.lessons)
  return ((data ?? []) as unknown as { id: string; title: string }[]).map(l => ({ id: l.id, title: l.title }))
}
