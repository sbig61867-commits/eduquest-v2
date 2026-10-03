import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * P-08 — GET /api/notifications, role by role. The snapshots were recorded from
 * the route BEFORE P-08 (per-table reads); the route now reads one feed,
 * get_my_notifications(), and must produce exactly the same notifications.
 *
 * The client mock serves both shapes over one fixture per role: the old
 * per-table reads, and the new feed (computed here the way the SQL function
 * computes it — supabase/tests/notifications_feed_check.sql proves the SQL
 * returns what the old reads returned, as each role, under RLS).
 */

type Row = Record<string, unknown>
type Fixture = Record<string, Row[]> & { exam_list?: Row[] }
interface Who { id: string; role?: string; tenant_id?: string | null }

let fixture: Fixture
let who: Who | null
let calls: { kind: 'from' | 'rpc'; name: string }[]
let dbProfile: Row | null

vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string, params?: Record<string, unknown>) => `${key}${params ? ':' + JSON.stringify(params) : ''}`,
}))
vi.mock('@/lib/api-error', () => ({ apiErr: async (k: string) => ({ error: k }) }))

function table(name: string) {
  const preds: ((r: Row) => boolean)[] = []
  let sortCol: string | null = null, asc = true, lim: number | null = null, single = false
  const chain: Record<string, unknown> = {}
  chain.select = () => chain
  chain.eq = (c: string, v: unknown) => { preds.push(r => r[c] === v); return chain }
  chain.in = (c: string, v: unknown[]) => { preds.push(r => v.includes(r[c])); return chain }
  chain.is = (c: string, v: unknown) => { preds.push(r => (v === null ? r[c] == null : r[c] === v)); return chain }
  chain.not = (c: string, op: string, v: unknown) => { if (op === 'is' && v === null) preds.push(r => r[c] != null); return chain }
  chain.order = (c: string, o?: { ascending?: boolean }) => { sortCol = c; asc = o?.ascending !== false; return chain }
  chain.limit = (n: number) => { lim = n; return chain }
  chain.single = () => { single = true; return chain }
  chain.then = (res: (v: unknown) => unknown) => {
    if (name === 'users' && single) return Promise.resolve({ data: dbProfile, error: null }).then(res)
    let rows = (fixture[name] ?? []).filter(r => preds.every(p => p(r)))
    if (sortCol) {
      const c = sortCol
      // PostgREST: ascending nulls last, descending nulls first; stable.
      rows = [...rows].sort((a, b) => {
        const x = a[c] as string | null, y = b[c] as string | null
        if (x == null || y == null) return x == null && y == null ? 0 : x == null ? (asc ? 1 : -1) : (asc ? -1 : 1)
        return asc ? (x < y ? -1 : x > y ? 1 : 0) : (x > y ? -1 : x < y ? 1 : 0)
      })
    }
    if (lim != null) rows = rows.slice(0, lim)
    return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null }).then(res)
  }
  return chain
}

