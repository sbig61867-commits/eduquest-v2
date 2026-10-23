// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Batch 4 / P-06, on the SQL layer. /student/courses reads named columns (never
 * courses.* with source_text), in ONE unit read as the student: enrolments,
 * transfers, course sections, the courses with each one's progress (in the
 * same statement — no call per course).
 */

type Q = { text: string; values: unknown[]; ctx: { as: string; userId?: string } }
const db = vi.hoisted(() => ({ calls: [] as Q[], replies: {} as Record<string, unknown[]> }))
vi.mock('@/lib/db/sql', async () => (await import('./helpers/fake-sql')).fakeSqlModule(q => {
  db.calls.push(q as Q)
  if (q.text.startsWith('select course_id from public.course_enrollments')) return db.replies.enrollments
  if (q.text.startsWith('select id, from_course_id')) return db.replies.transfers
  if (q.text.startsWith('select g.id, g.name, g.course_id')) return db.replies.sections
  if (q.text.startsWith('select c.id, c.title')) return db.replies.courses
  return new Error('unexpected statement: ' + q.text)
}))

import { loadStudentCourseList } from '@/lib/data/student-courses'

beforeEach(() => {
  db.calls = []
  db.replies = {
    enrollments: [{ course_id: 'c1' }, { course_id: 'c2' }],
    transfers: [
      { id: 't1', from_course_id: 'c1', from_course_title: 'Back again', from_group_name: 'G0', to_course_title: null, frozen_completed: 1, frozen_total: 2, created_at: 'x' },
      { id: 't2', from_course_id: 'old', from_course_title: 'Left', from_group_name: 'G9', to_course_title: 'C1', frozen_completed: 3, frozen_total: 5, created_at: 'y' },
    ],
    sections: [{ id: 'g1', name: 'Section A', course_id: 'c1', image_url: 'https://i', instructions: 'Bring a pen' }],
    courses: [{ id: 'c1', title: 'Arabic', description: null, language: 'ar', has_levels: true, users: { full_name: 'T' }, progress: { total: 4, completed: 1, percent: 25 } }],
  }
})

describe('loadStudentCourseList (P-06)', () => {
  it('one unit, read as the student; named columns — never *, source_text', async () => {
    await loadStudentCourseList('s1')
    expect(db.calls).toHaveLength(4)
    expect(db.calls.every(c => c.ctx.as === 'user' && c.ctx.userId === 's1')).toBe(true)
    for (const c of db.calls) expect(c.text).not.toMatch(/select \*|\.\*|source_text/)
  })

  it('courses = enrolled + published, with progress in the same statement, ordered by title', async () => {
    await loadStudentCourseList('s1')
    const courses = db.calls.find(c => c.text.startsWith('select c.id, c.title'))!
    expect(courses.text).toContain('public.get_course_progress(c.id, $) as progress')
    expect(courses.text).toContain('where c.is_published and c.id in (select course_id from public.course_enrollments where student_id = $)')
    expect(courses.text).toContain('order by c.title')
  })

  it('maps as before: linked active sections, past courses, progress per enrolled course', async () => {
    const r = await loadStudentCourseList('s1')
    expect(r.courses).toEqual([{ id: 'c1', title: 'Arabic', description: null, language: 'ar', has_levels: true, users: { full_name: 'T' } }])
    expect(r.groupsByCourse).toEqual({ c1: [{ id: 'g1', name: 'Section A', image_url: 'https://i', instructions: 'Bring a pen' }] })
    expect(r.pastCourses.map(p => p.id)).toEqual(['t2'])
    expect(r.progressMap).toEqual({ c1: { total: 4, completed: 1, percent: 25 }, c2: null })
  })

  it('no enrolments: no courses, past courses still shown', async () => {
    db.replies.enrollments = []
    db.replies.courses = []
    const r = await loadStudentCourseList('s1')
    expect(r).toMatchObject({ courses: [], progressMap: {}, groupsByCourse: {} })
    expect(r.pastCourses.map(p => p.id)).toEqual(['t1', 't2'])
  })
})
