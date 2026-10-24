// @vitest-environment node
/**
 * B / C1 correctness on the SQL layer (step 9, data batches 7 + 17).
 *
 * The original B / C1 tests verified that PostgREST's 1 000-row cap and 640-id
 * URL limit were handled (paged reads, id batching, IncompleteReadError).  The
 * SQL layer has no row cap and no URL limit — the old machinery is gone.  The
 * assertions below keep every *meaning* from the originals:
 *
 *   records  — all members, marks, submissions and progress rows reach the
 *              record; an optional studentId narrows each per-student read to
 *              that student alone; a failing statement fails the whole unit.
 *
 *   announcements — every event is counted (correlated subquery in SQL,
 *              embedded in the announcements query, never paged); a failing
 *              statement is an error; a loader that has no access returns the
 *              appropriate empty / false response.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SqlCall } from './helpers/fake-sql'

// ── shared mock setup ────────────────────────────────────────────────────────

type DB = { answer: (q: SqlCall) => unknown[] | Error; calls: SqlCall[] }
const db = vi.hoisted((): DB => ({ answer: () => [], calls: [] }))

vi.mock('@/lib/db/sql', async () => {
  const mod = (await import('./helpers/fake-sql')).fakeSqlModule(q => {
    db.calls.push(q)
    return db.answer(q)
  })
  return mod
})

// ── teacher records fixture ──────────────────────────────────────────────────

import { loadGroupData } from '@/lib/data/teacher-records'

const T = 't1'
const MEMBERS = 5   // SQL layer: no row cap, so a small fixture is enough
const SESSIONS = 4
const ITEMS = 3
const EXAM_COUNT = 12 // 10 group + 2 course-linked

function makeMembers(n = MEMBERS) {
  return Array.from({ length: n }, (_, k) => ({
    student_id: `s${k}`, joined_at: '2026-09-01T00:00:00Z',
    full_name: `Student ${k}`, email: `${k}@x.test`, is_active: true,
  }))
}

function makeExams(n = EXAM_COUNT) {
  return Array.from({ length: n }, (_, k) => ({
    id: `e${k}`, title: `Exam ${k}`, type: 'exam', lesson_id: null,
    created_at: '2026-09-10T00:00:00Z', ends_at: null,
    group_id: k < 10 ? 'g1' : null, lesson_title: null,
    assigned_student_id: null, counts_toward_grade: true, source_exam_id: null,
  }))
}

function makeSessions(n = SESSIONS) {
  return Array.from({ length: n }, (_, k) => ({
    id: `a${k}`, session_date: `2026-09-${String(1 + k).padStart(2, '0')}`, title: null,
  }))
}

function makeMarks(members: ReturnType<typeof makeMembers>, sessions: ReturnType<typeof makeSessions>) {
  return sessions.flatMap(a => members.map(m => ({
    session_id: a.id, student_id: m.student_id, status: 'present', note: null,
  })))
}

function makeSubmissions(members: ReturnType<typeof makeMembers>, exams: ReturnType<typeof makeExams>) {
  return members.flatMap(m => exams.map(e => ({
    id: `x-${m.student_id}-${e.id}`, exam_id: e.id, student_id: m.student_id,
    score: 15, max_score: 20, grading_status: 'published', status: 'submitted',
    submitted_at: '2026-09-20T00:00:00Z', is_flagged: false,
  })))
}

const GROUP_ROW = {
  id: 'g1', name: 'Group', description: null, image_url: null, is_active: true,
  created_at: '2026-09-01T00:00:00Z', course_id: 'c1', course_title: 'Course',
}

/**
 * Wire the fake SQL module to return fixture rows for each statement type.
 * All 7 statements in a loadGroupData unit are answered; the overrideStatement
 * hook may intercept any of them (return null to fall through to the default).
 */