/** get_my_notifications(), as the SQL function computes it over the same rows. */
function feed(): Row {
  const uid = who!.id
  const role = (dbProfile?.role as string | undefined) ?? who!.role
  const byDateDesc = (c: string) => (a: Row, b: Row) => {
    const x = a[c] as string | null, y = b[c] as string | null
    if (x == null || y == null) return x == null && y == null ? 0 : x == null ? -1 : 1
    return x > y ? -1 : x < y ? 1 : 0
  }
  if (role === 'student') {
    const groups = (fixture.group_students ?? []).filter(m => m.student_id === uid).map(m => m.group_id)
    const list = fixture.exam_list ?? []
    const listed = new Map(list.map(e => [e.id, e]))
    return {
      lessons: (fixture.lessons ?? []).filter(l => groups.includes(l.group_id) && l.is_published === true && l.deleted_at == null)
        .sort(byDateDesc('created_at')).slice(0, 8)
        .map(l => ({ id: l.id, title: l.title, created_at: l.created_at, group_name: (l.groups as { name: string } | null)?.name ?? null })),
      exams: list.slice(0, 8).map(e => ({ id: e.id, title: e.title, created_at: e.created_at })),
      grades: (fixture.exam_submissions ?? []).filter(s => s.student_id === uid && s.score != null)
        .sort(byDateDesc('submitted_at')).slice(0, 20)
        .map(s => {
          const e = listed.get(s.exam_id)
          return { id: s.id, exam_id: s.exam_id, score: s.score, max_score: s.max_score, submitted_at: s.submitted_at, grading_status: s.grading_status,
            exam_listed: !!e, exam_title: e?.title ?? null, exam_type: e?.type ?? null, exam_has_manual_questions: e?.has_manual_questions ?? null }
        }),
    }
  }
  if (role === 'teacher') {
    const exams = new Map((fixture.exams ?? []).filter(e => e.teacher_id === uid && e.deleted_at == null).map(e => [e.id, e]))
    return {
      submissions: (fixture.exam_submissions ?? []).filter(s => exams.has(s.exam_id))
        .sort(byDateDesc('submitted_at')).slice(0, 15)
        .map(s => {
          const e = exams.get(s.exam_id)!
          return { id: s.id, exam_id: s.exam_id, submitted_at: s.submitted_at, student_name: (s.users as { full_name: string } | null)?.full_name ?? null, exam_title: e.title, exam_type: e.type }
        }),
    }
  }
  const alerts = () => (fixture.ai_usage_alerts ?? []).sort(byDateDesc('created_at')).slice(0, 6)
    .map(a => { const t = a.tenants as { name: string; ai_alert_threshold_pct: number | null } | null
      return { id: a.id, level: a.level, metric: a.metric, created_at: a.created_at, tenant_name: t?.name ?? null, alert_threshold_pct: t?.ai_alert_threshold_pct ?? null } })
  if (role === 'university_admin') {
    const tenant = dbProfile?.tenant_id ?? who!.tenant_id
    return {
      users: (fixture.users ?? []).filter(u => u.tenant_id === tenant && (u.role === 'teacher' || u.role === 'student'))
        .sort(byDateDesc('created_at')).slice(0, 15).map(u => ({ id: u.id, full_name: u.full_name, role: u.role, created_at: u.created_at })),
      ai_alerts: alerts(),
    }
  }
  if (role === 'super_admin') {
    return {
      messages: (fixture.contact_messages ?? []).sort(byDateDesc('created_at')).slice(0, 10)
        .map(m => ({ id: m.id, name: m.name, message: m.message, created_at: m.created_at, is_read: m.is_read })),
      tenants: (fixture.tenants ?? []).sort(byDateDesc('created_at')).slice(0, 8).map(t => ({ id: t.id, name: t.name, created_at: t.created_at })),
      ai_alerts: alerts(),
    }
  }
  return {}
}

const client = {
  from: (name: string) => { calls.push({ kind: 'from', name }); return table(name) },
  rpc: (name: string) => {
    calls.push({ kind: 'rpc', name })
    if (name === 'get_student_exam_list') return Promise.resolve({ data: fixture.exam_list ?? [], error: null })
    if (name === 'get_my_notifications') return Promise.resolve({ data: feed(), error: null })
    return Promise.resolve({ data: null, error: { message: `unknown rpc ${name}` } })
  },
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => client,
  getAuthUser: async () => who,
}))

import { GET } from '@/app/api/notifications/route'

const T0 = Date.parse('2026-09-01T00:00:00Z')
const at = (h: number) => new Date(T0 + h * 3_600_000).toISOString()

async function notifications() {
  const res = await GET()
  return { status: res.status, body: await res.json() as { notifications: { id: string; type: string; title: string; subtitle: string; date: string; href: string }[] } }
}

beforeEach(() => { calls = []; dbProfile = null; fixture = {} })

// ── Fixtures ────────────────────────────────────────────────────────────────

function studentFixture(): Fixture {
  const groupsName = (g: string) => ({ name: `Group ${g}` })
  const lessons: Row[] = []
  for (let i = 0; i < 12; i++) {
    const g = i % 3 === 2 ? 'g3' : i % 2 ? 'g2' : 'g1'      // g3: not the student's group
    lessons.push({ id: `l${i}`, title: `Lesson ${i}`, created_at: at(100 + i), group_id: g, is_published: i !== 4, deleted_at: i === 6 ? at(300) : null, groups: groupsName(g) })
  }
  // The student's exam list, newest first (as get_student_exam_list orders it); e05 and e06 share a timestamp.
  const exam_list: Row[] = Array.from({ length: 12 }, (_, i) => ({
    id: `e${String(11 - i).padStart(2, '0')}`, title: `Exam ${11 - i}`, created_at: at(200 - i - (i === 6 ? 1 : 0)),
    type: (11 - i) % 4 === 0 ? 'homework' : 'exam', has_manual_questions: (11 - i) % 3 === 0,
  }))
  exam_list[6].created_at = exam_list[5].created_at
  const statuses = ['published', 'pending', 'reviewing']
  const exam_submissions: Row[] = []
  for (let i = 0; i < 24; i++) {
    const examId = i === 3 ? 'e-archived' : `e${String(i % 12).padStart(2, '0')}`
    exam_submissions.push({ id: `sub${i}`, exam_id: examId, student_id: 's1', score: i === 7 || i === 20 ? null : 5 + i, max_score: i % 5 === 0 ? null : 40,
      submitted_at: i === 9 ? null : at(150 + i), grading_status: statuses[i % 3] })
  }
  exam_submissions.push({ id: 'other', exam_id: 'e01', student_id: 's2', score: 30, max_score: 40, submitted_at: at(500), grading_status: 'published' })
  return {
    group_students: [{ group_id: 'g1', student_id: 's1' }, { group_id: 'g2', student_id: 's1' }, { group_id: 'g3', student_id: 's2' }],
    lessons, exam_list, exam_submissions,
  }
}

