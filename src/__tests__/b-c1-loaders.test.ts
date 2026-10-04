import { describe, it, expect } from 'vitest'
import { pgMock, uid, type Call, type Relations, type World } from './complete-read-fixture'
import { loadGroupData } from '@/lib/data/teacher-records'
import { loadAnnouncementsPage } from '@/lib/announcements-data'
import { IncompleteReadError, ID_BATCH } from '@/lib/data/complete-read'

/**
 * B / C1 at a real class size, on a client with the live API's limits (1000 rows
 * per response, ~640 ids per URL): a group of 150 over 30 sessions, 12 exams and
 * 10 course items holds 4 500 attendance marks, 1 800 submissions and 1 500
 * progress rows — every one must reach the record, and a failed read must fail it.
 */

const T = 't1'
const MEMBERS = 150, SESSIONS = 30, ITEMS = 10

function recordWorld(members = MEMBERS): World {
  const g = { id: 'g1', teacher_id: T, name: 'Group', description: null, image_url: null, is_active: true, created_at: '2026-09-01T00:00:00Z', course_id: 'c1', courses: { title: 'Course' } }
  const students = Array.from({ length: members }, (_, k) => uid(k, 's'))
  const exam = (k: number, over: Record<string, unknown> = {}) => ({
    id: uid(k, 'e'), teacher_id: T, is_published: true, deleted_at: null, group_id: 'g1', course_id: null,
    title: `Exam ${k}`, type: 'exam', lesson_id: null, created_at: `2026-09-${String(10 + (k % 18)).padStart(2, '0')}T00:00:00Z`,
    ends_at: null, assigned_student_id: null, counts_toward_grade: true, source_exam_id: null, lessons: null, ...over,
  })
  const exams = [
    ...Array.from({ length: 10 }, (_, k) => exam(k)),
    exam(10, { group_id: null, course_id: 'c1' }), exam(11, { group_id: null, course_id: 'c1' }),
    // Not the record's: unpublished, another teacher's, deleted.
    exam(12, { is_published: false }), exam(13, { teacher_id: 't2' }), exam(14, { deleted_at: '2026-09-20T00:00:00Z' }),
  ]
  let x = 0
  const exam_submissions = students.flatMap(s => exams.map(e => ({
    id: uid(x++, 'x'), exam_id: e.id, student_id: s, score: 15, max_score: 20, grading_status: 'published', status: 'submitted', submitted_at: '2026-09-20T00:00:00Z', is_flagged: false,
  })))
  const attendance_sessions = Array.from({ length: SESSIONS }, (_, k) => ({ id: uid(k, 'a'), group_id: 'g1', session_date: `2026-09-${String(1 + k).padStart(2, '0')}`, title: null }))
  const attendance_records = attendance_sessions.flatMap(a => students.map(s => ({ session_id: a.id, student_id: s, status: 'present', note: null })))
  const unit_items = [
    ...Array.from({ length: ITEMS }, (_, k) => ({ id: uid(k, 'u'), course_id: 'c1', is_published: true })),
    { id: uid(99, 'u'), course_id: 'c1', is_published: false },
  ]
  let p = 0
  const student_progress = students.flatMap(s => unit_items.map(u => ({ id: uid(p++, 'p'), student_id: s, unit_item_id: u.id })))
  return {
    groups: [g],
    group_students: students.map((s, k) => ({ group_id: 'g1', student_id: s, joined_at: '2026-09-01T00:00:00Z', users: { full_name: `Student ${k}`, email: `${k}@x.test`, is_active: true } })),
    exams, exam_submissions, attendance_sessions, attendance_records, unit_items, student_progress,
  }
}

const RECORD_RELATIONS: Relations = {
  attendance_records: { attendance_sessions: (w, r) => w.attendance_sessions.find(a => a.id === r.session_id) },
  exam_submissions: { exams: (w, r) => w.exams.find(e => e.id === r.exam_id) },
  student_progress: { unit_items: (w, r) => w.unit_items.find(u => u.id === r.unit_item_id) },
}

const load = (world: World, opts: Parameters<typeof pgMock>[1] = {}, studentId?: string) =>
  loadGroupData(pgMock(world, { relations: RECORD_RELATIONS, ...opts }) as never, T, 'g1', studentId ? { studentId } : {})

