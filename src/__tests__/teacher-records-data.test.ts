// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * P-10 (PERFORMANCE_CONTRACT.md P2, P4, P5) on the SQL layer (step 9). A group's
 * record is ONE unit read as the teacher: the group (teacher-filtered), its
 * roster, exams by named columns (never `questions` or `*`), sessions, marks,
 * submissions and course progress — each keyed by the group itself (joins, not
 * id lists). The overview lists the groups once, then reads every group's
 * statements in ONE more unit without course progress; a student's record
 * narrows the per-student statements to that one student.
 */

type Q = { text: string; values: unknown[]; ctx: { as: string; userId?: string } }
const db = vi.hoisted(() => ({ calls: [] as Q[], units: 0, replies: {} as Record<string, unknown[]> }))
vi.mock('@/lib/db/sql', async () => {
  const mod = (await import('./helpers/fake-sql')).fakeSqlModule(q => {
    db.calls.push(q as Q)
    const t = q.text
    if (t.startsWith('select g.id, g.name, g.description')) return db.replies.groups
    if (t.startsWith('select gs.student_id, gs.joined_at')) return db.replies.members
    if (t.startsWith('select e.id, e.title, e.type')) return db.replies.exams
    if (t.startsWith('select id, session_date, title')) return db.replies.sessions
    if (t.startsWith('select r.session_id, r.student_id')) return db.replies.marks
    if (t.startsWith('select id, exam_id, student_id, score')) return db.replies.submissions
    if (t.startsWith('select (select count(*)::int from public.unit_items')) return db.replies.progress
    if (t === 'select null::int as total') return [{ total: null }]
    return new Error('unexpected statement: ' + t)
  })
  const run = mod.run
  return { ...mod, run: (...a: Parameters<typeof run>) => { db.units++; return run(...a) } }
})

import { loadGroupCards, loadGroupData } from '@/lib/data/teacher-records'
import { buildItems } from '@/lib/teacher-records'

const GROUP = { id: 'g1', name: 'Group 1', description: null, image_url: null, is_active: true, created_at: '2026-09-01T00:00:00Z', course_id: 'c1', course_title: 'Course' }
const of = (prefix: string) => db.calls.filter(q => q.text.startsWith(prefix))

beforeEach(() => {
  db.calls = []; db.units = 0
  db.replies = {
    groups: [GROUP],
    members: [
      { student_id: 's1', joined_at: '2026-09-01T00:00:00Z', full_name: 'Sara', email: 's1@x', is_active: true },
      { student_id: 's2', joined_at: '2026-09-01T00:00:00Z', full_name: 'Omar', email: 's2@x', is_active: true },
    ],
    exams: [{ id: 'e1', title: 'Midterm', type: 'exam', lesson_id: null, created_at: '2026-09-10T00:00:00Z', ends_at: '2026-09-11T00:00:00Z',
      group_id: 'g1', lesson_title: null, assigned_student_id: null, counts_toward_grade: true, source_exam_id: null }],
    sessions: [{ id: 'a1', session_date: '2026-09-12', title: null }],
    marks: [{ session_id: 'a1', student_id: 's1', status: 'present', note: null }],
    submissions: [{ id: 'x1', exam_id: 'e1', student_id: 's1', score: 15, max_score: 20, grading_status: 'published',
      status: 'submitted', submitted_at: '2026-09-10T10:00:00Z', is_flagged: false }],
    progress: [{ total: 4, done: { s1: 2 } }],
  }
})

