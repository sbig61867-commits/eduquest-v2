// Attendance input rules shared by the route handler and its unit tests.

export const ATTENDANCE_STATUSES = ['present', 'absent', 'late', 'excused'] as const
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number]

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 86_400_000

/** YYYY-MM-DD, a real calendar date, at most 2 days ahead and ~400 days back. */
export function isValidSessionDate(d: unknown, now = Date.now()): d is string {
  if (typeof d !== 'string' || !DATE_RE.test(d)) return false
  const t = Date.parse(`${d}T00:00:00Z`)
  if (isNaN(t) || new Date(t).toISOString().slice(0, 10) !== d) return false
  return t <= now + 2 * DAY_MS && t >= now - 400 * DAY_MS
}

export function isAttendanceStatus(s: unknown): s is AttendanceStatus {
  return typeof s === 'string' && (ATTENDANCE_STATUSES as readonly string[]).includes(s)
}
