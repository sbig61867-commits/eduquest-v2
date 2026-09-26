import { describe, expect, it } from 'vitest'
import { getRoleLabel } from '@/lib/utils'
import { getTerms, INSTITUTION_TYPES } from '@/lib/terminology'
import type { Role } from '@/types'

// The institution admin (university_admin) and the continuing-education
// manager (center_manager) are separate accounts with separate powers. A
// training-centre tenant used to label BOTH «مدير المركز» / "Center Manager",
// and «المركز» meant both the institution and the continuing-education centre.
const ROLES: Role[] = ['super_admin', 'university_admin', 'center_manager', 'teacher', 'student']

describe('role labels never overlap', () => {
  for (const locale of ['ar', 'en'] as const) {
    for (const type of INSTITUTION_TYPES) {
      it(`${locale} · ${type}: every role has its own label`, () => {
        const labels = ROLES.map(r => getRoleLabel(r, type, locale))
        expect(new Set(labels).size).toBe(labels.length)
      })

      it(`${locale} · ${type}: institution admin and CE manager are clearly distinct`, () => {
        const admin = getRoleLabel('university_admin', type, locale)
        const ce = getRoleLabel('center_manager', type, locale)
        expect(admin).not.toBe(ce)
        // Neither name may be contained in the other (e.g. «مدير المركز» inside a longer title).
        expect(ce.includes(admin)).toBe(false)
        expect(admin.includes(ce)).toBe(false)
        // The institution's own students never share a name with continuing-education students.
        expect(getTerms(type, locale).institutionStudents).not.toMatch(locale === 'ar' ? /التعليم المستمر/ : /continuing/i)
      })
    }
  }
})
