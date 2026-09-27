// Pure helpers for proctoring evidence snapshots — no I/O, no env, so they are
// unit-testable and shared by the upload, listing and cleanup routes.
//
// Policy (set by the owner, 2026-09-26):
//   • a snapshot is taken only for a SEVERE violation (see use-evidence-capture)
//   • it is NEVER stored in Supabase (database or storage) — it lives in an
//     external S3-compatible bucket (Cloudflare R2 by default), src/lib/evidence-store.ts
//   • only the exam's own teacher can see it, and only for EVIDENCE_TTL_HOURS
//   • after that it is deleted for good (hourly cleanup + bucket lifecycle rule)
//
// The capture time is encoded in the object key, so expiry never needs a
// database lookup:  evidence/<examId>/<studentId>/<capturedAtMs>-<type>.<ext>

export const EVIDENCE_TTL_HOURS = 30
export const EVIDENCE_TTL_MS = EVIDENCE_TTL_HOURS * 60 * 60 * 1000
/** Hard cap per student per exam (the client mirrors it). */
export const EVIDENCE_MAX_PER_STUDENT = 10
/** A 320×240 WebP at q≈0.5 is ~8–20 KB; anything near this is not a thumbnail. */
export const EVIDENCE_MAX_BYTES = 80 * 1024
/** Lifetime of a signed viewing link (never longer than the snapshot has left). */
export const EVIDENCE_LINK_SECONDS = 10 * 60
export const EVIDENCE_ROOT = 'evidence'

export const SEVERE_EVIDENCE_TYPES = [
  'suspicious_activity', 'multiple_faces', 'face_not_detected', 'tab_switch', 'fullscreen_exit',
  'face_mismatch', 'spoof_detected',
] as const
export type EvidenceType = (typeof SEVERE_EVIDENCE_TYPES)[number]

export type EvidenceExt = 'webp' | 'jpg'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID.test(v)
}

export function isEvidenceType(v: unknown): v is EvidenceType {
  return typeof v === 'string' && (SEVERE_EVIDENCE_TYPES as readonly string[]).includes(v)
}

export function examPrefix(examId: string): string {
  return `${EVIDENCE_ROOT}/${examId}/`
}

export function studentPrefix(examId: string, studentId: string): string {
  return `${EVIDENCE_ROOT}/${examId}/${studentId}/`
}

export function evidenceKey(examId: string, studentId: string, type: EvidenceType, capturedAtMs: number, ext: EvidenceExt): string {
  return `${studentPrefix(examId, studentId)}${capturedAtMs}-${type}.${ext}`
}

export interface ParsedEvidenceKey {
  key: string
  examId: string
  studentId: string
  capturedAt: number
  type: EvidenceType
}

/** Parses a key produced by evidenceKey(); anything else returns null. */
export function parseEvidenceKey(key: string): ParsedEvidenceKey | null {
  const m = /^evidence\/([^/]+)\/([^/]+)\/(\d{10,16})-([a-z_]+)\.(webp|jpg)$/.exec(key)
  if (!m || !isUuid(m[1]) || !isUuid(m[2]) || !isEvidenceType(m[4])) return null
  return { key, examId: m[1], studentId: m[2], capturedAt: Number(m[3]), type: m[4] }
}

export function expiresAt(capturedAt: number): number {
  return capturedAt + EVIDENCE_TTL_MS
}

export function isExpired(capturedAt: number, now: number = Date.now()): boolean {
  return now >= expiresAt(capturedAt)
}

/** Seconds a viewing link may live: short, and never past the snapshot's expiry. */
export function linkSeconds(capturedAt: number, now: number = Date.now()): number {
  const left = Math.floor((expiresAt(capturedAt) - now) / 1000)
  return Math.max(0, Math.min(EVIDENCE_LINK_SECONDS, left))
}

export function extOf(key: string): EvidenceExt {
  return key.endsWith('.jpg') ? 'jpg' : 'webp'
}

/**
 * The snapshots recorded in an attempt's proctoring_events (each carries
 * `evidence_key`). This is the index of what exists — the store is never
 * listed for it. Malformed or foreign keys are dropped; duplicates collapse.
 */
export function evidenceKeysFromEvents(events: unknown): ParsedEvidenceKey[] {
  if (!Array.isArray(events)) return []
  const seen = new Map<string, ParsedEvidenceKey>()
  for (const e of events) {
    const key = e && typeof e === 'object' ? (e as { evidence_key?: unknown }).evidence_key : undefined
    if (typeof key !== 'string') continue
    const parsed = parseEvidenceKey(key)
    if (parsed) seen.set(key, parsed)
  }
  return [...seen.values()]
}

/** Detects the image format from its first bytes (never trust the client's label). */
export function sniffEvidenceImage(bytes: Uint8Array): EvidenceExt | null {
  if (bytes.length > 12
    && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 // RIFF
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'webp' // WEBP
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg'
  return null
}
