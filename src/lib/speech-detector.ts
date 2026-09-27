/**
 * Speech detection without any model download.
 *
 * The old audio check flagged anything LOUD — a fan, a chair, a door. Speech
 * has two properties steady noise lacks, and both can be read from the
 * browser's own AnalyserNode spectrum every 100 ms:
 *   1. its energy sits in the voice band (≈ 300–3400 Hz);
 *   2. it rises and falls with syllables (a few times a second), so its level
 *      keeps jumping up and down, while a fan or an air conditioner stays flat
 *      (and a noise that switches on makes ONE jump, not a rhythm).
 * A frame is "voiced" when the voice band dominates the spectrum and stands
 * clearly above the room's own noise floor (learned as the exam goes).
 * Speech is reported when, over the last WINDOW frames, enough frames are
 * voiced AND the voice-band level jumps repeatedly, like syllables do.
 *
 * A dedicated model (Silero VAD) was considered and rejected on size: its
 * runtime is ~14 MB, downloaded on every exam start, too heavy for students
 * on a slow phone connection.
 */

export interface SpeechDetectorOptions {
  sampleRate: number
  /** AnalyserNode.frequencyBinCount (fftSize / 2). */
  binCount: number
}

const VOICE_LOW_HZ = 300
const VOICE_HIGH_HZ = 3400
const TOP_HZ = 8000

const WINDOW = 30               // frames (3 s at 100 ms)
const MIN_VOICED = 15           // ≥ 1.5 s of voiced frames in the window
const VOICE_SHARE = 0.55        // voice band / (voice + other bands up to 8 kHz)
const ABOVE_FLOOR = 18          // byte units above the learned noise floor
const JUMP_SHARE = 0.15         // a level change larger than this share of the mean…
const MIN_JUMPS = 6             // …must happen this often in the window (syllables)
const COOLDOWN_MS = 20_000

export class SpeechDetector {
  private readonly lo: number
  private readonly hi: number
  private readonly top: number
  private floor = -1
  private levels: number[] = []
  private voiced: boolean[] = []
  private lastReport = -Infinity

  constructor(opts: SpeechDetectorOptions) {
    const hzPerBin = opts.sampleRate / 2 / opts.binCount
    this.lo = Math.max(1, Math.floor(VOICE_LOW_HZ / hzPerBin))
    this.hi = Math.min(opts.binCount - 1, Math.ceil(VOICE_HIGH_HZ / hzPerBin))
    this.top = Math.min(opts.binCount - 1, Math.ceil(TOP_HZ / hzPerBin))
  }

  /**
   * One spectrum frame (AnalyserNode.getByteFrequencyData). Returns true
   * exactly when speech should be reported now.
   */
  feed(spectrum: Uint8Array, now: number): boolean {
    let voice = 0, other = 0
    for (let i = 1; i <= this.top; i++) {
      const e = spectrum[i] * spectrum[i]
      if (i >= this.lo && i <= this.hi) voice += e
      else other += e
    }
    let sum = 0
    for (let i = this.lo; i <= this.hi; i++) sum += spectrum[i]
    const level = sum / (this.hi - this.lo + 1)

    // Noise floor: drops at once to anything quieter, creeps up slowly, so
    // a constant noise becomes the floor while speech stays above it.
    if (this.floor < 0 || level < this.floor) this.floor = level
    else this.floor += (level - this.floor) * 0.01

    const share = voice / Math.max(voice + other, 1)
    const isVoiced = share >= VOICE_SHARE && level >= this.floor + ABOVE_FLOOR

    this.levels.push(level); this.voiced.push(isVoiced)
    if (this.levels.length > WINDOW) { this.levels.shift(); this.voiced.shift() }
    if (this.levels.length < WINDOW) return false
    if (now - this.lastReport < COOLDOWN_MS) return false

    const voicedCount = this.voiced.filter(Boolean).length
    if (voicedCount < MIN_VOICED) return false
    const mean = this.levels.reduce((a, b) => a + b, 0) / WINDOW
    if (mean <= 0) return false
    let jumps = 0
    for (let i = 1; i < WINDOW; i++) if (Math.abs(this.levels[i] - this.levels[i - 1]) > JUMP_SHARE * mean) jumps++
    if (jumps < MIN_JUMPS) return false

    this.lastReport = now
    return true
  }
}
