/**
 * One place that says what each proctoring event means.
 *
 *   violation   — something the student did that the teacher should judge
 *                 (face away, another person, a phone, left the page…)
 *   signal      — suspicious but not a proctoring violation by itself
 *                 (pasted text into an answer, a burst of text appearing)
 *   info        — about the monitoring, never about the student's conduct
 *                 (a detector failed to load, a virtual machine / second
 *                 screen was seen, the coverage summary at submit)
 *
 * Only violations count as "flagged". Everything else is shown to the teacher
 * so a quiet report is never mistaken for proof of a clean attempt.
 */

export const VIOLATION_TYPES = [
  'tab_switch', 'fullscreen_exit', 'face_not_detected', 'multiple_faces', 'looking_away',
  'audio_detected', 'speech_detected', 'suspicious_activity', 'camera_stopped',
  'face_mismatch', 'spoof_detected',
] as const

export const SIGNAL_TYPES = ['paste_detected', 'bulk_insert'] as const

export const INFO_TYPES = ['detector_unavailable', 'monitoring_gap', 'environment_flag', 'monitoring_summary', 'clip_requested', 'second_camera_connected'] as const

export type ViolationType = (typeof VIOLATION_TYPES)[number]
export type SignalType = (typeof SIGNAL_TYPES)[number]
export type InfoType = (typeof INFO_TYPES)[number]
export type ProctoringEventType = ViolationType | SignalType | InfoType

/** Every type /api/proctor/events accepts; anything else is dropped. */
export const ALLOWED_EVENT_TYPES: ReadonlySet<string> = new Set<string>([...VIOLATION_TYPES, ...SIGNAL_TYPES, ...INFO_TYPES])

const violations: ReadonlySet<string> = new Set(VIOLATION_TYPES)
const signals: ReadonlySet<string> = new Set(SIGNAL_TYPES)

export type EventKind = 'violation' | 'signal' | 'info'

export function eventKind(type: string | undefined | null): EventKind {
  if (type && violations.has(type)) return 'violation'
  if (type && signals.has(type)) return 'signal'
  return 'info'
}

export function isViolation(e: { type?: string | null } | null | undefined): boolean {
  return eventKind(e?.type) === 'violation'
}

/**
 * The coverage summary the student's device writes once, at submit:
 * how much of the attempt the camera detectors actually watched.
 * `details` is "covered=<ms>;total=<ms>;frames=<n>".
 */
export interface MonitoringSummary { coveredMs: number; totalMs: number; frames: number }

export function formatMonitoringSummary(s: MonitoringSummary): string {
  return `covered=${Math.round(s.coveredMs)};total=${Math.round(s.totalMs)};frames=${Math.round(s.frames)}`
}

export function parseMonitoringSummary(details: string | undefined | null): MonitoringSummary | null {
  if (!details) return null
  const get = (k: string) => Number(new RegExp(`(?:^|;)${k}=(\\d+)`).exec(details)?.[1])
  const coveredMs = get('covered'); const totalMs = get('total'); const frames = get('frames')
  if (![coveredMs, totalMs, frames].every(Number.isFinite) || totalMs <= 0) return null
  return { coveredMs, totalMs, frames }
}

/** 0–100, how much of the attempt was actually monitored. */
export function coveragePercent(s: MonitoringSummary): number {
  return Math.max(0, Math.min(100, Math.round((s.coveredMs / s.totalMs) * 100)))
}
