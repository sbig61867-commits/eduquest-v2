import { describe, it, expect } from 'vitest'
import { buildWorld, mockAdmin, type MockCall, type World } from './reports-fixture'
import { buildUniversityReport, buildTeacherReport, buildGroupReport, buildPilotReport, buildStudentReport } from '@/lib/reports'
import { readAll, readAllById, ReportReadError, PAGE_SIZE, FIRST_ID } from '@/lib/data/reports'

/**
 * D1 — a report is never built from a partial read. A failed page, a failed or
 * missing count, a page shorter (or longer) than the count says — e.g. a
 * max_rows lowered below PAGE_SIZE — throws ReportReadError, and /api/reports
 * answers 503 `reportReadFailed` instead of a report. Report output and
 * computation are unchanged (reports-p07.test.ts keeps its 12/12 and 7/7
 * equivalence cases).
 */

const BUILDERS = {
  university: buildUniversityReport, teacher: buildTeacherReport, group: buildGroupReport,
  pilot: buildPilotReport, student: buildStudentReport,
} as const
const SUBJECTS = [['university', 'tn'], ['teacher', 't0'], ['group', 'g0'], ['pilot', 'g0'], ['student', 's00']] as const
const FAILED = { data: null, count: null, error: { code: 'PGRST000', message: 'injected failure' } }

/** A counted, ordered source of `n` numbers; `page(i)` may be replaced to fail or cut the i-th request. */
function rangeSource(n: number, override?: (i: number, from: number, to: number) => unknown) {
  const calls: number[] = []
  const page = (from: number, to: number, withCount: boolean) => {
    const i = calls.push(from) - 1
    const custom = override?.(i, from, to)
    if (custom) return Promise.resolve(custom as never)
    const data = Array.from({ length: Math.max(0, Math.min(to, n - 1) - from + 1) }, (_, k) => from + k)
    return Promise.resolve({ data, count: withCount ? n : null, error: null })
  }
  return { page, calls }
}

/** A keyset source of `n` ids; `cap` cuts every page (a lower max_rows), `count` overrides the head-only count. */
function keysetSource(n: number, opts: { cap?: number; failPage?: number; count?: unknown } = {}) {
  const all = Array.from({ length: n }, (_, i) => ({ id: `id${String(i).padStart(6, '0')}` }))
  const afters: string[] = []
  const page = (after: string) => {
    const i = afters.push(after) - 1
    if (i === opts.failPage) return Promise.resolve(FAILED as never)
    const data = all.filter(r => r.id > after).slice(0, Math.min(PAGE_SIZE, opts.cap ?? PAGE_SIZE))
    return Promise.resolve({ data, error: null })
  }
  const count = () => Promise.resolve((opts.count ?? { data: null, count: n, error: null }) as never)
  return { page, count, afters }
}

describe('readAll (counted pages)', () => {
  it('a failed first page throws, and nothing else is read', async () => {
    const s = rangeSource(2500, i => (i === 0 ? FAILED : null))
    await expect(readAll(s.page)).rejects.toBeInstanceOf(ReportReadError)
    expect(s.calls).toEqual([0])
  })

  it('a failed middle page throws (no partial result)', async () => {
    const s = rangeSource(2500, (_i, from) => (from === 1000 ? FAILED : null))
    await expect(readAll(s.page)).rejects.toBeInstanceOf(ReportReadError)
  })

  it('a first page without its count throws', async () => {
    const s = rangeSource(2500, (i, from, to) => (i === 0 ? { data: Array.from({ length: to - from + 1 }, (_, k) => k), count: null, error: null } : null))
    await expect(readAll(s.page)).rejects.toBeInstanceOf(ReportReadError)
  })

  it('a page shorter than the count requires (max_rows below 1000) throws', async () => {
    const s = rangeSource(2500, (i, from) => ({ data: Array.from({ length: 500 }, (_, k) => from + k), count: i === 0 ? 2500 : null, error: null }))
    await expect(readAll(s.page)).rejects.toThrow(/expected 1000 of 2500/)
  })

  it('a last page must hold exactly the remainder: shorter or longer throws, exact passes', async () => {
    const short = rangeSource(2500, (_i, from) => (from === 2000 ? { data: Array.from({ length: 499 }, (_, k) => from + k), count: null, error: null } : null))
    await expect(readAll(short.page)).rejects.toThrow(/expected 500 of 2500/)
    const long = rangeSource(2500, (_i, from) => (from === 2000 ? { data: Array.from({ length: 501 }, (_, k) => from + k), count: null, error: null } : null))
    await expect(readAll(long.page)).rejects.toBeInstanceOf(ReportReadError)
    expect(await readAll(rangeSource(2500).page)).toHaveLength(2500)
  })

  it('an empty set is one request and no error', async () => {
    const s = rangeSource(0)
    expect(await readAll(s.page)).toEqual([])
    expect(s.calls).toEqual([0])
  })
})

