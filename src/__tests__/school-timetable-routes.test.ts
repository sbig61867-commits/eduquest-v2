// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SqlCall } from './helpers/fake-sql'

// /api/school/{subjects,periods,timetable} on the SQL layer (fake): who may
// call (subjects and periods: manage_academic_structure; the timetable:
// manage_schedules, as every timetable write), that a non-school institution is
// refused before any write, that every write runs as app_service pinned to the
// SESSION's institution, and that the database's refusals (0014 triggers and
// indexes) come back as precise errors.

const TENANT = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const id = (k: number) => `00000000-0000-4000-8000-${String(k).padStart(12, '0')}`

const env = vi.hoisted(() => ({
  session: null as null | { sub: string; role: string; tenant_id: string | null },
  me: null as null | Record<string, unknown>,
  answer: ((q: SqlCall) => (void q, [])) as (q: SqlCall) => unknown[] | Error,
  calls: [] as SqlCall[],
}))

vi.mock('@/lib/auth/current', () => ({
  currentCtx: async () => (env.session ? { ...env.session, email: null, is_active: true, must_change_password: false } : null),
}))
vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string, params?: unknown) => ({ error: code, code, params }) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: async () => ({ allowed: true, remaining: 1, resetAt: 0 }) }))
vi.mock('@/lib/db/sql', async () => (await import('./helpers/fake-sql')).fakeSqlModule(q => {
  env.calls.push(q)
  if (q.text.startsWith('select u.role, u.tenant_id, u.permissions, t.institution_type')) return env.me ? [env.me] : []
  return env.answer(q)
}))

