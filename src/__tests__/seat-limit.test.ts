import { describe, it, expect, vi } from 'vitest'
import { isSeatRole, seatRoleFromDbError, seatStatus, SEAT_LIMIT_CODE } from '@/lib/seat-limit'

// Owner's rule (2026-09-28): a plan limit is binding the moment it is saved —
// at the limit, no invitation link, join, account creation or re-activation
// for that role goes through until the owner raises it.

describe('seatStatus', () => {
  it('has no cap when the limit is null', () => {
    expect(seatStatus(null, 500)).toEqual({ limit: null, used: 500, allowed: true })
  })
  it('allows below the limit and refuses at / above it', () => {
    expect(seatStatus(50, 49).allowed).toBe(true)
    expect(seatStatus(50, 50).allowed).toBe(false)
    expect(seatStatus(50, 60).allowed).toBe(false) // limit lowered below usage
    expect(seatStatus(0, 0).allowed).toBe(false)   // 0 = no new accounts at all
  })
  it('fails open when the count could not be read (the DB trigger still enforces)', () => {
    expect(seatStatus(10, null).allowed).toBe(true)
  })
})

// The live seat checks (tenant row + active count) run on the SQL layer: see
// accept-invitation-trial and staff-pages-trial on Neon.
describe('seat helpers', () => {
  it('recognises only student / teacher as seat roles', () => {
    expect(isSeatRole('student')).toBe(true)
    expect(isSeatRole('teacher')).toBe(true)
    for (const r of ['university_admin', 'center_manager', 'super_admin', '', null]) expect(isSeatRole(r)).toBe(false)
  })
  it('maps the DB trigger errors to the role', () => {
    expect(seatRoleFromDbError('STUDENT_LIMIT_REACHED')).toBe('student')
    expect(seatRoleFromDbError('ERROR: TEACHER_LIMIT_REACHED')).toBe('teacher')
    expect(seatRoleFromDbError('INVITATION_INVALID_OR_EXPIRED')).toBeNull()
    expect(seatRoleFromDbError(undefined)).toBeNull()
  })
  it('has an API error code for each role', () => {
    expect(SEAT_LIMIT_CODE).toEqual({ student: 'studentLimit', teacher: 'teacherLimit' })
  })
})
