/**
 * Which recorded segment to send as evidence (src/hooks/use-clip-recorder.ts).
 *
 * The device records its camera + microphone in back-to-back segments of
 * CLIP_SEGMENT_MS, keeping only the last RING_SIZE in memory. When a severe
 * violation happens at time `at`, the clip should show what led up to it:
 *   • the segment containing `at` — unless `at` falls in its first
 *     LEAD_IN_MS, in which case the PREVIOUS segment shows more of the
 *     lead-up (and ends right at the violation).
 */

export const RING_SIZE = 3
export const LEAD_IN_MS = 3_000

export interface Segment<T = Blob> {
  start: number
  end: number
  data: T
}

export function segmentForViolation<T>(ring: readonly Segment<T>[], at: number): Segment<T> | null {
  const i = ring.findIndex(s => at >= s.start && at <= s.end)
  if (i < 0) return null
  const seg = ring[i]
  if (at - seg.start < LEAD_IN_MS && i > 0 && ring[i - 1].end >= seg.start - 1_000) return ring[i - 1]
  return seg
}

/** The newest segments covering up to `seconds` back (teacher's request). */
export function recentSegments<T>(ring: readonly Segment<T>[], seconds: number, now: number): Segment<T>[] {
  return ring.filter(s => s.end > now - seconds * 1000).slice(-RING_SIZE)
}

/** Best MediaRecorder type this browser can produce (Safari records MP4). */
export function pickClipMimeType(isSupported: (type: string) => boolean): string | null {
  for (const t of ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4;codecs=avc1,mp4a', 'video/mp4']) {
    if (isSupported(t)) return t
  }
  return null
}
