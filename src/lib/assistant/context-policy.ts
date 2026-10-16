// ── Assistant context policy ─────────────────────────────────────
// Decides what the assistant may send to the model. Pure functions only: no
// I/O, no database, no environment. Nothing here changes how lessons or exams
// behave for students and teachers.
//
// Lesson content: a line that carries an answer label is removed, together
// with any continuation lines up to the next blank line. Known answer-key
// markers that this policy does not handle are refused, and so is any content
// that still carries an answer label after removal. The policy refuses rather
// than sending partly redacted text (fail closed).
//
// Exams: only the fields on ASSISTANT_EXAM_FIELDS reach the assistant. A row
// that carries any question, answer or rubric key is refused, never trimmed.
//
// What this does NOT do: it cannot stop the model from solving a question it
// can see. That is a usage rule, handled separately.

import { ANSWER_LABEL_RE, UNSUPPORTED_MARKER_RE } from '@/content/assistant/patterns'

export type PolicyResult = { ok: true; text: string } | { ok: false; reason: PolicyRefusal }

export type PolicyRefusal =
  | 'answer_label_remains'
  | 'unsupported_answer_marker'
  | 'forbidden_exam_key'
  | 'unsupported_exam_value'

// Labels that introduce an answer. Matched anywhere on a line, not only at the
// start, so an inline "Question? Answer: 4" is caught.

// Markers this policy does not interpret. Seeing one means the content is
// refused, because the policy cannot tell whether it reveals an answer.

/** Keep only what sits before an answer label; drop the label and what follows. */
function stripAnswerLabel(line: string): string | null {
  const m = ANSWER_LABEL_RE.exec(line)
  if (!m) return line
  const before = line.slice(0, m.index).trimEnd()
  return before.length > 0 ? before : null
}

/**
 * Lesson content as the assistant may see it. Answer lines are removed; if any
 * answer label or unsupported marker remains, the content is refused.
 */
export function sanitizeLessonForAssistant(content: string): PolicyResult {
  const out: string[] = []
  let dropping = false

  for (const line of content.split(/\r?\n/)) {
    if (dropping) {
      // Continuation of a removed answer: drop until the next blank line.
      if (line.trim() === '') dropping = false
      continue
    }
    if (ANSWER_LABEL_RE.test(line)) {
      const kept = stripAnswerLabel(line)
      if (kept !== null) out.push(kept)
      dropping = true
      continue
    }
    out.push(line)
  }

  const text = out.join('\n')
  if (UNSUPPORTED_MARKER_RE.test(text)) return { ok: false, reason: 'unsupported_answer_marker' }
  if (ANSWER_LABEL_RE.test(text)) return { ok: false, reason: 'answer_label_remains' }
  return { ok: true, text }
}

// Exam fields the assistant may receive. Metadata only: no questions, options,
// answers, rubric, attachments or instructions text.
export const ASSISTANT_EXAM_FIELDS = [
  'id',
  'title',
  'type',
  'group_name',
  'course_title',
  'starts_at',
  'ends_at',
  'duration_minutes',
  'question_count',
  'has_manual_questions',
  'total_points',
  'lesson_id',
  'is_published',
] as const

// Keys that must never reach the assistant, even nested in another value.
const FORBIDDEN_EXAM_KEYS = new Set([
  'questions',
  'correct_answer',
  'model_answer',
  'answer',
  'answers',
  'rubric',
  'answer_files',
  'question_scores',
])

export type AssistantExamMeta = Partial<Record<(typeof ASSISTANT_EXAM_FIELDS)[number], string | number | boolean | null>>

/**
 * An exam row reduced to the assistant's allowlist. Refuses (never trims) when
 * the row carries a forbidden key or a field value that is not a plain scalar.
 */
export function pickExamMetaForAssistant(row: Record<string, unknown>): { ok: true; value: AssistantExamMeta } | { ok: false; reason: PolicyRefusal } {
  for (const key of Object.keys(row)) {
    if (FORBIDDEN_EXAM_KEYS.has(key)) return { ok: false, reason: 'forbidden_exam_key' }
  }
  const value: AssistantExamMeta = {}
  for (const field of ASSISTANT_EXAM_FIELDS) {
    if (!(field in row)) continue
    const v = row[field]
    if (v !== null && typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') {
      return { ok: false, reason: 'unsupported_exam_value' }
    }
    value[field] = v
  }
  return { ok: true, value }
}
