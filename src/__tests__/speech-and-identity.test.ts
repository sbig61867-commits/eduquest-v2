import { describe, it, expect } from 'vitest'
import { SpeechDetector } from '@/lib/speech-detector'
import { IdentityTracker, canRunIdentityChecks, average, ENROLL_FRAMES } from '@/lib/face-identity'

const SAMPLE_RATE = 48_000
const BINS = 512
const HZ = SAMPLE_RATE / 2 / BINS

/** Spectrum with `level` in [loHz, hiHz] and `base` elsewhere (up to 8 kHz). */
function spectrum(level: number, base: number, loHz = 300, hiHz = 3400): Uint8Array {
  const s = new Uint8Array(BINS)
  for (let i = 0; i < BINS; i++) {
    const f = i * HZ
    s[i] = f >= loHz && f <= hiHz ? level : f <= 8000 ? base : 0
  }
  return s
}

function run(frames: (i: number) => Uint8Array, count = 80): number {
  const d = new SpeechDetector({ sampleRate: SAMPLE_RATE, binCount: BINS })
  let reports = 0
  // A quiet room first, so the noise floor is learned.
  for (let i = 0; i < 20; i++) d.feed(spectrum(20, 15), i * 100)
  for (let i = 0; i < count; i++) if (d.feed(frames(i), 2000 + i * 100)) reports++
  return reports
}

describe('speech detector', () => {
  it('stays silent in a quiet room', () => {
    expect(run(() => spectrum(22, 16))).toBe(0)
  })

  it('reports speech: voice-band energy rising and falling with syllables', () => {
    // ~4 syllables per second: 250 ms loud, 250 ms softer.
    expect(run(i => spectrum(i % 5 < 3 ? 150 : 70, 25))).toBeGreaterThan(0)
  })

  it('ignores a steady fan in the voice band (no syllable rhythm)', () => {
    expect(run(() => spectrum(140, 30))).toBe(0)
  })

  it('ignores broadband noise (voice band does not dominate)', () => {
    expect(run(i => spectrum(i % 5 < 3 ? 150 : 70, i % 5 < 3 ? 150 : 70, 300, 3400))).toBe(0)
  })

  it('does not repeat within the cooldown', () => {
    expect(run(i => spectrum(i % 5 < 3 ? 150 : 70, 25), 150)).toBe(1)
  })
})

// Cosine similarity for the tests; Human provides its own.
const cos = (a: number[], b: number[]) => {
  let d = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2 }
  return d / Math.sqrt(na * nb)
}
const me = [1, 0.9, 0.1, 0.05]
const other = [0.05, 0.1, 0.9, 1]

describe('identity tracker', () => {
  it('enrols from the first frames, then accepts the same face', () => {
    const t = new IdentityTracker(cos)
    for (let i = 0; i < ENROLL_FRAMES; i++) expect(t.observe([{ embedding: me, real: 0.9 }]).kind).toBe('enrolling')
    expect(t.isEnrolled).toBe(true)
    expect(t.observe([{ embedding: me, real: 0.9 }]).kind).toBe('ok')
  })

  it('reports a different person only after consecutive checks', () => {
    const t = new IdentityTracker(cos)
    for (let i = 0; i < ENROLL_FRAMES; i++) t.observe([{ embedding: me, real: 0.9 }])
    expect(t.observe([{ embedding: other, real: 0.9 }]).kind).toBe('ok')
    expect(t.observe([{ embedding: other, real: 0.9 }]).kind).toBe('mismatch')
  })

  it('a single odd frame between good ones is forgiven', () => {
    const t = new IdentityTracker(cos)
    for (let i = 0; i < ENROLL_FRAMES; i++) t.observe([{ embedding: me, real: 0.9 }])
    t.observe([{ embedding: other, real: 0.9 }])
    t.observe([{ embedding: me, real: 0.9 }])
    expect(t.observe([{ embedding: other, real: 0.9 }]).kind).toBe('ok')
  })

  it('reports a photo held up after consecutive low real scores, and never enrols one', () => {
    const t = new IdentityTracker(cos)
    expect(t.observe([{ embedding: me, real: 0.05 }]).kind).toBe('skip')
    expect(t.observe([{ embedding: me, real: 0.05 }]).kind).toBe('spoof')
    expect(t.isEnrolled).toBe(false)
  })

  it('skips frames without exactly one face', () => {
    const t = new IdentityTracker(cos)
    expect(t.observe([]).kind).toBe('skip')
    expect(t.observe([{ embedding: me }, { embedding: other }]).kind).toBe('skip')
  })

  it('averages vectors', () => {
    expect(average([[0, 2], [2, 4]])).toEqual([1, 3])
  })
})

describe('device tier for identity checks', () => {
  it('runs on a capable device on 4G/Wi-Fi', () => {
    expect(canRunIdentityChecks({ connection: { effectiveType: '4g' }, deviceMemory: 8, hardwareConcurrency: 8 })).toBe(true)
    expect(canRunIdentityChecks({})).toBe(true) // Safari exposes none of these
  })
  it('stays off on slow, metered or weak devices', () => {
    expect(canRunIdentityChecks({ connection: { effectiveType: '3g' } })).toBe(false)
    expect(canRunIdentityChecks({ connection: { saveData: true } })).toBe(false)
    expect(canRunIdentityChecks({ deviceMemory: 2 })).toBe(false)
    expect(canRunIdentityChecks({ hardwareConcurrency: 2 })).toBe(false)
  })
})
