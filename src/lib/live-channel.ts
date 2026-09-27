/**
 * On-demand live proctoring — the per-exam Realtime channel.
 *
 * Every student in a proctored exam joins a PRIVATE Supabase Realtime channel
 * (supabase/live_proctoring_channel_migration.sql decides who may join):
 *   • presence   — each student announces itself (key = user id) with its
 *                  violation / snapshot counts, so the teacher's page knows who
 *                  is in the exam without reading a table;
 *   • broadcast  — only the exam's teacher can send it: the set of students to
 *                  watch live right now.
 * A student starts streaming only when it is in that set, and LiveKit itself
 * decides whether it may keep streaming (/api/proctor/live-token checks that
 * the teacher is in the room and watching that student). Nothing on the
 * student's screen changes either way.
 */
export function liveTopic(examId: string): string {
  return `exam-live:${examId}`
}

/** Broadcast event carrying `{ ids: string[] }`, the students to watch. */
export const WATCH_EVENT = 'watch'

/** Broadcast event carrying `{ ids: string[]; seconds: number }`: send your last clips. */
export const CLIP_EVENT = 'clip'

/** Presence key the teacher's page uses (students use their user id). */
export const TEACHER_PRESENCE_KEY = 'teacher'

/** LiveKit participant attribute on the teacher: comma-separated watched ids. */
export const WATCHING_ATTRIBUTE = 'watching'

/** What a student announces on the channel. Counts only, never content. */
export interface StudentPresence {
  /** Violations recorded so far in this attempt. */
  v: number
  /** Evidence snapshots stored so far in this attempt. */
  ev: number
}

export function parseWatching(value: string | undefined | null): string[] {
  return (value ?? '').split(',').map(s => s.trim()).filter(Boolean)
}

export function watchPayloadIncludes(payload: unknown, userId: string): boolean {
  const ids = (payload as { ids?: unknown } | null)?.ids
  return Array.isArray(ids) && ids.includes(userId)
}

/** Largest number of students a teacher may watch at once (one page of tiles). */
export const MAX_WATCHED = 9
