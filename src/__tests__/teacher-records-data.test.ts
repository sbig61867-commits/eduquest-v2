import { describe, it, expect, beforeEach } from 'vitest'
import { loadGroupCards, loadGroupData, RECORD_EXAM_COLUMNS } from '@/lib/data/teacher-records'
import { buildItems } from '@/lib/teacher-records'

/**
 * P-10 (PERFORMANCE_CONTRACT.md P2, P4, P5). Teacher records read exams by named
 * columns (never `questions` or `*`), the overview reuses the groups it listed
 * (no second read per group) and skips course progress, the attendance marks
 * join the first round, and a student's record reads that one student's rows.
 *
 * The mock resolves queries only on flush(), so each flush is one round of
 * requests to the database.
 */

type Call = { table: string; columns: string; head: boolean; single: boolean; filters: unknown[][] }
let calls: Call[]
let pending: (() => void)[]
let replies: Record<string, unknown>

const db = () => ({
  from: (table: string) => ({
    select: (columns: string, opts?: { head?: boolean }) => {
      const call: Call = { table, columns, head: !!opts?.head, single: false, filters: [] }
      calls.push(call)
      const result = () =>
        call.single ? { data: replies[`${table}:single`] ?? null, error: null }
          : call.head ? { data: null, count: replies[`${table}:count`] ?? 0, error: null }
          : { data: replies[table] ?? [], error: null }
      const chain: Record<string, unknown> = {}
      for (const op of ['eq', 'in', 'is', 'or', 'order']) chain[op] = (...a: unknown[]) => { call.filters.push([op, ...a]); return chain }
      chain.maybeSingle = () => { call.single = true; return chain }
      chain.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        new Promise(r => pending.push(() => r(result()))).then(res, rej)
      return chain
    },
  }),
}) as never

/** Resolve every query in flight (one round), then let the loader start the next. */
async function flush() {
  // `await` asks a thenable for its result in a later microtask: let those land first.
  await new Promise(r => setTimeout(r, 0))
  const now = pending
  pending = []
  now.forEach(f => f())
  await new Promise(r => setTimeout(r, 0))
}
/** Tables of the calls started since `from`. */
const since = (from: number) => calls.slice(from).map(c => c.table)
const callOf = (table: string) => calls.find(c => c.table === table)!

const GROUP = { id: 'g1', name: 'Group 1', description: null, image_url: null, is_active: true, created_at: '2026-09-01T00:00:00Z', course_id: 'c1', courses: { title: 'Course' } }

beforeEach(() => {
  calls = []; pending = []
  replies = {
    'groups:single': GROUP,
    groups: [GROUP, { ...GROUP, id: 'g2', name: 'Group 2', course_id: null, courses: null }],
    group_students: [
      { student_id: 's1', joined_at: '2026-09-01T00:00:00Z', users: { full_name: 'Sara', email: 's1@x', is_active: true } },
      { student_id: 's2', joined_at: '2026-09-01T00:00:00Z', users: { full_name: 'Omar', email: 's2@x', is_active: true } },
    ],
    exams: [{ id: 'e1', title: 'Midterm', type: 'exam', lesson_id: null, created_at: '2026-09-10T00:00:00Z', ends_at: '2026-09-11T00:00:00Z',
      group_id: 'g1', lessons: null, assigned_student_id: null, counts_toward_grade: true, source_exam_id: null }],
    attendance_sessions: [{ id: 'a1', session_date: '2026-09-12', title: null }],
    attendance_records: [{ session_id: 'a1', student_id: 's1', status: 'present', note: null }],
    exam_submissions: [{ id: 'x1', exam_id: 'e1', student_id: 's1', score: 15, max_score: 20, grading_status: 'published',
      status: 'submitted', submitted_at: '2026-09-10T10:00:00Z', is_flagged: false }],
    'unit_items:count': 4,
    student_progress: [{ student_id: 's1' }, { student_id: 's1' }],
  }
})

describe('exam columns (P-10)', () => {
  it('named columns, exactly what a record uses — never questions or *', () => {
    expect(RECORD_EXAM_COLUMNS).toBe(
      'id, title, type, lesson_id, created_at, ends_at, group_id, assigned_student_id, counts_toward_grade, source_exam_id, lessons(title)')
    expect(RECORD_EXAM_COLUMNS).not.toMatch(/questions|\*/)
  })
})

