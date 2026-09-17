import { describe, it, expect, vi } from 'vitest'

// staff-auth imports the cookie-bound server client; stub it — these tests
// only exercise the pure authorization helpers.
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { can, resolvePermissions } from '@/lib/permissions'
import { canManageAccountRole, staffCan } from '@/lib/staff-auth'
import { isValidSessionDate, isAttendanceStatus } from '@/lib/attendance'

describe('centre manager capabilities', () => {
  it('are default-OFF for a centre manager and default-ON for a university admin', () => {
    for (const cap of ['manage_courses', 'manage_attendance'] as const) {
      expect(can('center_manager', {}, cap)).toBe(false)
      expect(can('university_admin', {}, cap)).toBe(true)
    }
    expect(resolvePermissions('center_manager', { manage_courses: true }).manage_courses).toBe(true)
  })

  it('never grant anything to teachers or students, even with a stray flag', () => {
    expect(staffCan({ role: 'teacher', permissions: { manage_courses: true } }, 'manage_courses')).toBe(false)
    expect(staffCan({ role: 'student', permissions: { manage_attendance: true } }, 'manage_attendance')).toBe(false)
  })

  it('cap a centre manager at teacher/student accounts, each behind its own flag', () => {
    const teachersOnly = { role: 'center_manager', permissions: { manage_teachers: true } }
    expect(canManageAccountRole(teachersOnly, 'teacher')).toBe(true)
    expect(canManageAccountRole(teachersOnly, 'student')).toBe(false)

    const everything = {
      role: 'center_manager',
      permissions: { manage_teachers: true, manage_students: true, manage_center_staff: true },
    }
    expect(canManageAccountRole(everything, 'center_manager')).toBe(false)
    expect(canManageAccountRole(everything, 'university_admin')).toBe(false)
    expect(canManageAccountRole(everything, 'super_admin')).toBe(false)
  })

  it('respect an admin whose capability the owner switched off', () => {
    expect(canManageAccountRole({ role: 'university_admin', permissions: { manage_students: false } }, 'student')).toBe(false)
  })
})

describe('attendance input rules', () => {
  const now = Date.parse('2026-09-15T10:00:00Z')

  it('accepts real recent dates only', () => {
    expect(isValidSessionDate('2026-09-15', now)).toBe(true)
    expect(isValidSessionDate('2026-09-16', now)).toBe(true)
    expect(isValidSessionDate('2026-02-31', now)).toBe(false)
    expect(isValidSessionDate('2026-9-15', now)).toBe(false)
    expect(isValidSessionDate('2026-09-30', now)).toBe(false)
    expect(isValidSessionDate('2024-01-01', now)).toBe(false)
    expect(isValidSessionDate(20260915, now)).toBe(false)
  })

  it('accepts only the four statuses', () => {
    expect(['present', 'absent', 'late', 'excused'].every(isAttendanceStatus)).toBe(true)
    expect(isAttendanceStatus('PRESENT')).toBe(false)
    expect(isAttendanceStatus(null)).toBe(false)
  })
})