function teacherFixture(): Fixture {
  const exams: Row[] = [
    { id: 'x1', title: 'Midterm', type: 'exam', teacher_id: 't1', deleted_at: null },
    { id: 'x2', title: 'Reading', type: 'homework', teacher_id: 't1', deleted_at: null },
    { id: 'x3', title: 'Old', type: 'exam', teacher_id: 't1', deleted_at: at(10) },
    { id: 'x4', title: 'Theirs', type: 'exam', teacher_id: 't2', deleted_at: null },
  ]
  const exam_submissions: Row[] = Array.from({ length: 22 }, (_, i) => ({
    id: `ts${i}`, exam_id: ['x1', 'x2', 'x3', 'x4'][i % 4], student_id: `st${i}`, submitted_at: i === 5 ? null : at(300 + (i * 7) % 23),
    users: i === 8 ? null : { full_name: `Student ${i}` },
  }))
  return { exams, exam_submissions }
}

function adminFixture(): Fixture {
  const roles = ['teacher', 'student', 'university_admin', 'center_manager']
  const users: Row[] = Array.from({ length: 22 }, (_, i) => ({ id: `u${i}`, full_name: `User ${i}`, role: roles[i % 4], tenant_id: i === 13 ? 'other' : 'tn', created_at: at(400 + i) }))
  const ai_usage_alerts: Row[] = Array.from({ length: 8 }, (_, i) => ({ id: `a${i}`, level: i % 2 ? 'exceeded' : 'warning', metric: i % 3 ? 'tokens' : 'requests', created_at: at(600 + i),
    tenants: i === 2 ? null : { name: `Inst ${i}`, ai_alert_threshold_pct: i === 4 ? null : 70 } }))
  return { users, ai_usage_alerts }
}

function ownerFixture(): Fixture {
  return {
    contact_messages: Array.from({ length: 12 }, (_, i) => ({ id: `m${i}`, name: `Visitor ${i}`, message: i === 1 ? null : `Hello ${'x'.repeat(i * 10)}`, created_at: at(700 + i), is_read: i % 2 === 0 })),
    tenants: Array.from({ length: 10 }, (_, i) => ({ id: `tn${i}`, name: `Tenant ${i}`, created_at: at(650 + i * 3) })),
    ai_usage_alerts: [{ id: 'a1', level: 'warning', metric: 'requests', created_at: at(690), tenants: { name: 'Inst', ai_alert_threshold_pct: 85 } }],
  }
}

// ── Behaviour ───────────────────────────────────────────────────────────────

