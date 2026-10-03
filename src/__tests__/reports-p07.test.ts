import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import golden from './reports-golden.json'
import { buildWorld, mockAdmin, GOLDEN_CASES, FIXED_NOW, MAX_ROWS, type MockCall } from './reports-fixture'
import { buildUniversityReport, buildTeacherReport, buildGroupReport, buildPilotReport, buildStudentReport } from '@/lib/reports'
import {
  readAll, readAllById, PAGE_SIZE, FIRST_ID, UNIVERSITY_EXAM_COLUMNS, TEACHER_EXAM_COLUMNS, GROUP_EXAM_COLUMNS, STUDENT_EXAM_COLUMNS,
} from '@/lib/data/reports'

/**
 * P-07 — reports read every row (the API caps a response at 1000 rows without
 * saying so: submissions by keyset on id, the smaller ordered sets by counted
 * pages), without exam questions, once per set, in two rounds, and compute with
 * indexed maps. reports-golden.json is what the pre-P-07 builders produced
 * from the same fixture with NO cap; the builders must reproduce it exactly
 * WITH the cap.
 */

const BUILDERS = { university: buildUniversityReport, teacher: buildTeacherReport, group: buildGroupReport, pilot: buildPilotReport, student: buildStudentReport }

beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(FIXED_NOW) })
afterAll(() => { vi.useRealTimers() })

describe('equivalence with the pre-P-07 reports (fixture over the 1000-row cap)', () => {
  it('the fixture really exceeds the cap, and the mock really cuts at it', async () => {
    const world = buildWorld()
    expect(world.exam_submissions.length).toBeGreaterThan(2 * MAX_ROWS)
    const db = mockAdmin(world, { cap: true }) as unknown as { from: (t: string) => { select: (c: string) => PromiseLike<{ data: unknown[] }> } }
    expect((await db.from('exam_submissions').select('exam_id')).data).toHaveLength(MAX_ROWS)
  })

  for (const [scope, id, lang] of GOLDEN_CASES) {
    it(`${scope} ${id} (${lang}) equals the reference`, async () => {
      const report = await BUILDERS[scope](mockAdmin(buildWorld(), { cap: true }), id, lang)
      expect(report).toEqual((golden as Record<string, unknown>)[`${scope}:${id}:${lang}`])
    })
  }

  it('an unknown subject is null and reads nothing else', async () => {
    for (const scope of Object.keys(BUILDERS) as (keyof typeof BUILDERS)[]) {
      const calls: MockCall[] = []
      expect(await BUILDERS[scope](mockAdmin(buildWorld(), { cap: true, calls }), 'nope', 'ar')).toBeNull()
      // The student report reads its memberships beside the student row; nothing after.
      expect(calls.map(c => c.table)).toEqual(scope === 'student' ? ['users', 'group_students'] : [scope === 'university' ? 'tenants' : scope === 'teacher' ? 'users' : 'groups'])
    }
  })
})

describe('readAll (paging past max_rows)', () => {
  const source = (n: number, opts: { count?: boolean } = {}) => {
    const calls: { from: number; to: number; withCount: boolean }[] = []
    let inFlight = 0, maxInFlight = 0
    const page = (from: number, to: number, withCount: boolean) => {
      calls.push({ from, to, withCount })
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight)
      return new Promise<{ data: number[]; count: number | null }>(r => setTimeout(() => {
        inFlight--
        r({ data: Array.from({ length: Math.max(0, Math.min(to, n - 1) - from + 1) }, (_, i) => from + i), count: opts.count === false ? null : n })
      }, 0))
    }
    return { page, calls, maxInFlight: () => maxInFlight }
  }

  it('reads every row in exact, non-overlapping pages; only the first asks for the count', async () => {
    const s = source(2500)
    const rows = await readAll<number>(s.page)
    expect(rows).toEqual(Array.from({ length: 2500 }, (_, i) => i))
    expect(s.calls).toEqual([
      { from: 0, to: PAGE_SIZE - 1, withCount: true },
      { from: 1000, to: 1999, withCount: false },
      { from: 2000, to: 2999, withCount: false },
    ])
  })

  it('a set under one page is one request; an empty set too', async () => {
    const small = source(10)
    expect(await readAll<number>(small.page)).toHaveLength(10)
    expect(small.calls).toHaveLength(1)
    const empty = source(0)
    expect(await readAll<number>(empty.page)).toEqual([])
    expect(empty.calls).toHaveLength(1)
  })

  it('reads at most four pages at once after the first', async () => {
    const s = source(9500)
    expect(await readAll<number>(s.page)).toHaveLength(9500)
    expect(s.calls).toHaveLength(10)
    expect(s.maxInFlight()).toBeLessThanOrEqual(4)
  })

  it('without a count it keeps reading until a short page', async () => {
    const s = source(2300, { count: false })
    expect(await readAll<number>(s.page)).toHaveLength(2300)
    expect(s.calls.map(c => c.from)).toEqual([0, 1000, 2000])
  })
})

