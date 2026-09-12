/**
 * Security — the capability model (`src/lib/permissions.ts`).
 *
 * This is the authorization core for every staff write path: a route handler
 * checks a capability with the *user* session, then writes with the
 * service-role client. If `can()` says yes when it should say no, RLS is
 * already bypassed by the time the write happens — there is no second gate.
 * So these tests treat the capability model as a security boundary, not a
 * convenience helper, and assert the negative cases exhaustively.
 *
 * Threat model covered here:
 *  T1  A teacher/student row carrying a stray staff flag must never gain a
 *      staff capability (role is the gate, the JSONB map is only data).
 *  T2  A centre manager defaults to NO capability — an unset map must never
 *      read as "allowed" the way an admin's unset map does.
 *  T3  A centre manager cannot be talked into editing anyone's permissions.
 *  T4  Privilege escalation: an editor can never grant a capability they do
 *      not themselves hold, in any combination of role and map.
 *  T5  Untrusted JSON reaching `sanitizePermissions` cannot smuggle in an
 *      unknown key, a truthy non-boolean, or a prototype-pollution payload.
 */
import { describe, it, expect } from 'vitest'
import {
  CAPABILITIES,
  can,
  canEditPermissionsOf,
  resolvePermissions,
  sanitizePermissions,
  ungrantableCapabilities,
  type Capability,
} from '@/lib/permissions'
import type { Role } from '@/types'

const ALL_ROLES: Role[] = [
  'super_admin',
  'university_admin',
  'center_manager',
  'teacher',
  'student',
]

/** Every capability switched on — the most dangerous map a row could carry. */
const ALL_ON = Object.fromEntries(CAPABILITIES.map(c => [c, true])) as Record<Capability, boolean>

describe('T1 — role is the gate, the permissions map is only data', () => {
  it('never grants a staff capability to a teacher or a student, even with every flag on', () => {
    for (const role of ['teacher', 'student'] as Role[]) {
      for (const cap of CAPABILITIES) {
        expect(can(role, ALL_ON, cap), `${role} must not hold ${cap}`).toBe(false)
      }
    }
  })

  it('never grants a capability to an unknown or missing role', () => {
    for (const cap of CAPABILITIES) {
      expect(can(null, ALL_ON, cap)).toBe(false)
      expect(can(undefined, ALL_ON, cap)).toBe(false)
      expect(can('', ALL_ON, cap)).toBe(false)
      expect(can('SUPER_ADMIN', ALL_ON, cap), 'role match must be exact-case').toBe(false)
      expect(can('root', ALL_ON, cap)).toBe(false)
    }
  })

  it('gives super_admin every capability regardless of the map', () => {
    for (const cap of CAPABILITIES) {
      expect(can('super_admin', null, cap)).toBe(true)
      expect(can('super_admin', {}, cap)).toBe(true)
      // Even an explicit `false` cannot restrict the owner.
      expect(can('super_admin', { [cap]: false }, cap)).toBe(true)
    }
  })
})

describe('T2 — role defaults are the right way round', () => {
  it('defaults university_admin ON and center_manager OFF for an unset map', () => {
    for (const cap of CAPABILITIES) {
      expect(can('university_admin', {}, cap), `admin default ${cap}`).toBe(true)
      expect(can('university_admin', null, cap)).toBe(true)
      expect(can('center_manager', {}, cap), `manager default ${cap}`).toBe(false)
      expect(can('center_manager', null, cap)).toBe(false)
      expect(can('center_manager', undefined, cap)).toBe(false)
    }
  })

  it('honours an explicit boolean over the role default in both directions', () => {
    for (const cap of CAPABILITIES) {
      expect(can('university_admin', { [cap]: false }, cap)).toBe(false)
      expect(can('center_manager', { [cap]: true }, cap)).toBe(true)
    }
  })

  it('treats a non-boolean value as unset rather than as truthy', () => {
    // A JSONB column can hold anything. "true", 1 and [] are all truthy in JS
    // and must NOT be read as a grant for a default-OFF role.
    for (const value of ['true', 1, [], {}, 'yes'] as unknown[]) {
      expect(can('center_manager', { manage_students: value }, 'manage_students')).toBe(false)
    }
    // The same values must not silently REVOKE an admin's default either.
    for (const value of ['false', 0, null] as unknown[]) {
      expect(can('university_admin', { manage_students: value }, 'manage_students')).toBe(true)
    }
  })

  it('resolvePermissions reports exactly what can() decides, for every role', () => {
    for (const role of ALL_ROLES) {
      const resolved = resolvePermissions(role, {})
      expect(Object.keys(resolved).sort()).toEqual([...CAPABILITIES].sort())
      for (const cap of CAPABILITIES) {
        expect(resolved[cap]).toBe(can(role, {}, cap))
      }
    }
  })
})

