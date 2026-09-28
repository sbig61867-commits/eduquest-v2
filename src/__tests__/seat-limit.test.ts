import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { checkSeatLimit, getSeatUsage, isSeatRole, seatRoleFromDbError, seatStatus, SEAT_LIMIT_CODE } from '@/lib/seat-limit'

// Owner's rule (2026-09-28): a plan limit is binding the moment it is saved —
// at the limit, no invitation link, join, account creation or re-activation
// for that role goes through until the owner raises it.

/** Minimal Supabase stub: `tenants` row + active-user counts per role. */
function stub(tenant: Record<string, unknown> | null, counts: Record<string, number | null>) {
  return {
    from: vi.fn((table: string) => {
      if (table === 'tenants') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: tenant, error: null }) }) }) }
      }
      let role = ''
      const q = {
        select: () => q,
        eq: (col: string, val: string) => { if (col === 'role') role = val; return q },
        then: (resolve: (v: unknown) => void) =>
          resolve(counts[role] == null ? { count: null, error: { message: 'boom' } } : { count: counts[role], error: null }),
      }
      return q
    }),
  } as unknown as SupabaseClient
}

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

describe('checkSeatLimit', () => {
  it('reads the live limit for the right role', async () => {
    const db = stub({ student_limit: 50, teacher_limit: 3 }, { student: 50, teacher: 2 })
    expect((await checkSeatLimit(db, 't', 'student')).allowed).toBe(false)
    expect((await checkSeatLimit(db, 't', 'teacher')).allowed).toBe(true)
  })
  it('treats a missing teacher_limit column (pre-migration) as no cap', async () => {
    const db = stub({ student_limit: 5 }, { student: 1, teacher: 99 })
    expect(await checkSeatLimit(db, 't', 'teacher')).toEqual({ limit: null, used: null, allowed: true })
  })
})

describe('getSeatUsage', () => {
  it('reports both roles', async () => {
    const db = stub({ student_limit: 2, teacher_limit: null }, { student: 2, teacher: 7 })
    expect(await getSeatUsage(db, 't')).toEqual({
      student: { limit: 2, used: 2, allowed: false },
      teacher: { limit: null, used: 7, allowed: true },
    })
  })
})

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
