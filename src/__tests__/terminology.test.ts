import { describe, it, expect } from 'vitest'
import { getTerms, INSTITUTION_TYPES, isInstitutionType } from '@/lib/terminology'
import { getRoleLabel } from '@/lib/utils'
import { can, CAPABILITIES } from '@/lib/permissions'

describe('terminology', () => {
  it('every institution type defines every term, non-empty', () => {
    const keys = Object.keys(getTerms('university'))
    for (const type of INSTITUTION_TYPES) {
      const terms = getTerms(type)
      expect(Object.keys(terms).sort()).toEqual([...keys].sort())
      for (const value of Object.values(terms)) expect(value.trim()).not.toBe('')
    }
  })

  it('unknown or missing type falls back to university wording', () => {
    expect(getTerms(undefined)).toEqual(getTerms('university'))
    expect(getTerms(null)).toEqual(getTerms('university'))
    expect(getTerms('hospital')).toEqual(getTerms('university'))
    expect(isInstitutionType('hospital')).toBe(false)
    expect(isInstitutionType('school')).toBe(true)
  })

  it('getRoleLabel keeps its original output without a type', () => {
    expect(getRoleLabel('university_admin')).toBe('University Admin')
    expect(getRoleLabel('teacher')).toBe('Teacher')
  })

  it('getRoleLabel follows the institution type for the admin role only', () => {
    expect(getRoleLabel('university_admin', 'school')).toBe('School Admin')
    expect(getRoleLabel('teacher', 'school')).toBe('Teacher')
  })
})

describe('manage_academic_structure capability', () => {
  it('is a known capability', () => {
    expect(CAPABILITIES).toContain('manage_academic_structure')
  })

  it('defaults ON for university_admin, OFF for center_manager, never for teacher/student', () => {
    expect(can('university_admin', {}, 'manage_academic_structure')).toBe(true)
    expect(can('center_manager', {}, 'manage_academic_structure')).toBe(false)
    expect(can('center_manager', { manage_academic_structure: true }, 'manage_academic_structure')).toBe(true)
    expect(can('teacher', { manage_academic_structure: true }, 'manage_academic_structure')).toBe(false)
    expect(can('student', { manage_academic_structure: true }, 'manage_academic_structure')).toBe(false)
  })
})

describe('structure mode', () => {
  it('only the explicit academic value enables the academic structure', async () => {
    const { isAcademicMode } = await import('@/lib/structure-mode')
    expect(isAcademicMode('academic')).toBe(true)
    expect(isAcademicMode('flat')).toBe(false)
    expect(isAcademicMode(undefined)).toBe(false)
    expect(isAcademicMode(null)).toBe(false)
  })
})

describe('tenant settings', () => {
  it('a pre-migration row (no new columns) keeps today\'s behaviour', async () => {
    const { toTenantSettings } = await import('@/lib/structure-mode')
    expect(toTenantSettings({ id: 't', name: 'x' })).toEqual({
      institution_type: 'university', structure_mode: 'flat', has_center: true,
    })
    expect(toTenantSettings(null).has_center).toBe(true)
  })

  it('reads explicit values and rejects unknown ones', async () => {
    const { toTenantSettings } = await import('@/lib/structure-mode')
    expect(toTenantSettings({ institution_type: 'school', structure_mode: 'academic', has_center: false })).toEqual({
      institution_type: 'school', structure_mode: 'academic', has_center: false,
    })
    expect(toTenantSettings({ institution_type: 'hospital', structure_mode: 'weird' })).toMatchObject({
      institution_type: 'university', structure_mode: 'flat',
    })
  })

  it('Arabic labels follow the institution type', () => {
    expect(getTerms('school').institutionAdminAr).toBe('مدير المدرسة')
    expect(getTerms('university').institutionStudentsAr).toBe('طلاب الجامعة')
  })
})

describe('student track', () => {
  it('a centre trainee only exists where the tenant has a centre', async () => {
    const { getStudentTrack } = await import('@/lib/student-track')
    expect(getStudentTrack(false, true)).toBe('centre')
    expect(getStudentTrack(false, undefined)).toBe('centre')
    expect(getStudentTrack(false, false)).toBe('institution')
    expect(getStudentTrack(true, true)).toBe('institution')
    expect(getStudentTrack(undefined, true)).toBe('institution')
  })
})