describe('readAllById (keyset paging of the large sets)', () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `id${String(i).padStart(6, '0')}` }))
  function source(n: number) {
    const all = ids(n)
    const afters: string[] = []
    const page = (after: string) => {
      afters.push(after)
      const rest = all.filter(r => r.id > after)
      return Promise.resolve({ data: rest.slice(0, PAGE_SIZE) })
    }
    return { page, afters, all }
  }

  it('reads every row once, each page after the last id of the one before', async () => {
    const s = source(2500)
    const rows = await readAllById<{ id: string }>(s.page)
    expect(rows).toEqual(s.all)
    expect(new Set(rows.map(r => r.id)).size).toBe(2500)
    expect(s.afters).toEqual([FIRST_ID, 'id000999', 'id001999'])
  })

  it('ends on a short page; an exact multiple of the page costs one empty page', async () => {
    const small = source(10)
    expect(await readAllById<{ id: string }>(small.page)).toHaveLength(10)
    expect(small.afters).toEqual([FIRST_ID])
    const exact = source(2000)
    expect(await readAllById<{ id: string }>(exact.page)).toHaveLength(2000)
    expect(exact.afters).toEqual([FIRST_ID, 'id000999', 'id001999'])
  })
})

describe('columns and reads', () => {
  async function callsOf(scope: keyof typeof BUILDERS, id: string) {
    const calls: MockCall[] = []
    await BUILDERS[scope](mockAdmin(buildWorld(), { cap: true, calls }), id, 'ar')
    return calls
  }

  it('no exam read selects questions (or *); each report uses its named columns', async () => {
    const expected = { university: UNIVERSITY_EXAM_COLUMNS, teacher: TEACHER_EXAM_COLUMNS, group: GROUP_EXAM_COLUMNS, pilot: GROUP_EXAM_COLUMNS, student: STUDENT_EXAM_COLUMNS }
    for (const [scope, id] of [['university', 'tn'], ['teacher', 't0'], ['group', 'g0'], ['pilot', 'g0'], ['student', 's00']] as const) {
      const calls = await callsOf(scope, id)
      for (const c of calls) expect(c.columns).not.toMatch(/questions|\*/)
      const exams = calls.filter(c => c.table === 'exams')
      expect(exams.length).toBeGreaterThan(0)
      for (const c of exams) expect(c.columns).toBe(expected[scope])
    }
  })

  it('every list read is paged in order (counted range pages, or keyset by id for submissions); counts are head-only', async () => {
    for (const [scope, id] of [['university', 'tn'], ['teacher', 't0'], ['group', 'g0'], ['pilot', 'g0'], ['student', 's00']] as const) {
      for (const c of await callsOf(scope, id)) {
        const single = ['tenants'].includes(c.table) || (c.table === 'users' && c.filters.some(f => f[0] === 'eq' && f[1] === 'id'))
          || (c.table === 'groups' && c.filters.some(f => f[0] === 'eq' && f[1] === 'id'))
        if (single || c.head) continue
        if (c.table === 'exam_submissions') {
          expect(c.limit, `${scope} ${c.table}`).toBe(PAGE_SIZE)
          expect(c.filters.filter(f => f[0] === 'order').map(f => f[1]), `${scope} ${c.table}`).toEqual(['id'])
        } else {
          expect(c.range, `${scope} ${c.table}`).not.toBeNull()
          expect(c.filters.some(f => f[0] === 'order'), `${scope} ${c.table}`).toBe(true)
        }
      }
    }
  })

  it('university: students are counted (head), never read; memberships filter through the live groups', async () => {
    const calls = await callsOf('university', 'tn')
    const students = calls.filter(c => c.table === 'users' && c.filters.some(f => f[1] === 'role' && f[2] === 'student'))
    expect(students).toHaveLength(1)
    expect(students[0].head).toBe(true)
    const members = calls.filter(c => c.table === 'group_students')
    expect(members[0].filters).toEqual(expect.arrayContaining([['eq', 'groups.tenant_id', 'tn'], ['is', 'groups.deleted_at', null]]))
  })

  it('submissions are filtered through their exam (no id lists): teacher, group, student', async () => {
    const teacher = (await callsOf('teacher', 't0')).filter(c => c.table === 'exam_submissions')
    expect(teacher[0].filters).toEqual(expect.arrayContaining([['eq', 'exams.teacher_id', 't0'], ['is', 'exams.deleted_at', null]]))
    const group = (await callsOf('group', 'g0')).filter(c => c.table === 'exam_submissions')
    expect(group[0].filters).toEqual(expect.arrayContaining([['eq', 'exams.group_id', 'g0'], ['is', 'exams.deleted_at', null]]))
    for (const c of [...teacher, ...group]) expect(c.columns).toContain('exams!inner()')
  })

  it('student: submissions are read once (own derived from the peer read), no survey row read for the pilot', async () => {
    const student = await callsOf('student', 's00')
    const subs = student.filter(c => c.table === 'exam_submissions')
    expect(subs.every(c => !c.filters.some(f => f[1] === 'student_id'))).toBe(true)
    // Pages of one read, not two reads: the first page starts at FIRST_ID, each next one after the last.
    const cursors = subs.map(c => String(c.filters.find(f => f[0] === 'gt')?.[2]))
    expect(cursors[0]).toBe(FIRST_ID)
    for (let i = 1; i < cursors.length; i++) expect(cursors[i] > cursors[i - 1]).toBe(true)
    expect((await callsOf('pilot', 'g0')).map(c => c.table)).not.toContain('surveys')
  })
})

