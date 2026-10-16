// ── Inputs that may travel as `public` content ───────────────────
// Topic-only generators (generate-lesson, generate-exam) send a short topic and
// fixed option values with the `public` audience (privacy.ts). Only values
// from a closed list are accepted for the options, so no free text rides along.
//
// Owner decision 2026-10-12: the topic alone is treated as public. Its length
// cap and character filter do NOT make it public: a teacher can still type
// internal information into it. That residual risk is accepted by the policy.

/** Lesson levels the teacher UI offers (lessons-client.tsx, lesson-detail-client.tsx). */
const LESSON_LEVELS: Record<string, string> = {
  'high school': 'high school',
  high_school: 'high school',
  undergraduate: 'undergraduate',
  graduate: 'graduate',
  beginner: 'beginner',
  intermediate: 'intermediate',
  advanced: 'advanced',
}

/** The canonical level, 'undergraduate' when absent, or null for an unknown value. */
export function normalizeLessonLevel(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return 'undergraduate'
  if (typeof raw !== 'string') return null
  const key = raw.trim().toLowerCase()
  return Object.prototype.hasOwnProperty.call(LESSON_LEVELS, key) ? LESSON_LEVELS[key] : null
}

export const EXAM_TYPES = ['mcq', 'true_false', 'mixed'] as const
export type ExamType = typeof EXAM_TYPES[number]

/** The exam type, 'mixed' when absent, or null for an unknown value. */
export function normalizeExamType(raw: unknown): ExamType | null {
  if (raw === undefined || raw === null || raw === '') return 'mixed'
  return typeof raw === 'string' && (EXAM_TYPES as readonly string[]).includes(raw) ? raw as ExamType : null
}