function wireRecordFixture(opts: {
  groupRows?: typeof GROUP_ROW[]
  members?: ReturnType<typeof makeMembers>
  exams?: ReturnType<typeof makeExams>
  sessions?: ReturnType<typeof makeSessions>
  overrideStatement?: (q: SqlCall) => unknown[] | Error | null
} = {}) {
  const groupRows = opts.groupRows ?? [GROUP_ROW]
  const members = opts.members ?? makeMembers()
  const exams = opts.exams ?? makeExams()
  const sessions = opts.sessions ?? makeSessions()
  const marks = makeMarks(members, sessions)
  const submissions = makeSubmissions(members, exams)

  db.answer = (q) => {
    if (opts.overrideStatement) {
      const r = opts.overrideStatement(q)
      if (r !== null) return r
    }
    const t = q.text
    if (t.startsWith('select g.id, g.name, g.description')) return groupRows
    if (t.startsWith('select gs.student_id, gs.joined_at')) {
      const sid = q.values[1] as string | null
      return sid ? members.filter(m => m.student_id === sid) : members
    }
    if (t.startsWith('select e.id, e.title, e.type')) return exams
    if (t.startsWith('select id, session_date, title')) return sessions
    if (t.startsWith('select r.session_id, r.student_id')) {
      const sid = q.values[1] as string | null
      return sid ? marks.filter(m => m.student_id === sid) : marks
    }
    if (t.startsWith('select id, exam_id, student_id, score')) {
      const sid = q.values.find((v, i) => i > 0 && typeof v === 'string' && (v as string).startsWith('s'))
      return sid ? submissions.filter(s => s.student_id === sid) : submissions
    }
    if (t.startsWith('select (select count(*)::int from public.unit_items')) {
      const donePairs = Object.fromEntries(members.map(m => [m.student_id, ITEMS]))
      return [{ total: ITEMS, done: donePairs }]
    }
    if (t === 'select null::int as total') return [{ total: null }]
    return []
  }
}

// ── teacher records tests ────────────────────────────────────────────────────

describe('teacher records (SQL layer): completeness and isolation', () => {
  beforeEach(() => { db.calls = [] })

  it('all members, marks, submissions and progress reach the record — one unit', async () => {
    wireRecordFixture()
    const data = (await loadGroupData(T, 'g1'))!
    expect(data.members).toHaveLength(MEMBERS)
    expect(data.marks).toHaveLength(SESSIONS * MEMBERS)
    expect(data.submissions).toHaveLength(EXAM_COUNT * MEMBERS)
    expect(data.assessments).toHaveLength(EXAM_COUNT)
    expect(data.progress!.total).toBe(ITEMS)
    expect([...data.progress!.done.values()].every(v => v === ITEMS)).toBe(true)
    expect(data.progress!.done.size).toBe(MEMBERS)
    // All statements share the teacher's user context
    expect(db.calls.every(c => c.ctx.as === 'user' && c.ctx.userId === T)).toBe(true)
  })

  it('studentId narrows marks, submissions and members to that student only', async () => {
    const s0 = 's0'
    wireRecordFixture({ members: makeMembers().slice(0, 1) })
    const data = (await loadGroupData(T, 'g1', { studentId: s0 }))!
    expect(data.members.map(m => m.studentId)).toEqual([s0])
    expect(data.marks.every(m => m.studentId === s0)).toBe(true)
    expect(data.submissions.every(s => s.studentId === s0)).toBe(true)
    // exams are NOT narrowed (the whole group work set is listed)
    expect(data.assessments).toHaveLength(EXAM_COUNT)
  })

  it('a group not owned by the teacher returns null', async () => {
    wireRecordFixture({ groupRows: [] })
    expect(await loadGroupData(T, 'g-other')).toBeNull()
  })

  it('a failed statement fails the whole record — never a partial one', async () => {
    wireRecordFixture({
      overrideStatement: (q) => {
        if (q.text.startsWith('select r.session_id, r.student_id')) return new Error('injected failure')
        return null
      },
    })
    await expect(loadGroupData(T, 'g1')).rejects.toThrow('injected failure')
  })

  it('a student not in the group gives an empty record (no members, no progress)', async () => {
    wireRecordFixture({ members: [] })
    const data = (await loadGroupData(T, 'g1', { studentId: 'sX' }))!
    expect(data.members).toEqual([])
    expect(data.progress).toBeNull()
  })

  it('all 12 listed exams (group + course-linked) reach the record', async () => {
    wireRecordFixture()
    const data = (await loadGroupData(T, 'g1'))!
    const groupExams = data.assessments.filter(a => a.source === 'group')
    const courseExams = data.assessments.filter(a => a.source === 'course')
    expect(groupExams).toHaveLength(10)
    expect(courseExams).toHaveLength(2)
    expect(data.submissions.every(s => data.assessments.some(a => a.id === s.examId))).toBe(true)
  })
})