describe('rounds', () => {
  /** Holds every request until flush(): one flush = one round to the database. */
  function gated() {
    const calls: MockCall[] = []
    let pending: (() => void)[] = []
    const gate = () => new Promise<void>(r => pending.push(r))
    const flush = async () => {
      await new Promise(r => setTimeout(r, 0))
      const now = pending; pending = []; now.forEach(f => f())
      await new Promise(r => setTimeout(r, 0))
    }
    return { calls, gate, flush, since: (n: number) => calls.slice(n).map(c => c.table).sort() }
  }

  async function rounds(scope: keyof typeof BUILDERS, id: string) {
    const g = gated()
    const done = BUILDERS[scope](mockAdmin(buildWorld(), { cap: true, calls: g.calls, gate: g.gate }), id, 'ar')
    const out: string[][] = []
    let seen = 0
    for (let i = 0; i < 6; i++) {
      await new Promise(r => setTimeout(r, 0))
      out.push(g.since(seen)); seen = g.calls.length
      await g.flush()
    }
    await done
    return out.filter(r => r.length)
  }

  it('university: the institution, then every set at once, then the remaining pages', async () => {
    const r = await rounds('university', 'tn')
    expect(r[0]).toEqual(['tenants'])
    expect(r[1]).toEqual(['exam_submissions', 'exams', 'group_students', 'groups', 'lessons', 'users', 'users'])
    // > 2000 submissions: keyset pages 2 and 3, one after the other.
    expect(r.slice(2)).toEqual([['exam_submissions'], ['exam_submissions']])
  })

  it('teacher, group and pilot: the subject, then everything at once (+ pages)', async () => {
    const t = await rounds('teacher', 't0')
    expect(t[0]).toEqual(['users'])
    expect(t[1]).toEqual(['exam_submissions', 'exams', 'group_students', 'groups', 'lessons'])
    const g = await rounds('group', 'g0')
    expect(g[0]).toEqual(['groups'])
    expect(g[1]).toEqual(['exam_submissions', 'exams', 'group_students'])
    const p = await rounds('pilot', 'g0')
    expect(p[0]).toEqual(['groups'])
    expect(p[1]).toEqual(['exam_submissions', 'exams', 'group_students', 'lessons', 'survey_responses'])
  })

  it('student: the student with their groups, then exams with every submission (was five rounds)', async () => {
    const r = await rounds('student', 's00')
    expect(r[0]).toEqual(['group_students', 'users'])
    expect(r[1]).toEqual(['exam_submissions', 'exams'])
  })
})