describe('loadGroupData — group page (P-10)', () => {
  it('ONE unit as the teacher: the group, roster, exams, sessions, marks, submissions and course progress', async () => {
    const data = await loadGroupData('t1', 'g1')
    expect(db.units).toBe(1)
    expect(db.calls).toHaveLength(7)
    expect(db.calls.every(q => q.ctx.as === 'user' && q.ctx.userId === 't1')).toBe(true)
    const [group] = db.calls
    expect(group.text).toContain('where g.teacher_id = $ and ($::uuid is null or g.id = $::uuid)')
    expect(group.values).toEqual(['t1', 'g1', 'g1'])
    expect(data!.members.map(m => m.studentId)).toEqual(['s2', 's1'])
    expect(data!.progress).toMatchObject({ total: 4 })
    expect(data!.progress!.done.get('s1')).toBe(2)
  })

  it('exams: named columns — never questions or * — with the teacher / published / live / group-or-course conditions', async () => {
    await loadGroupData('t1', 'g1')
    const [exams] = of('select e.id, e.title, e.type')
    expect(exams.text).toContain('e.counts_toward_grade, e.source_exam_id, l.title as lesson_title')
    expect(exams.text).not.toMatch(/questions|\*/)
    expect(exams.text).toContain('e.teacher_id = $ and e.is_published and e.deleted_at is null')
    expect(exams.text).toContain('(e.group_id = g.id or (g.course_id is not null and e.course_id = g.course_id))')
    // Submissions go through the same exam conditions (no exam id list) and the group's members.
    const [subs] = of('select id, exam_id, student_id, score')
    expect(subs.text).toContain('where exam_id in (select e.id from public.exams e')
    expect(subs.text).toContain('student_id in (select gs.student_id from public.group_students gs')
    expect(subs.text).not.toContain('questions')
  })

  it('the group\'s roster and marks are not narrowed to a student here', async () => {
    await loadGroupData('t1', 'g1')
    expect(of('select gs.student_id, gs.joined_at')[0].values).toEqual(['g1', null, null])
    expect(of('select r.session_id, r.student_id')[0].values).toEqual(['g1', null, null])
  })

  it('not the teacher\'s group → null', async () => {
    db.replies.groups = []
    expect(await loadGroupData('t1', 'g9')).toBeNull()
  })

  it('a graded item takes its maximum from the submission (questions are not read)', async () => {
    const data = (await loadGroupData('t1', 'g1'))!
    expect(data.assessments[0].maxPoints).toBe(0)
    const items = buildItems(data.assessments, data.submissions.filter(s => s.studentId === 's1'), null, Date.parse('2026-10-01'), 's1')
    expect(items[0]).toMatchObject({ status: 'graded', score: 15, max: 20, pct: 75 })
  })
})

describe('loadGroupData — one student\'s record (P-10)', () => {
  it('roster, marks, submissions and progress are read for that student only', async () => {
    db.replies.members = [db.replies.members[0]]
    const data = (await loadGroupData('t1', 'g1', { studentId: 's1' }))!
    expect(of('select gs.student_id, gs.joined_at')[0].values).toEqual(['g1', 's1', 's1'])
    expect(of('select r.session_id, r.student_id')[0].values).toEqual(['g1', 's1', 's1'])
    expect(of('select id, exam_id, student_id, score')[0].values).toContain('s1')
    expect(of('select (select count(*)::int from public.unit_items')[0].values).toContain('s1')
    // The work set for the group is still listed whole (the follow-up composer picks from it).
    expect(of('select e.id, e.title, e.type')[0].values).not.toContain('s1')
    expect(data.members.map(m => m.studentId)).toEqual(['s1'])
  })

  it('a student who is not in the group gets an empty record (no members, no progress)', async () => {
    db.replies.members = []
    db.replies.submissions = []
    const data = (await loadGroupData('t1', 'g1', { studentId: 'sX' }))!
    expect(data.members).toEqual([])
    expect(data.progress).toBeNull()
  })
})

describe('loadGroupCards — overview (P-10)', () => {
  it('lists the groups once, then every group in ONE more unit, without course progress', async () => {
    db.replies.groups = [GROUP, { ...GROUP, id: 'g2', name: 'Group 2', course_id: null, course_title: null }]
    const cards = await loadGroupCards('t1', Date.parse('2026-10-01'))
    expect(db.units).toBe(2)
    expect(of('select g.id, g.name, g.description')).toHaveLength(1)
    expect(of('select g.id, g.name, g.description')[0].values).toEqual(['t1', null, null])
    expect(of('select gs.student_id, gs.joined_at')).toHaveLength(2)
    expect(of('select (select count(*)::int from public.unit_items')).toHaveLength(0)
    // The numbers come from the same summary as inside the group.
    expect(cards.map(c => c.group.id)).toEqual(['g1', 'g2'])
    expect(cards[0]).toMatchObject({ students: 2, exams: 1, homework: 0, avg: 75, attendanceRate: 100, atRisk: 0 })
  })

  it('no groups → no second unit', async () => {
    db.replies.groups = []
    expect(await loadGroupCards('t1', Date.now())).toEqual([])
    expect(db.units).toBe(1)
  })
})
