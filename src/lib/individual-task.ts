// Pure helpers for individual follow-up tasks (no I/O, unit-tested).

export interface TaskSuggestion {
  weaknesses: string[]
  title: string
  instructions: string
  questions: string[]
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const strList = (v: unknown, maxItems: number, maxLen: number) =>
  Array.isArray(v) ? v.map(x => str(x, maxLen)).filter(Boolean).slice(0, maxItems) : []

/**
 * Reads the model's reply. Models sometimes wrap JSON in prose or code fences,
 * so the outermost {...} is taken; anything that does not yield at least one
 * weakness and one question is rejected rather than half-shown.
 */
export function parseTaskSuggestion(raw: string): TaskSuggestion | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  let obj: Record<string, unknown>
  try { obj = JSON.parse(raw.slice(start, end + 1)) } catch { return null }
  if (!obj || typeof obj !== 'object') return null
  const suggestion: TaskSuggestion = {
    weaknesses: strList(obj.weaknesses, 5, 300),
    title: str(obj.title, 120),
    instructions: str(obj.instructions, 1000),
    questions: strList(obj.questions, 3, 600),
  }
  return suggestion.weaknesses.length > 0 && suggestion.questions.length > 0 ? suggestion : null
}

/** The weak points as the note the student reads above the task. */
export function weaknessNote(weaknesses: string[], instructions: string): string {
  const list = weaknesses.map(w => `- ${w}`).join('\n')
  return [list, instructions].filter(Boolean).join('\n\n')
}

interface QuestionLike { id: string; text: string; type: string }

/**
 * A student's written answers to one exam, as plain text for the model:
 * only written questions (multiple-choice picks say nothing about writing),
 * each preceded by its question.
 */
export function writtenAnswersText(questions: QuestionLike[], answers: Record<string, string>): { question: string; answer: string } {
  const written = questions.filter(q => (q.type === 'essay' || q.type === 'short_answer') && (answers[q.id] ?? '').trim())
  return {
    question: written.map(q => q.text).join('\n---\n'),
    answer: written.map(q => answers[q.id].trim()).join('\n---\n'),
  }
}