describe('readAllById (keyset pages + a head-only count alongside the first)', () => {
  it('a failed first page, a failed middle page, a failed or missing count: each throws', async () => {
    await expect(readAllById(...pc(keysetSource(2500, { failPage: 0 })))).rejects.toBeInstanceOf(ReportReadError)
    await expect(readAllById(...pc(keysetSource(2500, { failPage: 1 })))).rejects.toBeInstanceOf(ReportReadError)
    await expect(readAllById(...pc(keysetSource(2500, { count: FAILED })))).rejects.toThrow(/count failed/)
    await expect(readAllById(...pc(keysetSource(2500, { count: { data: null, count: null, error: null } })))).rejects.toThrow(/no count/)
  })

  it('pages cut by a lower max_rows (500) throw instead of ending the read early', async () => {
    const s = keysetSource(2500, { cap: 500 })
    await expect(readAllById(...pc(s))).rejects.toThrow(/500 rows, expected 2500/)
    expect(s.afters).toEqual([FIRST_ID])
  })

  it('rows changing during the read (count no longer matches) throw', async () => {
    await expect(readAllById(...pc(keysetSource(2500, { count: { data: null, count: 2501, error: null } })))).rejects.toBeInstanceOf(ReportReadError)
  })

  it('an empty set reads one page and the count, and returns []', async () => {
    const s = keysetSource(0)
    expect(await readAllById(...pc(s))).toEqual([])
    expect(s.afters).toEqual([FIRST_ID])
  })

  it('the keyset itself is unchanged: every row once, each page after the last id', async () => {
    const s = keysetSource(2500)
    expect(await readAllById(...pc(s))).toHaveLength(2500)
    expect(s.afters).toEqual([FIRST_ID, 'id000999', 'id001999'])
  })
})

function pc(s: ReturnType<typeof keysetSource>) {
  return [s.page, s.count] as [typeof s.page, typeof s.count]
}

describe('reports: any failed or incomplete read fails the whole report', () => {
  const build = (scope: keyof typeof BUILDERS, id: string, opts: Parameters<typeof mockAdmin>[1] = {}, world: World = buildWorld()) =>
    BUILDERS[scope](mockAdmin(world, { cap: true, ...opts }), id, 'ar')

  const isHeadCount = (c: MockCall, table: string) => c.table === table && c.head

  it('a failed first page of any list read, in every scope', async () => {
    for (const [scope, id] of SUBJECTS) {
      const failGroupStudents = (c: MockCall) => c.table === 'group_students' && !c.head
      await expect(build(scope, id, { fail: failGroupStudents }), scope).rejects.toBeInstanceOf(ReportReadError)
    }
  })

  it('a failed middle keyset page of the submissions (university: > 2000 submissions)', async () => {
    const middle = (c: MockCall) => c.table === 'exam_submissions' && !c.head && c.filters.some(f => f[0] === 'gt' && f[2] !== FIRST_ID)
    await expect(build('university', 'tn', { fail: middle })).rejects.toBeInstanceOf(ReportReadError)
  })

  it('a failed count: students (university), lessons (teacher, pilot), submissions (group, student)', async () => {
    await expect(build('university', 'tn', { fail: c => isHeadCount(c, 'users') })).rejects.toThrow(/students: count failed/)
    await expect(build('teacher', 't0', { fail: c => isHeadCount(c, 'lessons') })).rejects.toThrow(/lessons: count failed/)
    await expect(build('pilot', 'g0', { fail: c => isHeadCount(c, 'lessons') })).rejects.toThrow(/lessons: count failed/)
    await expect(build('group', 'g0', { fail: c => isHeadCount(c, 'exam_submissions') })).rejects.toThrow(/keyset count: count failed/)
    await expect(build('student', 's00', { fail: c => isHeadCount(c, 'exam_submissions') })).rejects.toThrow(/keyset count: count failed/)
  })

  it('a failed fallback read of exam questions (score without max_score)', async () => {
    const fallback = (c: MockCall) => c.table === 'exams' && c.columns === 'id, questions'
    await expect(build('university', 'tn', { fail: fallback }, buildWorld({ missingMax: true }))).rejects.toThrow(/fallback exam questions/)
  })

  it('max_rows below 1000 (responses cut at 500): every scope throws instead of reporting', async () => {
    for (const [scope, id] of SUBJECTS) {
      await expect(build(scope, id, { capRows: 500 }), scope).rejects.toBeInstanceOf(ReportReadError)
    }
  })

  it('the subject read: no row stays null (404), any other failure throws', async () => {
    expect(await build('teacher', 'nobody')).toBeNull()
    expect(await build('university', 'nowhere')).toBeNull()
    await expect(build('university', 'tn', { fail: c => c.table === 'tenants' })).rejects.toBeInstanceOf(ReportReadError)
    await expect(build('group', 'g0', { fail: (c, n) => c.table === 'groups' && n === 0 })).rejects.toBeInstanceOf(ReportReadError)
  })

  it('a subject with no data still gets its report (empty lists are not failures)', async () => {
    const world = buildWorld()
    world.users.push({ id: 't9', full_name: 'Teacher t9', email: 't9@x.test', role: 'teacher', tenant_id: 'tn', created_at: '2026-01-01T00:00:00Z', tenants: { name: 'Uni' } })
    world.users.push({ id: 's99', full_name: 'Student s99', email: 's99@x.test', role: 'student', tenant_id: 'tn', created_at: '2026-01-01T00:00:00Z', tenants: { name: 'Uni' } })
    expect(await build('teacher', 't9', {}, world)).not.toBeNull()
    expect(await build('student', 's99', {}, world)).not.toBeNull()
  })

  it('without any failure every scope still builds under the 1000-row cap', async () => {
    for (const [scope, id] of SUBJECTS) expect(await build(scope, id), scope).not.toBeNull()
  })
})