describe('loadGroupData — group page (P-10)', () => {
  it('three rounds: the group; roster + exams + sessions + marks; submissions + course progress', async () => {
    const done = loadGroupData(db(), 't1', 'g1')
    await new Promise(r => setTimeout(r, 0))
    expect(since(0)).toEqual(['groups'])
    expect(callOf('groups').filters).toEqual([['eq', 'id', 'g1'], ['eq', 'teacher_id', 't1']])
    await flush()
    expect(since(1).sort()).toEqual(['attendance_records', 'attendance_sessions', 'exams', 'group_students'])
    await flush()
    expect(since(5)).toEqual(['exam_submissions', 'unit_items', 'student_progress'])
    await flush(); await flush()
    const data = await done
    expect(data!.members.map(m => m.studentId)).toEqual(['s2', 's1'])
    expect(data!.progress).toMatchObject({ total: 4 })
    expect(data!.progress!.done.get('s1')).toBe(2)
  })

  it('exams: named columns + the teacher / published / live / group-or-course filters', async () => {
    const done = loadGroupData(db(), 't1', 'g1')
    await flush(); await flush(); await flush(); await flush()
    await done
    const exams = callOf('exams')
    expect(exams.columns).toBe(RECORD_EXAM_COLUMNS)
    expect(exams.filters).toEqual([
      ['eq', 'teacher_id', 't1'], ['eq', 'is_published', true], ['is', 'deleted_at', null], ['or', 'group_id.eq.g1,course_id.eq.c1'],
    ])
    // The group's roster and marks are not narrowed to a student here.
    expect(callOf('group_students').filters).toEqual([['eq', 'group_id', 'g1']])
    expect(callOf('attendance_records').filters).toEqual([['eq', 'attendance_sessions.group_id', 'g1']])
    expect(callOf('exam_submissions').filters).toEqual([['in', 'exam_id', ['e1']], ['in', 'student_id', ['s2', 's1']]])
  })

  it('not the teacher\'s group → null, and nothing else is read', async () => {
    replies['groups:single'] = null
    const done = loadGroupData(db(), 't1', 'g9')
    await flush()
    expect(await done).toBeNull()
    expect(since(0)).toEqual(['groups'])
  })

  it('a graded item takes its maximum from the submission (questions are not read)', async () => {
    const done = loadGroupData(db(), 't1', 'g1')
    await flush(); await flush(); await flush(); await flush()
    const data = (await done)!
    expect(data.assessments[0].maxPoints).toBe(0)
    const items = buildItems(data.assessments, data.submissions.filter(s => s.studentId === 's1'), null, Date.parse('2026-10-01'), 's1')
    expect(items[0]).toMatchObject({ status: 'graded', score: 15, max: 20, pct: 75 })
  })
})

describe('loadGroupData — one student\'s record (P-10)', () => {
  it('roster, marks, submissions and progress are read for that student only', async () => {
    replies.group_students = [(replies.group_students as unknown[])[0]]
    const done = loadGroupData(db(), 't1', 'g1', { studentId: 's1' })
    await flush(); await flush(); await flush(); await flush()
    const data = (await done)!
    expect(callOf('group_students').filters).toEqual([['eq', 'group_id', 'g1'], ['eq', 'student_id', 's1']])
    expect(callOf('attendance_records').filters).toEqual([['eq', 'attendance_sessions.group_id', 'g1'], ['eq', 'student_id', 's1']])
    expect(callOf('exam_submissions').filters).toContainEqual(['in', 'student_id', ['s1']])
    expect(callOf('student_progress').filters).toContainEqual(['in', 'student_id', ['s1']])
    // The work set for the group is still listed whole (the follow-up composer picks from it).
    expect(callOf('exams').filters).not.toContainEqual(expect.arrayContaining(['student_id']))
    expect(data.members.map(m => m.studentId)).toEqual(['s1'])
  })

  it('a student who is not in the group reads no submissions or progress', async () => {
    replies.group_students = []
    const done = loadGroupData(db(), 't1', 'g1', { studentId: 'sX' })
    await flush(); await flush()
    const data = (await done)!
    expect(data.members).toEqual([])
    expect(since(0)).not.toContain('exam_submissions')
    expect(since(0)).not.toContain('student_progress')
  })
})

describe('loadGroupCards — overview (P-10)', () => {
  it('lists the groups once, never re-reads them, and reads no course progress', async () => {
    const done = loadGroupCards(db(), 't1', Date.parse('2026-10-01'))
    await new Promise(r => setTimeout(r, 0))
    expect(since(0)).toEqual(['groups'])
    expect(callOf('groups').filters).toEqual([['eq', 'teacher_id', 't1'], ['order', 'created_at', { ascending: false }]])
    await flush()
    // Round 2: four reads per group, both groups at once — no `groups` read.
    expect(since(1).sort()).toEqual([
      'attendance_records', 'attendance_records', 'attendance_sessions', 'attendance_sessions',
      'exams', 'exams', 'group_students', 'group_students',
    ])
    await flush()
    expect(since(9)).toEqual(['exam_submissions', 'exam_submissions'])
    await flush()
    const cards = await done
    expect(calls.filter(c => c.table === 'groups')).toHaveLength(1)
    expect(since(0)).not.toContain('unit_items')
    expect(since(0)).not.toContain('student_progress')
    // The numbers come from the same summary as inside the group.
    expect(cards.map(c => c.group.id)).toEqual(['g1', 'g2'])
    expect(cards[0]).toMatchObject({ students: 2, exams: 1, homework: 0, avg: 75, attendanceRate: 100, atRisk: 0 })
  })
})