describe('T3 — who may edit whose permissions', () => {
  it('lets the owner edit admins and centre managers, and nobody else', () => {
    expect(canEditPermissionsOf('super_admin', 'university_admin')).toBe(true)
    expect(canEditPermissionsOf('super_admin', 'center_manager')).toBe(true)
    expect(canEditPermissionsOf('super_admin', 'teacher')).toBe(false)
    expect(canEditPermissionsOf('super_admin', 'student')).toBe(false)
    expect(canEditPermissionsOf('super_admin', 'super_admin'), 'no owner-on-owner edits').toBe(false)
  })

  it('lets an admin edit only centre managers — never a peer, never upward', () => {
    expect(canEditPermissionsOf('university_admin', 'center_manager')).toBe(true)
    expect(canEditPermissionsOf('university_admin', 'university_admin')).toBe(false)
    expect(canEditPermissionsOf('university_admin', 'super_admin')).toBe(false)
    expect(canEditPermissionsOf('university_admin', 'teacher')).toBe(false)
  })

  it('lets a centre manager, teacher or student edit nobody at all', () => {
    for (const editor of ['center_manager', 'teacher', 'student', null, undefined] as (Role | null | undefined)[]) {
      for (const target of ALL_ROLES) {
        expect(canEditPermissionsOf(editor, target), `${editor} → ${target}`).toBe(false)
      }
    }
  })
})

describe('T4 — privilege escalation: you can only grant what you hold', () => {
  it('blocks an admin from granting a capability the owner switched off for them', () => {
    const editorPerms = { manage_center_staff: false, manage_teachers: false }
    const requested = { manage_center_staff: true, manage_teachers: true, manage_groups: true }
    const blocked = ungrantableCapabilities('university_admin', editorPerms, requested)
    expect(blocked.sort()).toEqual(['manage_center_staff', 'manage_teachers'])
    // manage_groups is still a default-ON admin capability, so it passes.
    expect(blocked).not.toContain('manage_groups')
  })

  it('blocks a centre manager from granting anything they were not given', () => {
    const blocked = ungrantableCapabilities('center_manager', { manage_students: true }, ALL_ON)
    expect(blocked.sort()).toEqual(CAPABILITIES.filter(c => c !== 'manage_students').sort())
  })

  it('blocks a teacher or student from granting anything, ever', () => {
    for (const role of ['teacher', 'student', null] as (Role | null)[]) {
      expect(ungrantableCapabilities(role, ALL_ON, ALL_ON).sort()).toEqual([...CAPABILITIES].sort())
    }
  })

  it('lets the owner grant everything', () => {
    expect(ungrantableCapabilities('super_admin', null, ALL_ON)).toEqual([])
  })

  it('ignores capabilities being switched OFF — revoking is never an escalation', () => {
    const requested = Object.fromEntries(CAPABILITIES.map(c => [c, false]))
    for (const role of ALL_ROLES) {
      expect(ungrantableCapabilities(role, {}, requested)).toEqual([])
    }
  })

  it('holds for every editor/capability pair: granting requires holding', () => {
    // Exhaustive sweep — the property this whole guard exists to enforce.
    for (const role of ALL_ROLES) {
      for (const cap of CAPABILITIES) {
        const blocked = ungrantableCapabilities(role, {}, { [cap]: true })
        expect(blocked.includes(cap)).toBe(!can(role, {}, cap))
      }
    }
  })
})

describe('T5 — sanitizePermissions rejects untrusted input', () => {
  it('drops unknown keys so a request body cannot invent a capability', () => {
    const out = sanitizePermissions({
      manage_students: true,
      is_super_admin: true,
      role: 'super_admin',
      tenant_id: 'other-tenant',
      '*': true,
    })
    expect(Object.keys(out)).toEqual(['manage_students'])
  })

  it('drops non-boolean values rather than coercing them', () => {
    const out = sanitizePermissions({
      manage_students: 'true',
      manage_teachers: 1,
      manage_groups: true,
    })
    expect(out).toEqual({ manage_groups: true })
  })

  it('survives null, undefined and non-object input', () => {
    expect(sanitizePermissions(null)).toEqual({})
    expect(sanitizePermissions(undefined)).toEqual({})
    expect(sanitizePermissions('manage_students')).toEqual({})
    expect(sanitizePermissions(42)).toEqual({})
    expect(sanitizePermissions([])).toEqual({})
  })

  it('does not let a prototype-pollution payload through or mutate Object.prototype', () => {
    const payload = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"x":1},"manage_groups":true}')
    const out = sanitizePermissions(payload)
    expect(out).toEqual({ manage_groups: true })
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('produces a map that can() reads back identically — round-trip safety', () => {
    const sanitized = sanitizePermissions({ manage_schedules: true, bogus: true })
    expect(can('center_manager', sanitized, 'manage_schedules')).toBe(true)
    expect(can('center_manager', sanitized, 'manage_teachers')).toBe(false)
  })
})
