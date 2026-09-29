import type { Question } from '@/types'

/**
 * Per-student question and option order for an exam.
 *
 * Two students side by side see the questions — and the choices inside each
 * multiple-choice question — in different orders, which defeats "the answer to
 * number 4 is B". It is the cheapest anti-cheating measure there is: no
 * camera, no server, no database.
 *
 * Safe for grading: answers are keyed by question id and store the chosen
 * option's TEXT (never its position), and grading happens on the server from
 * those ids. Deterministic per (exam, student), so a refresh or a resumed
 * attempt shows the same order again.
 *
 * True/false keeps its natural order (shuffling two fixed labels only
 * confuses). Homework is not shuffled: it is untimed and done alone.
 */

/** 32-bit FNV-1a hash of a string — a stable seed. */
export function seedFrom(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** mulberry32: a tiny, well-distributed PRNG returning [0, 1). */
export function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Fisher–Yates on a copy. */
export function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

export function shouldShuffle(exam: { type?: string | null }): boolean {
  return exam.type !== 'homework'
}

/** The questions as this student sees them. Never mutates the input. */
export function orderForStudent(questions: readonly Question[], examId: string, studentId: string): Question[] {
  const random = prng(seedFrom(`${examId}:${studentId}`))
  return shuffled(questions, random).map(q =>
    q.type === 'mcq' && Array.isArray(q.options) && q.options.length > 1
      ? { ...q, options: shuffled(q.options, random) }
      : q,
  )
}
