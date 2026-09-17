import { describe, it, expect } from 'vitest'

import { can } from '@/lib/permissions'
import { resolveAudience, canEditAnnouncement, AUDIENCE_DENIED } from '@/lib/announcement-audience'
import { resolveStudentAffiliation, canSetAffiliation } from '@/lib/student-affiliation'

describe('announce_to_university capability', () => {
  it('is default-OFF for a centre manager and default-ON for a university admin', () => {
    expect(can('center_manager', {}, 'announce_to_university')).toBe(false)
    expect(can('university_admin', {}, 'announce_to_university')).toBe(true)
    expect(can('center_manager', { announce_to_university: true }, 'announce_to_university')).toBe(true)
  })

  it('never reaches teachers or students, even with a stray flag', () => {
    expect(can('teacher', { announce_to_university: true }, 'announce_to_university')).toBe(false)
    expect(can('student', { announce_to_university: true }, 'announce_to_university')).toBe(false)
  })
})

describe('announcement audience resolution', () => {
  it('lets a capable author reach every population, unpinned', () => {
    for (const audience of ['all', 'university', 'center', 'groups'] as const) {
      expect(resolveAudience(audience, true)).toEqual({ audience, center_students_only: false })
    }
  })

  it('refuses university-reaching audiences without the capability', () => {
    expect(resolveAudience('all', false)).toEqual({ error: AUDIENCE_DENIED })
    expect(resolveAudience('university', false)).toEqual({ error: AUDIENCE_DENIED })
  })

  it('pins a restricted author to centre students, groups included', () => {
    expect(resolveAudience('center', false)).toEqual({ audience: 'center', center_students_only: true })
    expect(resolveAudience('groups', false)).toEqual({ audience: 'groups', center_students_only: true })
  })

  it('defaults a missing/invalid audience to what the author may actually send', () => {
    expect(resolveAudience(undefined, true)).toEqual({ audience: 'all', center_students_only: false })
    expect(resolveAudience('everyone', false)).toEqual({ audience: 'center', center_students_only: true })
  })

  it('stops a restricted author from taking over a university announcement', () => {
    const universityWide = { audience: 'all', center_students_only: false }
    expect(canEditAnnouncement(universityWide, false)).toBe(false)
    expect(canEditAnnouncement(universityWide, true)).toBe(true)

    expect(canEditAnnouncement({ audience: 'center', center_students_only: true }, false)).toBe(true)
    expect(canEditAnnouncement({ audience: 'groups', center_students_only: true }, false)).toBe(true)
    expect(canEditAnnouncement({ audience: 'groups', center_students_only: false }, false)).toBe(false)
  })
})

describe('student affiliation', () => {
  const capableManager = { role: 'center_manager', permissions: { announce_to_university: true } }
  const plainManager = { role: 'center_manager', permissions: {} }
  const admin = { role: 'university_admin', permissions: {} }

  it('defaults to the population each role normally adds', () => {
    expect(resolveStudentAffiliation(admin, undefined)).toBe(true)
    expect(resolveStudentAffiliation(capableManager, undefined)).toBe(false)
  })

  it('honours an explicit choice only from an author who may make it', () => {
    expect(resolveStudentAffiliation(capableManager, true)).toBe(true)
    expect(resolveStudentAffiliation(plainManager, true)).toBe(false)
    expect(resolveStudentAffiliation(admin, false)).toBe(false)
  })

  it('keeps teacher invitations on the pre-existing behaviour', () => {
    expect(resolveStudentAffiliation({ role: 'teacher', permissions: {} }, false)).toBe(true)
    expect(canSetAffiliation({ role: 'teacher', permissions: {} })).toBe(false)
  })

  it('respects an admin whose owner switched the capability off', () => {
    const restrictedAdmin = { role: 'university_admin', permissions: { announce_to_university: false } }
    expect(canSetAffiliation(restrictedAdmin)).toBe(false)
    expect(resolveStudentAffiliation(restrictedAdmin, true)).toBe(false)
  })
})
