/**
 * Identity continuity during a proctored attempt: is the face in front of the
 * camera still the student who started, and is it a real face rather than a
 * photo or a phone screen held up?
 *
 * No stored photo and no server: the reference is the student's own face in
 * the first seconds of THIS attempt (averaged over a few good frames), kept
 * in memory only. Every check compares the current face descriptor with it.
 *
 * Deliberately conservative — a false accusation is worse than a miss:
 *   • a mismatch needs MISMATCH_STREAK consecutive checks under the threshold;
 *   • a spoof needs SPOOF_STREAK consecutive low "real" scores;
 *   • frames with no face or several faces are skipped (other detectors
 *     already report those).
 */

export const ENROLL_FRAMES = 3
export const MISMATCH_SIMILARITY = 0.35
export const MISMATCH_STREAK = 2
export const SPOOF_REAL_BELOW = 0.2
export const SPOOF_STREAK = 2

export type Similarity = (a: number[], b: number[]) => number

export type IdentityVerdict =
  | { kind: 'enrolling' }
  | { kind: 'ok'; similarity: number }
  | { kind: 'mismatch'; similarity: number }
  | { kind: 'spoof'; real: number }
  | { kind: 'skip' }

export class IdentityTracker {
  private enrolled: number[][] = []
  private reference: number[] | null = null
  private mismatchStreak = 0
  private spoofStreak = 0

  constructor(private readonly similarity: Similarity) {}

  get isEnrolled(): boolean { return this.reference !== null }

  /** One analysed frame: the faces found (embedding + real score). */
  observe(faces: { embedding?: number[]; real?: number }[]): IdentityVerdict {
    if (faces.length !== 1) return { kind: 'skip' }
    const face = faces[0]

    if (typeof face.real === 'number') {
      this.spoofStreak = face.real < SPOOF_REAL_BELOW ? this.spoofStreak + 1 : 0
      if (this.spoofStreak >= SPOOF_STREAK) { this.spoofStreak = 0; return { kind: 'spoof', real: face.real } }
    }

    const emb = face.embedding
    if (!emb || emb.length === 0) return { kind: 'skip' }

    if (!this.reference) {
      // Never enrol a face that already looks like a photo.
      if (typeof face.real === 'number' && face.real < SPOOF_REAL_BELOW) return { kind: 'skip' }
      this.enrolled.push(emb)
      if (this.enrolled.length >= ENROLL_FRAMES) this.reference = average(this.enrolled)
      return { kind: 'enrolling' }
    }

    const sim = this.similarity(this.reference, emb)
    this.mismatchStreak = sim < MISMATCH_SIMILARITY ? this.mismatchStreak + 1 : 0
    if (this.mismatchStreak >= MISMATCH_STREAK) {
      this.mismatchStreak = 0
      return { kind: 'mismatch', similarity: sim }
    }
    return { kind: 'ok', similarity: sim }
  }
}

export function average(vectors: number[][]): number[] {
  const out = new Array<number>(vectors[0].length).fill(0)
  for (const v of vectors) for (let i = 0; i < out.length; i++) out[i] += v[i] / vectors.length
  return out
}

/**
 * Whether this device should run the heavier identity checks (~8 MB of
 * models, loaded after the exam starts). Weak devices and slow or metered
 * connections keep the light detectors only.
 */
export function canRunIdentityChecks(nav: {
  connection?: { saveData?: boolean; effectiveType?: string }
  deviceMemory?: number
  hardwareConcurrency?: number
}): boolean {
  if (nav.connection?.saveData) return false
  const type = nav.connection?.effectiveType
  if (type && type !== '4g') return false
  if (typeof nav.deviceMemory === 'number' && nav.deviceMemory < 4) return false
  if (typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency < 4) return false
  return true
}
