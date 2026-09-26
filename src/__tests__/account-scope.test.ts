import { describe, expect, it } from 'vitest'
import { studentBlock, teacherBlock, teacherFootprints } from '@/lib/account-scope'

describe('centre manager account scope', () => {
  it('lets the centre manage centre-only students only', () => {
    expect(studentBlock(false)).toBeNull()
    expect(studentBlock(true)).toBe('universityStudent')
    // NULL is the column default (TRUE): university-owned, not the centre's.
    expect(studentBlock(null)).toBe('universityStudent')
  })

  it('classifies teachers by where they teach', () => {
    const f = teacherFootprints(
      [
        { teacher_id: 'shared', course_id: null },   // university group
        { teacher_id: 'shared', course_id: 'c1' },   // centre section
        { teacher_id: 'uni', course_id: null },
        { teacher_id: 'section', course_id: 'c2' },
      ],
      [{ teacher_id: 'shared' }, { teacher_id: 'centre' }],
    )
    const block = (id: string) => teacherBlock(f.get(id) ?? { universityGroups: 0, centreItems: 0 })
    expect(block('shared')).toBe('sharedTeacher')      // teaches at both → institution admin only
    expect(block('uni')).toBe('sharedTeacher')
    expect(block('centre')).toBeNull()                 // course only → centre may manage
    expect(block('section')).toBeNull()                // course-linked group only
    expect(block('nobody')).toBe('unassignedTeacher')  // not claimed by the centre yet
  })
})
