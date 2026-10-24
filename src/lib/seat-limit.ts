import type { ApiErrorCode } from '@/lib/api-error'

// Plan seat caps set by the owner on each institution:
//   tenants.student_limit — ACTIVE students
//   tenants.teacher_limit — ACTIVE teachers
// NULL = no cap. A limit is binding the moment the owner saves it: every
// check reads the live row, nothing is cached.
//
// These helpers are the friendly pre-checks in the route handlers (clear error
// before anything is created, invitation links refused while full). The hard
// guarantee is the database trigger users_enforce_seat_limit
// (supabase/tenant_seat_limits_migration.sql), which every path — including
// re-enabling an account and joining through Google — goes through.
//
// Must be called with the service-role client: it counts across the whole
// tenant. Fails OPEN on a read error (the DB trigger still holds the line), so
// an unrelated hiccup never blocks a legitimate signup on its own.

export type SeatRole = 'student' | 'teacher'
export const SEAT_ROLES: readonly SeatRole[] = ['student', 'teacher']

export function isSeatRole(role: unknown): role is SeatRole {
  return role === 'student' || role === 'teacher'
}

export interface SeatStatus {
  /** NULL = no cap. */
  limit: number | null
  /** Active accounts of this role; NULL if the count could not be read. */
  used: number | null
  /** May one more active account of this role be added? */
  allowed: boolean
}

const LIMIT_COLUMN: Record<SeatRole, 'student_limit' | 'teacher_limit'> = {
  student: 'student_limit',
  teacher: 'teacher_limit',
}

/** API error code for "this institution is full" per role (src/messages/<locale>/errors.json). */
export const SEAT_LIMIT_CODE: Record<SeatRole, ApiErrorCode> = {
  student: 'studentLimit',
  teacher: 'teacherLimit',
}

/** Status from a raw limit + count (pure; exported for tests). */
export function seatStatus(limit: unknown, used: number | null): SeatStatus {
  const cap = typeof limit === 'number' && Number.isFinite(limit) ? limit : null
  if (cap === null || used === null) return { limit: cap, used, allowed: true }
  return { limit: cap, used, allowed: used < cap }
}

/** The role whose limit the DB trigger refused, from its error message; null otherwise. */
export function seatRoleFromDbError(message: string | null | undefined): SeatRole | null {
  if (!message) return null
  if (message.includes('STUDENT_LIMIT_REACHED')) return 'student'
  if (message.includes('TEACHER_LIMIT_REACHED')) return 'teacher'
  return null
}
