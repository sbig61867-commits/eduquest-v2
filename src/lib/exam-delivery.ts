import type { Question } from '@/types'

/** A question as a student receives it: everything but the answer key. */
export type StudentQuestion = Omit<Question, 'correct_answer'>

/**
 * The questions of an exam as /api/exam/start hands them to the student —
 * the one place questions leave the server for a student (PERFORMANCE_CONTRACT.md
 * P3). Mirrors what get_student_exams() did in SQL (`q - 'correct_answer'`):
 * every key but the answer key, in the teacher's order (the exam screen
 * shuffles per student, src/lib/exam-shuffle.ts).
 */
export function studentQuestions(raw: unknown): StudentQuestion[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((q): q is Record<string, unknown> => !!q && typeof q === 'object' && !Array.isArray(q))
    .map(q => {
      const rest = { ...q }
      delete rest.correct_answer
      return rest as unknown as StudentQuestion
    })
}