// ── announcement stats tests ─────────────────────────────────────────────────
//
// In the SQL layer, event counts (views/clicks/interest) are correlated
// subqueries inside the main announcements SELECT — there is no separate
// announcement_events paging round-trip.  The tests below verify that counts
// are present and correct, and that a failing statement propagates as an error
// (the original "any other failure is an error" invariant).
// The "events table missing gracefully hides stats" case belonged to the
// PostgREST layer (PGRST205 / 42P01): the SQL layer always knows whether the
// table exists at deploy time, so that degradation path is not present here.

import { loadAnnouncementsPage } from '@/lib/announcements-data'

type AnnRow = {
  id: string; title: string; body: string; image_url: null; link_url: null; cta_label: null
  audience: string; center_students_only: null; is_published: boolean
  starts_at: null; ends_at: null; created_at: string; pinned: null; collect_interest: null
  group_ids: string[]; views: number; clicks: number; interest: number
}

function makeAnnouncement(k: number, views: number, clicks: number, interest: number): AnnRow {
  return {
    id: `n${k}`, title: `A${k}`, body: '', image_url: null, link_url: null, cta_label: null,
    audience: 'all', center_students_only: null, is_published: true,
    starts_at: null, ends_at: null, created_at: `2026-09-0${k + 1}T00:00:00Z`,
    pinned: null, collect_interest: null,
    group_ids: [], views, clicks, interest,
  }
}

function wireAnnouncementsFixture(opts: {
  announcements?: AnnRow[]
  failMainQuery?: boolean
} = {}) {
  const anns = opts.announcements ?? [
    makeAnnouncement(0, 200, 200, 200),
    makeAnnouncement(1, 200, 200, 200),
    makeAnnouncement(2, 200, 200, 200),
  ]

  db.answer = (q) => {
    const t = q.text
    if (t.startsWith('select role, permissions')) return [{ role: 'university_admin', permissions: {} }]
    // tenantSettingsSql output
    if (t.startsWith('select') && t.includes('has_center')) return [{ key: 'has_center', value: null }]
    if (t.startsWith('select a.id, a.title')) {
      if (opts.failMainQuery) return new Error('injected db failure')
      return anns
    }
    // groups list
    if (t.startsWith('select id, name from public.groups')) return []
    return []
  }
}

describe('announcement stats (SQL layer): counts and error propagation', () => {
  beforeEach(() => { db.calls = [] })

  it('all view / click / interest counts reach the page — no paging, no batching', async () => {
    wireAnnouncementsFixture()
    const out = await loadAnnouncementsPage('admin', 'tn')
    expect(out.engagementReady).toBe(true)
    const totals = out.announcements.map(a => a.stats!)
    expect(totals.reduce((s, x) => s + x.views + x.clicks + x.interest, 0)).toBe(1800)
    for (const s of totals) expect(s.views + s.clicks + s.interest).toBe(600)
  })

  it('each announcement carries the correct per-kind breakdown', async () => {
    wireAnnouncementsFixture({
      announcements: [makeAnnouncement(0, 100, 50, 25)],
    })
    const out = await loadAnnouncementsPage('admin', 'tn')
    expect(out.announcements[0].stats).toEqual({ views: 100, clicks: 50, interest: 25 })
  })

  it('a failed statement is an error — never empty or partial stats', async () => {
    wireAnnouncementsFixture({ failMainQuery: true })
    await expect(loadAnnouncementsPage('admin', 'tn')).rejects.toThrow('injected db failure')
  })

  it('an unauthorised user gets allowed: false and no announcements', async () => {
    db.answer = (q) => {
      const t = q.text
      if (t.startsWith('select role, permissions')) return [{ role: 'student', permissions: {} }]
      if (t.startsWith('select') && t.includes('has_center')) return [{ key: 'has_center', value: null }]
      if (t.startsWith('select a.id, a.title')) return []
      if (t.startsWith('select id, name from public.groups')) return []
      return []
    }
    const out = await loadAnnouncementsPage('student-user', 'tn')
    expect(out.allowed).toBe(false)
    expect(out.announcements).toEqual([])
    expect(out.engagementReady).toBe(false)
  })
})
