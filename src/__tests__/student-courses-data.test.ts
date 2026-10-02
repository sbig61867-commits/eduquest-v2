import { describe, it, expect, beforeEach } from 'vitest'
import { loadStudentCourseList, STUDENT_COURSE_COLUMNS, STUDENT_GROUP_COLUMNS } from '@/lib/data/student-courses'

/**
 * Batch 4 / P-06. /student/courses reads named columns (never courses.* with
 * source_text, never groups(*)), in two rounds: enrolments + transfers + group
 * memberships together, then the courses + their progress together.
 */

type Call = { table: string; columns: string; filters: [string, string, unknown][] }
let calls: Call[]
let rpcs: [string, Record<string, unknown>][]
let replies: Record<string, unknown[]>
let gate: { release: () => void; promise: Promise<void> }

function newGate() {
  let release!: () => void
  const promise = new Promise<void>(r => { release = r })
  return { release, promise }
}

const db = () => ({
  from: (table: string) => ({
    select: (columns: string) => {
      const call: Call = { table, columns, filters: [] }
      calls.push(call)
      const chain = {
        eq: (k: string, v: unknown) => { call.filters.push(['eq', k, v]); return chain },
        in: (k: string, v: unknown) => { call.filters.push(['in', k, v]); return chain },
        order: (k: string) => { call.filters.push(['order', k, null]); return chain },
        then: (res: (v: unknown) => void, rej: (e: unknown) => void) =>
          (table === 'course_enrollments' ? gate.promise : Promise.resolve())
            .then(() => ({ data: replies[table] ?? [], error: null })).then(res, rej),
      }
      return chain
    },
  }),
  rpc: async (name: string, args: Record<string, unknown>) => {
    rpcs.push([name, args])
    return { data: { total: 4, completed: 1, percent: 25 }, error: null }
  },
}) as never

beforeEach(() => {
  calls = []; rpcs = []; gate = newGate()
  replies = {
    course_enrollments: [{ course_id: 'c1' }, { course_id: 'c2' }],
    group_transfers: [
      { id: 't1', from_course_id: 'c1', from_course_title: 'Back again', from_group_name: 'G0', to_course_title: null, frozen_completed: 1, frozen_total: 2, created_at: 'x' },
      { id: 't2', from_course_id: 'old', from_course_title: 'Left', from_group_name: 'G9', to_course_title: 'C1', frozen_completed: 3, frozen_total: 5, created_at: 'y' },
    ],
    group_students: [
      { groups: { id: 'g1', name: 'Section A', course_id: 'c1', image_url: 'https://i', instructions: 'Bring a pen', is_active: true } },
      { groups: [{ id: 'g2', name: 'Inactive', course_id: 'c1', is_active: false }] },
      { groups: { id: 'g3', name: 'Other course', course_id: 'zz', is_active: true } },
      { groups: { id: 'g4', name: 'No course', course_id: null } },
    ],
    courses: [{ id: 'c1', title: 'Arabic', description: null, language: 'ar', has_levels: true, users: { full_name: 'T' } }],
  }
})

describe('loadStudentCourseList (P-06)', () => {
  it('selects named columns — never *, source_text or groups(*)', async () => {
    gate.release()
    await loadStudentCourseList(db(), 's1')
    const byTable = Object.fromEntries(calls.map(c => [c.table, c.columns]))
    expect(byTable.courses).toBe(STUDENT_COURSE_COLUMNS)
    expect(byTable.group_students).toBe(STUDENT_GROUP_COLUMNS)
    expect(byTable.course_enrollments).toBe('course_id')
    for (const c of calls) {
      expect(c.columns).not.toMatch(/\*|source_text|enrolled_at/)
    }
  })

  it('round 1: transfers and memberships do not wait for the enrolments', async () => {
    const pending = loadStudentCourseList(db(), 's1')
    await new Promise(r => setTimeout(r, 0))
    expect(calls.map(c => c.table)).toEqual(['course_enrollments', 'group_transfers', 'group_students'])
    expect(rpcs).toEqual([])
    gate.release()
    await pending
    // round 2: courses and every course's progress, both after the enrolments
    expect(calls.map(c => c.table)).toEqual(['course_enrollments', 'group_transfers', 'group_students', 'courses'])
    expect(rpcs).toEqual([
      ['get_course_progress', { p_course_id: 'c1', p_student_id: 's1' }],
      ['get_course_progress', { p_course_id: 'c2', p_student_id: 's1' }],
    ])
  })

  it('every read is the caller\'s own; courses = enrolled + published, ordered by title', async () => {
    gate.release()
    await loadStudentCourseList(db(), 's1')
    for (const t of ['course_enrollments', 'group_transfers', 'group_students']) {
      expect(calls.find(c => c.table === t)!.filters).toContainEqual(['eq', 'student_id', 's1'])
    }
    expect(calls.find(c => c.table === 'courses')!.filters).toEqual([
      ['in', 'id', ['c1', 'c2']], ['eq', 'is_published', true], ['order', 'title', null],
    ])
  })

  it('maps exactly as before: linked active groups, past courses, progress per enrolled course', async () => {
    gate.release()
    const r = await loadStudentCourseList(db(), 's1')
    expect(r.courses).toEqual(replies.courses)
    expect(r.groupsByCourse).toEqual({ c1: [{ id: 'g1', name: 'Section A', image_url: 'https://i', instructions: 'Bring a pen' }] })
    expect(r.pastCourses.map(p => p.id)).toEqual(['t2'])
    expect(r.progressMap).toEqual({ c1: { total: 4, completed: 1, percent: 25 }, c2: { total: 4, completed: 1, percent: 25 } })
  })

  it('no enrolments: no course or progress read, past courses still shown', async () => {
    replies.course_enrollments = []
    gate.release()
    const r = await loadStudentCourseList(db(), 's1')
    expect(calls.map(c => c.table)).not.toContain('courses')
    expect(rpcs).toEqual([])
    expect(r).toMatchObject({ courses: [], progressMap: {}, groupsByCourse: {} })
    expect(r.pastCourses.map(p => p.id)).toEqual(['t1', 't2'])
  })
})
