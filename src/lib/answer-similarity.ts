/**
 * Answer similarity between students of one exam — collusion hints computed
 * once, after the exam, from answers already stored. Nothing runs during the
 * exam, nothing is written, no AI.
 *
 * The strongest classic signal is two students sharing the same WRONG answers:
 * right answers agree by knowledge, wrong ones rarely agree by chance —
 * especially rare wrong choices. For each shared wrong choice we add its
 * surprise, −ln(share of the class that picked it), so a common mistake counts
 * little and a rare identical mistake counts a lot.
 *
 * Written answers: two long answers that are (nearly) the same text are
 * flagged separately (word 3-gram Jaccard).
 *
 * This is a hint for the teacher to look closer, never an accusation — the
 * report says so.
 */

export interface SimilarityQuestion {
  id: string
  type: string
  correct_answer?: string | null
}

export interface SimilaritySubmission {
  studentId: string
  name: string
  answers: Record<string, string>
}

export interface SimilarPair {
  a: { studentId: string; name: string }
  b: { studentId: string; name: string }
  /** Objective questions both answered wrong with the very same choice. */
  sameWrong: number
  /** Objective questions both answered wrong (any choice). */
  bothWrong: number
  /** Written answers whose text is (nearly) identical. */
  sameText: number
  /** Rarity-weighted strength; higher = less likely by chance. */
  score: number
}

const OBJECTIVE = new Set(['mcq', 'true_false'])
/** A pair is reported from this many identical wrong answers… */
const MIN_SAME_WRONG = 3
/** …when they make up at least this share of the wrong answers both had. */
const MIN_SHARE = 0.6
/** Written answers shorter than this are too generic to compare. */
const MIN_TEXT_CHARS = 40
const TEXT_JACCARD = 0.8

function norm(s: string | undefined | null): string {
  return (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function shingles(text: string): Set<string> {
  const words = norm(text).split(' ').filter(Boolean)
  const out = new Set<string>()
  for (let i = 0; i + 2 < words.length; i++) out.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`)
  return out
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / (a.size + b.size - inter)
}

export function findSimilarPairs(
  questions: readonly SimilarityQuestion[],
  submissions: readonly SimilaritySubmission[],
  limit = 20,
): SimilarPair[] {
  const objective = questions.filter(q => OBJECTIVE.has(q.type) && q.correct_answer)
  const written = questions.filter(q => !OBJECTIVE.has(q.type))
  const n = submissions.length
  if (n < 2) return []

  // How many students picked each wrong choice, per question.
  const picks = new Map<string, Map<string, number>>()
  for (const q of objective) {
    const counts = new Map<string, number>()
    for (const s of submissions) {
      const ans = norm(s.answers[q.id])
      if (ans && ans !== norm(q.correct_answer)) counts.set(ans, (counts.get(ans) ?? 0) + 1)
    }
    picks.set(q.id, counts)
  }

  const textSets = submissions.map(s => new Map(written.map(q => {
    const txt = s.answers[q.id] ?? ''
    return [q.id, txt.trim().length >= MIN_TEXT_CHARS ? shingles(txt) : null] as const
  })))

  const pairs: SimilarPair[] = []
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const A = submissions[i], B = submissions[j]
      let sameWrong = 0, bothWrong = 0, score = 0, sameText = 0
      for (const q of objective) {
        const a = norm(A.answers[q.id]), b = norm(B.answers[q.id])
        const right = norm(q.correct_answer)
        if (!a || !b || a === right || b === right) continue
        bothWrong++
        if (a === b) {
          sameWrong++
          const share = (picks.get(q.id)?.get(a) ?? 1) / n
          score += -Math.log(Math.max(share, 1 / n))
        }
      }
      for (const q of written) {
        const sa = textSets[i].get(q.id), sb = textSets[j].get(q.id)
        if (sa && sb && jaccard(sa, sb) >= TEXT_JACCARD) { sameText++; score += 3 }
      }
      const objectiveHit = sameWrong >= MIN_SAME_WRONG && sameWrong / Math.max(bothWrong, 1) >= MIN_SHARE
      if (objectiveHit || sameText > 0) {
        pairs.push({
          a: { studentId: A.studentId, name: A.name },
          b: { studentId: B.studentId, name: B.name },
          sameWrong, bothWrong, sameText, score: Math.round(score * 10) / 10,
        })
      }
    }
  }
  return pairs.sort((x, y) => y.score - x.score).slice(0, limit)
}