describe('teacher records (B + C1): a group past the row cap and the URL limit', () => {
  it('every attendance mark, submission and progress row reaches the record', async () => {
    const calls: Call[] = []
    const data = (await load(recordWorld(), { calls }))!
    expect(data.members).toHaveLength(MEMBERS)
    expect(data.marks).toHaveLength(SESSIONS * MEMBERS)          // 4 500
    expect(data.submissions).toHaveLength(12 * MEMBERS)          // 1 800: only the 12 listed exams
    const listed = new Set(data.assessments.map(a => a.id))
    expect(listed.size).toBe(12)
    expect(data.submissions.every(s => listed.has(s.examId))).toBe(true)
    expect(data.progress!.total).toBe(ITEMS)
    expect([...data.progress!.done.values()].every(v => v === ITEMS)).toBe(true)
    expect(data.progress!.done.size).toBe(MEMBERS)
    // No request ever carried more than one batch of ids.
    expect(Math.max(...calls.map(c => c.inIds))).toBeLessThanOrEqual(ID_BATCH)
  })

  it('640+ members: the batches stay under the URL limit and every member is read', async () => {
    const data = (await load(recordWorld(700)))!
    expect(data.submissions).toHaveLength(12 * 700)
    expect(data.progress!.done.size).toBe(700)
  })

  it('one student\'s record still reads that student only', async () => {
    const s0 = uid(0, 's')
    const data = (await load(recordWorld(), {}, s0))!
    expect(data.members.map(m => m.studentId)).toEqual([s0])
    expect(data.marks).toHaveLength(SESSIONS)
    expect(data.submissions).toHaveLength(12)
    expect(data.progress!.done.get(s0)).toBe(ITEMS)
  })

  it('a failed read fails the record — never a partial one', async () => {
    const page = (table: string, test: (c: Call) => boolean) => (c: Call) => c.table === table && test(c)
    // A middle page of the marks.
    await expect(load(recordWorld(), { fail: page('attendance_records', c => c.range?.[0] === 2000) })).rejects.toBeInstanceOf(IncompleteReadError)
    // The second batch of members' submissions.
    let subBatches = 0
    await expect(load(recordWorld(), { fail: page('exam_submissions', c => !c.head && ++subBatches === 2) })).rejects.toBeInstanceOf(IncompleteReadError)
    // The progress count, and the course items count.
    await expect(load(recordWorld(), { fail: page('student_progress', c => c.head) })).rejects.toBeInstanceOf(IncompleteReadError)
    await expect(load(recordWorld(), { fail: page('unit_items', c => c.head) })).rejects.toBeInstanceOf(IncompleteReadError)
  })

  it('under the cap the record is exactly the data (same as before: nothing added, nothing missing)', async () => {
    const world = recordWorld(5)
    const data = (await load(world))!
    expect(data.marks).toHaveLength(SESSIONS * 5)
    const want = world.exam_submissions.filter(s => {
      const e = world.exams.find(x => x.id === s.exam_id)!
      return e.teacher_id === T && e.is_published && !e.deleted_at
    }).map(s => s.id).sort()
    expect(data.submissions.map(s => s.id).sort()).toEqual(want)
  })
})

describe('announcement stats (B): every event counted, past the row cap', () => {
  const TENANT = 'tn'
  function world(events: number): World {
    const anns = [uid(1, 'n'), uid(2, 'n'), uid(3, 'n')]
    const kinds = ['view', 'click', 'interest']
    return {
      users: [{ id: 'admin', role: 'university_admin', permissions: {} }],
      tenants: [{ id: TENANT, has_center: false }],
      announcements: anns.map((id, k) => ({ id, tenant_id: TENANT, title: `A${k}`, body: '', audience: 'all', is_published: true, created_at: `2026-09-0${k + 1}T00:00:00Z`, announcement_groups: [] })),
      groups: [],
      announcement_events: Array.from({ length: events }, (_, k) => ({ id: uid(k, 'v'), tenant_id: TENANT, announcement_id: anns[k % 3], kind: kinds[Math.floor(k / 3) % 3] })),
    }
  }
  const page = (w: World, opts: Parameters<typeof pgMock>[1] = {}) => loadAnnouncementsPage(pgMock(w, opts) as never, 'admin', TENANT)

  it('1 800 events: every view / click / interest counted', async () => {
    const out = await page(world(1800))
    expect(out.engagementReady).toBe(true)
    const totals = out.announcements.map(a => a.stats!)
    expect(totals.reduce((s, x) => s + x.views + x.clicks + x.interest, 0)).toBe(1800)
    for (const s of totals) expect(s.views + s.clicks + s.interest).toBe(600)
  })

  it('the events table missing (PGRST205 / 42P01) is the one case that hides the stats', async () => {
    for (const code of ['PGRST205', '42P01']) {
      const out = await page(world(10), { fail: c => c.table === 'announcement_events' && { code, message: 'missing' } })
      expect(out.engagementReady).toBe(false)
      expect(out.announcements.every(a => a.stats === null)).toBe(true)
    }
  })

  it('any other failure is an error, never empty or partial stats', async () => {
    await expect(page(world(1800), { fail: c => c.table === 'announcement_events' && !c.head && c.filters.some(f => f[0] === 'gt' && f[2] !== '00000000-0000-0000-0000-000000000000') }))
      .rejects.toBeInstanceOf(IncompleteReadError)
    await expect(page(world(10), { fail: c => c.table === 'announcement_events' && c.head })).rejects.toBeInstanceOf(IncompleteReadError)
  })
})