const subjects = () => import('@/app/api/school/subjects/route')
const periods = () => import('@/app/api/school/periods/route')
const timetable = () => import('@/app/api/school/timetable/route')
const req = (method: string, body?: unknown, qs = '') =>
  new Request(`http://x/api/school/x${qs}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
const json = async (res: Response) => ({ status: res.status, body: await res.json() as Record<string, unknown> })
const writes = () => env.calls.filter(c => !c.text.startsWith('select u.role, u.tenant_id'))
const pgError = (code: string, constraint: string, detail?: string) =>
  Object.assign(new Error(constraint), { code, constraint_name: constraint, detail })

const cell = { kind: 'cell', section_id: id(1), day: 0, period_id: id(2), subject_id: id(3) }

beforeEach(() => {
  env.session = { sub: id(9), role: 'university_admin', tenant_id: TENANT }
  env.me = { role: 'university_admin', tenant_id: TENANT, permissions: {}, institution_type: 'school' }
  env.answer = () => []
  env.calls = []
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('school timetable routes: the gate', () => {
  it('no session → 401, nothing read', async () => {
    env.session = null
    expect((await json(await (await timetable()).POST(req('POST', cell)))).status).toBe(401)
    expect(env.calls).toHaveLength(0)
  })

  it('teachers and students → 403 on every route', async () => {
    for (const role of ['teacher', 'student']) {
      env.me = { role, tenant_id: TENANT, permissions: {}, institution_type: 'school' }
      expect((await (await subjects()).POST(req('POST', { kind: 'subject', name: 'M', code: 'M' }))).status).toBe(403)
      expect((await (await periods()).POST(req('POST', { starts_at: '08:00', ends_at: '08:45' }))).status).toBe(403)
      expect((await (await timetable()).POST(req('POST', cell))).status).toBe(403)
    }
    expect(writes()).toHaveLength(0)
  })

  it('the timetable needs manage_schedules; subjects and periods need manage_academic_structure', async () => {
    env.me = { role: 'center_manager', tenant_id: TENANT, permissions: { manage_academic_structure: true, manage_schedules: false }, institution_type: 'school' }
    expect((await (await timetable()).POST(req('POST', cell))).status).toBe(403)
    expect((await (await timetable()).GET(req('GET', undefined, `?section_id=${id(1)}`))).status).toBe(403)
    env.answer = () => [{ id: id(5), name: 'M', code: 'M', colour: null, sort_order: 0 }]
    expect((await (await subjects()).POST(req('POST', { kind: 'subject', name: 'M', code: 'M' }))).status).toBe(201)
    env.me = { role: 'center_manager', tenant_id: TENANT, permissions: { manage_academic_structure: false, manage_schedules: true }, institution_type: 'school' }
    expect((await (await subjects()).POST(req('POST', { kind: 'subject', name: 'M', code: 'M' }))).status).toBe(403)
    expect((await (await periods()).DELETE(req('DELETE', { id: id(2) }))).status).toBe(403)
  })

  it('a university (any non-school) → 409 schoolOnly, before any write', async () => {
    env.me = { role: 'university_admin', tenant_id: TENANT, permissions: {}, institution_type: 'university' }
    expect((await json(await (await subjects()).POST(req('POST', { kind: 'subject', name: 'M', code: 'M' })))).body.code).toBe('schoolOnly')
    expect((await json(await (await periods()).POST(req('POST', { starts_at: '08:00', ends_at: '08:45' })))).body.code).toBe('schoolOnly')
    expect((await json(await (await timetable()).POST(req('POST', cell)))).body.code).toBe('schoolOnly')
    expect(writes()).toHaveLength(0)
  })
})

describe('school timetable routes: subjects and periods', () => {
  it('creates a subject in the session institution even when the body names another', async () => {
    env.answer = q => q.text.startsWith('insert into public.school_subjects') ? [{ id: id(5), name: 'Mathematics', code: 'MATH', colour: 'info', sort_order: 0 }] : []
    const res = await json(await (await subjects()).POST(req('POST', { kind: 'subject', name: ' Mathematics ', code: 'MATH', colour: 'info', tenant_id: OTHER })))
    expect(res).toMatchObject({ status: 201, body: { subject: { name: 'Mathematics', colour: 'info' } } })
    const insert = writes().find(c => c.text.startsWith('insert into public.school_subjects'))!
    expect(insert.ctx).toEqual({ as: 'service', tenantId: TENANT })
    expect(insert.values).toContain(TENANT)
    expect(insert.values).not.toContain(OTHER)
  })

  it('invalid input is refused before the database', async () => {
    const s = await subjects()
    expect((await json(await s.POST(req('POST', { kind: 'subject', name: 'M', code: 'M', colour: '#123456' })))).body.code).toBe('invalidColour')
    expect((await json(await s.POST(req('POST', { kind: 'gradeSubject', grade_id: id(1), subject_id: id(2), weekly_sessions: 99 })))).body.code).toBe('weeklySessionsInvalid')
    expect((await json(await s.POST(req('POST', { kind: 'stage' })))).body.code).toBe('invalidData')
    const p = await periods()
    expect((await json(await p.POST(req('POST', { starts_at: '09:00', ends_at: '08:00' })))).body.code).toBe('endTimeBeforeStart')
    expect((await json(await p.PATCH(req('PATCH', { id: 'nope', name: 'x' })))).status).toBe(404)
    const tt = await timetable()
    expect((await json(await tt.POST(req('POST', { ...cell, day: 9 })))).body.code).toBe('invalidDay')
    expect((await json(await tt.POST(req('POST', { kind: 'teacher', section_id: id(1), subject_id: id(3), teacher_id: 'x' })))).body.code).toBe('teacherNotInTenant')
    expect((await json(await tt.PATCH(req('PATCH', { section_id: id(1), is_published: 'yes' })))).body.code).toBe('invalidData')
    expect(writes()).toHaveLength(0)
  })

  it('a duplicate subject code is codeTaken; overlapping periods are periodsOverlap', async () => {
    env.answer = q => q.text.startsWith('insert into public.school_subjects') ? pgError('23505', 'school_subjects_code_uq') : []
    expect((await json(await (await subjects()).POST(req('POST', { kind: 'subject', name: 'M', code: 'm' })))).body).toMatchObject({ code: 'codeTaken' })
    env.answer = q => q.text.startsWith('insert into public.school_periods') ? pgError('23P01', 'school_periods_overlap') : []
    const res = await json(await (await periods()).POST(req('POST', { starts_at: '08:30', ends_at: '09:00' })))
    expect(res).toMatchObject({ status: 409, body: { code: 'periodsOverlap' } })
  })

  it('a subject or a period in use by a timetable cannot be archived', async () => {
    env.answer = q => q.text.startsWith('select exists') ? [{ in_use: true }] : []
    expect((await json(await (await subjects()).DELETE(req('DELETE', { kind: 'subject', id: id(3) })))).body.code).toBe('subjectInUse')
    env.answer = () => []
    expect((await json(await (await subjects()).DELETE(req('DELETE', { kind: 'subject', id: id(3) })))).body.code).toBe('subjectNotFound')
    env.answer = q => q.text.startsWith('select 1 from public.school_periods') ? [{ '?column?': 1 }] : []
    expect((await json(await (await periods()).DELETE(req('DELETE', { id: id(2) })))).body.code).toBe('periodInUse')
    // the database guard (trigger) says the same if the check raced
    env.answer = q => q.text.startsWith('update public.school_periods') ? pgError('55000', 'school_period_in_use') : [{ '?column?': 1 }]
    expect((await json(await (await periods()).DELETE(req('DELETE', { id: id(2) })))).body.code).toBe('periodInUse')
  })

  it('unlinking a subject still used by a timetable of that grade is subjectInUse', async () => {
    env.answer = q => q.text.startsWith('select exists') ? [{ in_use: true, grade: true }] : [{ removed: 0, teachers: 0 }]
    const res = await json(await (await subjects()).POST(req('POST', { kind: 'gradeSubject', grade_id: id(1), subject_id: id(2), weekly_sessions: 0 })))
    expect(res).toMatchObject({ status: 409, body: { code: 'subjectInUse' } })
  })
})

describe('school timetable routes: cells and subject teachers', () => {
  it('a cell is written as app_service pinned, with the caller as the timetable’s creator', async () => {
    env.answer = q => {
      if (q.text.startsWith('select exists')) return [{ section: true, period: true, subject: true }]
      if (q.text.startsWith('insert into public.schedules')) return []
      if (q.text.startsWith('insert into public.schedule_slots')) return [{ id: id(7), day: 0, period_id: id(2), subject_id: id(3), teacher_id: null }]
      return new Error('unexpected: ' + q.text)
    }
    const res = await json(await (await timetable()).POST(req('POST', { ...cell, tenant_id: OTHER })))
    expect(res).toMatchObject({ status: 200, body: { cell: { id: id(7) } } })
    expect(writes().every(c => c.ctx.as === 'service' && c.ctx.tenantId === TENANT)).toBe(true)
    const schedule = writes().find(c => c.text.startsWith('insert into public.schedules'))!
    expect(schedule.values).toContain(id(9))
    expect(writes().some(c => c.values.includes(OTHER))).toBe(false)
  })

  it('a teacher clash (trigger) is teacherBusy naming the other section', async () => {
    env.answer = q => {
      if (q.text.startsWith('select exists')) return [{ section: true, period: true, subject: true }]
      if (q.text.startsWith('insert into public.schedule_slots')) return pgError('23P01', 'school_slot_teacher_busy', 'Grade 7 B')
      return []
    }
    const res = await json(await (await timetable()).POST(req('POST', cell)))
    expect(res).toMatchObject({ status: 409, body: { code: 'teacherBusy', params: { section: 'Grade 7 B' } } })
  })

  it('a subject outside the grade, a break and another shift are precise refusals', async () => {
    const cases: [string, string][] = [
      ['school_slot_subject_grade', 'subjectNotInGrade'],
      ['school_slot_period_break', 'periodIsBreak'],
      ['school_slot_period_shift', 'periodShiftMismatch'],
    ]
    for (const [constraint, code] of cases) {
      env.answer = q => {
        if (q.text.startsWith('select exists')) return [{ section: true, period: true, subject: true }]
        if (q.text.startsWith('insert into public.schedule_slots')) return pgError('23514', constraint)
        return []
      }
      expect((await json(await (await timetable()).POST(req('POST', cell)))).body.code).toBe(code)
    }
  })

  it('an unknown section / period / subject is 404 and nothing is written', async () => {
    env.answer = q => q.text.startsWith('select exists') ? [{ section: false, period: true, subject: true }] : []
    expect((await json(await (await timetable()).POST(req('POST', cell)))).body.code).toBe('sectionNotFound')
    env.answer = q => q.text.startsWith('select exists') ? [{ section: true, period: false, subject: true }] : []
    expect((await json(await (await timetable()).POST(req('POST', cell)))).body.code).toBe('periodNotFound')
  })

  it('assigning a teacher already busy elsewhere is refused by the database as teacherBusy', async () => {
    env.answer = q => {
      if (q.text.startsWith('select exists')) return [{ section: true, subject: true, teacher: true }]
      if (q.text.startsWith('insert into public.school_subject_teachers')) return pgError('23P01', 'school_slot_teacher_busy', 'Grade 8 A')
      return []
    }
    const res = await json(await (await timetable()).POST(req('POST', { kind: 'teacher', section_id: id(1), subject_id: id(3), teacher_id: id(4) })))
    expect(res).toMatchObject({ status: 409, body: { code: 'teacherBusy', params: { section: 'Grade 8 A' } } })
  })

  it('a teacher of another institution is refused, nothing assigned', async () => {
    env.answer = q => q.text.startsWith('select exists') ? [{ section: true, subject: true, teacher: false }] : []
    const res = await json(await (await timetable()).POST(req('POST', { kind: 'teacher', section_id: id(1), subject_id: id(3), teacher_id: id(4) })))
    expect(res).toMatchObject({ status: 400, body: { code: 'teacherNotInTenant' } })
  })

  it('the editor read runs as the user (RLS), and an unknown section is 404', async () => {
    const tt = await timetable()
    expect((await json(await tt.GET(req('GET', undefined, '?section_id=nope')))).status).toBe(404)
    env.answer = () => []
    expect((await json(await tt.GET(req('GET', undefined, `?section_id=${id(1)}`)))).body.code).toBe('sectionNotFound')
    const reads = env.calls.filter(c => c.text.startsWith('select g.id, g.name, g.school_grade_id'))
    expect(reads.at(-1)!.ctx).toEqual({ as: 'user', userId: id(9) })
  })
})
