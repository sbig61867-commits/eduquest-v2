import { describe, it, expect, vi } from 'vitest'

// staff-auth imports the cookie-bound server client; stub it — these tests
// only exercise the pure authorization helper.
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { canManageAccountOf } from '@/lib/staff-auth'
import { canEditPermissionsOf } from '@/lib/permissions'

// The single gate create-user / toggle-user / delete-user / invitations use.
// Security review 2026-09-27: capability flags used to bind centre managers
// only, so an owner-restricted university_admin kept every account power.
describe('canManageAccountOf', () => {
  it('lets the owner manage every role', () => {
    for (const role of ['university_admin', 'center_manager', 'teacher', 'student']) {
      expect(canManageAccountOf({ role: 'super_admin', permissions: { manage_teachers: false } }, role)).toBe(true)
    }
  })

  it('keeps a university_admin on its defaults (ON) until the owner switches a flag off', () => {
    const admin = { role: 'university_admin', permissions: {} }
    expect(canManageAccountOf(admin, 'teacher')).toBe(true)
    expect(canManageAccountOf(admin, 'student')).toBe(true)
    expect(canManageAccountOf(admin, 'center_manager')).toBe(true)
  })

  it('binds an owner-restricted university_admin', () => {
    const restricted = {
      role: 'university_admin',
      permissions: { manage_teachers: false, manage_students: false, manage_center_staff: false },
    }
    expect(canManageAccountOf(restricted, 'teacher')).toBe(false)
    expect(canManageAccountOf(restricted, 'student')).toBe(false)
    expect(canManageAccountOf(restricted, 'center_manager')).toBe(false)
  })

  it('never lets a university_admin manage another admin or the owner', () => {
    const admin = { role: 'university_admin', permissions: {} }
    expect(canManageAccountOf(admin, 'university_admin')).toBe(false)
    expect(canManageAccountOf(admin, 'super_admin')).toBe(false)
  })

  it('caps a centre manager at teachers/students behind their flags', () => {
    const cm = { role: 'center_manager', permissions: { manage_students: true, manage_center_staff: true } }
    expect(canManageAccountOf(cm, 'student')).toBe(true)
    expect(canManageAccountOf(cm, 'teacher')).toBe(false)
    expect(canManageAccountOf(cm, 'center_manager')).toBe(false)
  })

  it('never passes teachers or students', () => {
    expect(canManageAccountOf({ role: 'teacher', permissions: { manage_students: true } }, 'student')).toBe(false)
    expect(canManageAccountOf({ role: 'student', permissions: {} }, 'student')).toBe(false)
  })
})

// Owner's rule (2026-09-28): a university_admin configures the centre managers
// of its own university's centre only. An independent training centre (or any
// institution that is not a university) — the owner alone sets them.
describe('canEditPermissionsOf — university centre vs independent centre', () => {
  it('lets a university admin configure its own centre managers', () => {
    expect(canEditPermissionsOf('university_admin', 'center_manager', 'university')).toBe(true)
  })

  it('never lets a non-university institution admin configure centre managers', () => {
    for (const type of ['training_center', 'school', 'institute', 'company', null, undefined]) {
      expect(canEditPermissionsOf('university_admin', 'center_manager', type)).toBe(false)
    }
  })

  it('keeps the owner in charge everywhere', () => {
    for (const type of ['university', 'training_center', null]) {
      expect(canEditPermissionsOf('super_admin', 'center_manager', type)).toBe(true)
      expect(canEditPermissionsOf('super_admin', 'university_admin', type)).toBe(true)
    }
  })

  it('never lets an admin configure another admin, nor anyone else configure staff', () => {
    expect(canEditPermissionsOf('university_admin', 'university_admin', 'university')).toBe(false)
    expect(canEditPermissionsOf('center_manager', 'center_manager', 'university')).toBe(false)
    expect(canEditPermissionsOf('teacher', 'center_manager', 'university')).toBe(false)
  })
})