describe('GET /api/notifications (P-08)', () => {
  it('no session → 401, nothing read', async () => {
    who = null
    const { status } = await notifications()
    expect(status).toBe(401)
    expect(calls).toEqual([])
  })

  it('student: lessons, exams and only visible grades (score visibility), newest first', async () => {
    who = { id: 's1', role: 'student', tenant_id: 'tn' }
    fixture = studentFixture()
    const { status, body } = await notifications()
    expect(status).toBe(200)
    expect(body).toMatchSnapshot()
  })

  it('student score visibility: published always; pending only for an all-auto exam; an unlisted exam only when published', async () => {
    who = { id: 's1', role: 'student', tenant_id: 'tn' }
    fixture = {
      group_students: [],
      exam_list: [
        { id: 'e-auto', title: 'Auto', created_at: at(1), type: 'exam', has_manual_questions: false },
        { id: 'e-manual', title: 'Essay', created_at: at(2), type: 'exam', has_manual_questions: true },
        { id: 'e-hw', title: 'Homework', created_at: at(3), type: 'homework', has_manual_questions: false },
      ],
      exam_submissions: [
        { id: 'a-pending', exam_id: 'e-auto', student_id: 's1', score: 9, max_score: 10, submitted_at: at(50), grading_status: 'pending' },
        { id: 'a-published', exam_id: 'e-auto', student_id: 's1', score: 8, max_score: 10, submitted_at: at(49), grading_status: 'published' },
        { id: 'm-pending', exam_id: 'e-manual', student_id: 's1', score: 7, max_score: 10, submitted_at: at(48), grading_status: 'pending' },
        { id: 'm-published', exam_id: 'e-manual', student_id: 's1', score: 6, max_score: 10, submitted_at: at(47), grading_status: 'published' },
        { id: 'h-reviewing', exam_id: 'e-hw', student_id: 's1', score: 5, max_score: null, submitted_at: at(46), grading_status: 'reviewing' },
        { id: 'h-published', exam_id: 'e-hw', student_id: 's1', score: 4, max_score: null, submitted_at: at(45), grading_status: 'published' },
        { id: 'x-pending', exam_id: 'e-gone', student_id: 's1', score: 3, max_score: 10, submitted_at: at(44), grading_status: 'pending' },
        { id: 'x-published', exam_id: 'e-gone', student_id: 's1', score: 2, max_score: 10, submitted_at: at(43), grading_status: 'published' },
        { id: 'no-score', exam_id: 'e-auto', student_id: 's1', score: null, max_score: 10, submitted_at: at(60), grading_status: 'published' },
      ],
    }
    const grades = (await notifications()).body.notifications.filter(n => n.type === 'grade')
    expect(grades.map(g => g.id)).toEqual(['grade-a-pending', 'grade-a-published', 'grade-m-published', 'grade-h-published', 'grade-x-published'])
    expect(grades.find(g => g.id === 'grade-x-published')!.title).toBe('gradePublished:{"title":"examFallback"}')
    expect(grades.find(g => g.id === 'grade-h-published')!.subtitle).toBe('4')
    expect(grades.find(g => g.id === 'grade-a-pending')!.subtitle).toBe('9/10')
  })

  it('teacher: newest submissions to the teacher\'s live exams', async () => {
    who = { id: 't1', role: 'teacher', tenant_id: 'tn' }
    fixture = teacherFixture()
    const { body } = await notifications()
    expect(body).toMatchSnapshot()
  })

  it('teacher with no exams: no notifications', async () => {
    who = { id: 't9', role: 'teacher', tenant_id: 'tn' }
    fixture = teacherFixture()
    expect((await notifications()).body).toEqual({ notifications: [] })
  })

  it('university admin: newest teachers / students of the institution + AI alerts', async () => {
    who = { id: 'ad1', role: 'university_admin', tenant_id: 'tn' }
    fixture = adminFixture()
    const { body } = await notifications()
    expect(body).toMatchSnapshot()
  })

  it('super_admin: contact messages, new institutions and AI alerts', async () => {
    who = { id: 'o1', role: 'super_admin', tenant_id: null }
    fixture = ownerFixture()
    const { body } = await notifications()
    expect(body).toMatchSnapshot()
  })

  it('centre manager: no notifications and no database read', async () => {
    who = { id: 'c1', role: 'center_manager', tenant_id: 'tn' }
    fixture = adminFixture()
    expect((await notifications()).body).toEqual({ notifications: [] })
    expect(calls).toEqual([])
  })

  it('one read per poll for every role with a feed: get_my_notifications(), no table read, no id list', async () => {
    const cases: [Who, () => Fixture][] = [
      [{ id: 's1', role: 'student', tenant_id: 'tn' }, studentFixture],
      [{ id: 't1', role: 'teacher', tenant_id: 'tn' }, teacherFixture],
      [{ id: 'ad1', role: 'university_admin', tenant_id: 'tn' }, adminFixture],
      [{ id: 'o1', role: 'super_admin', tenant_id: null }, ownerFixture],
    ]
    for (const [w, fx] of cases) {
      calls = []; who = w; fixture = fx()
      await notifications()
      expect(calls, w.role).toEqual([{ kind: 'rpc', name: 'get_my_notifications' }])
    }
  })

  it('a failed feed read answers an empty list (no partial notifications)', async () => {
    who = { id: 's1', role: 'student', tenant_id: 'tn' }
    fixture = studentFixture()
    const failing = client.rpc
    client.rpc = (name: string) => { calls.push({ kind: 'rpc', name }); return Promise.resolve({ data: null, error: { message: 'boom' } }) }
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { status, body } = await notifications()
      expect(status).toBe(200)
      expect(body).toEqual({ notifications: [] })
    } finally {
      client.rpc = failing
      errors.mockRestore()
    }
  })

  it('a session without role claims falls back to the profile row', async () => {
    who = { id: 'ad1' }
    dbProfile = { role: 'university_admin', tenant_id: 'tn' }
    fixture = adminFixture()
    const { body } = await notifications()
    expect(body.notifications.length).toBe(15)
    expect(calls[0]).toEqual({ kind: 'from', name: 'users' })
  })
})
