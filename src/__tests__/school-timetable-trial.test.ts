// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import postgres from 'postgres'

// Subjects, subject teachers, the bell schedule and section timetables end to
// end on the Neon trial (neon/migrations/0014), with two schools and a
// university. Real routes, SQL layer, RLS, triggers; only "who is signed in"
// comes from the test. Every cross-institution or non-school attempt must be
// refused and change nothing. Runs with `npm run test:neon`; skipped until 0014
// is applied to the trial (school-timetable-dryrun.test.ts proves it before).

type Who = { sub: string; role: string; tenant_id: string | null }
const who = vi.hoisted(() => ({ ctx: null as null | Who }))
vi.mock('@/lib/auth/current', async () => ({
  ...(await vi.importActual<object>('@/lib/auth/current')),
  currentCtx: async () => (who.ctx ? { ...who.ctx, email: null, is_active: true, must_change_password: false } : null),
}))
vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string, params?: unknown) => ({ error: code, code, params }) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: async () => ({ allowed: true, remaining: 1, resetAt: 0 }) }))

const READY = !!(process.env.NEON_GATEWAY_DATABASE_URL && process.env.NEON_DATABASE_URL)

describe.skipIf(!READY)('school subjects and timetables on the trial', () => {
  const owner = postgres(process.env.NEON_DATABASE_URL ?? 'postgres://unused', { max: 1, prepare: false, onnotice: () => {} })
  const tag = `stt${Date.now()}`
  const code = () => Math.random().toString(36).slice(2, 7).toUpperCase().replace(/[^A-Z0-9]/g, 'X').padEnd(5, 'X')
  const ids: Record<string, string> = {}
  let applied = false

  async function person(role: string, tenant: string, name = role) {
    const [u] = await owner`insert into ba."user" (name, email, "emailVerified") values (${role}, ${role + Math.random().toString(36).slice(2, 7) + tag + '@stt-test.test'}, true) returning id`
    await owner`update public.users set role = ${role}, tenant_id = ${tenant}, full_name = ${name + ' ' + tag} where id = ${u.id}`
    return u.id as string
  }
  const as = (sub: string, role: string, tenant: string) => { who.ctx = { sub, role, tenant_id: tenant } }
  const routes: Record<string, () => Promise<unknown>> = {
    structure: () => import('@/app/api/school/structure/route'),
    placement: () => import('@/app/api/school/placement/route'),
    subjects: () => import('@/app/api/school/subjects/route'),
    periods: () => import('@/app/api/school/periods/route'),
    timetable: () => import('@/app/api/school/timetable/route'),
  }
  const call = async (path: string, method: string, body?: unknown, qs = '') => {
    const mod = (await routes[path]()) as Record<string, (r: Request) => Promise<Response>>
    const res = await mod[method](new Request(`http://x/api/${path}${qs}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }))
    return { status: res.status, body: await res.json().catch(() => null) }
  }
  const cell = (section: string, day: number, period: string, subject: string) =>
    call('timetable', 'POST', { kind: 'cell', section_id: section, day, period_id: period, subject_id: subject })
  const teach = (section: string, subject: string, teacher: string | null) =>
    call('timetable', 'POST', { kind: 'teacher', section_id: section, subject_id: subject, teacher_id: teacher })
  const visibleGroups = async (userId: string, tenant: string) => {
    const { run } = await import('@/lib/db/sql')
    const [rows] = await run({ as: 'user', userId }, sql => [sql`select id from public.groups where tenant_id = ${tenant}`])
    return rows.map(r => r.id as string).sort()
  }

  beforeAll(async () => {
    const [t] = await owner`select to_regclass('public.school_subjects') is not null as ok`
    applied = t.ok
    if (!applied) return
    ids.A = (await owner`insert into public.tenants (name, slug, code, institution_type) values ('SchA', ${tag + 'a'}, ${code()}, 'school') returning id`)[0].id
    ids.B = (await owner`insert into public.tenants (name, slug, code, institution_type) values ('SchB', ${tag + 'b'}, ${code()}, 'school') returning id`)[0].id
    ids.U = (await owner`insert into public.tenants (name, slug, code, institution_type) values ('Uni', ${tag + 'u'}, ${code()}, 'university') returning id`)[0].id
    ids.aA = await person('university_admin', ids.A)
    ids.aB = await person('university_admin', ids.B)
    ids.aU = await person('university_admin', ids.U)
    ids.tM = await person('teacher', ids.A, 'Maha')
    ids.t2 = await person('teacher', ids.A, 'Omar')
    ids.tB = await person('teacher', ids.B, 'Badr')
    ids.s1 = await person('student', ids.A, 'Sara')
    as(ids.aA, 'university_admin', ids.A)
    ids.stage = (await call('structure', 'POST', { kind: 'stage', stage_kind: 'basic', name: 'Basic' })).body.stage.id
    ids.g7 = (await call('structure', 'POST', { kind: 'grade', stage_id: ids.stage, name: 'Grade 7' })).body.grade.id
    ids.year = (await call('structure', 'POST', { kind: 'year', name: tag, starts_on: '2026-09-01', ends_on: '2027-06-30', is_active: true })).body.year.id
    ids.s7A = (await call('structure', 'POST', { kind: 'section', grade_id: ids.g7, year_id: ids.year, label: 'A' })).body.section.id
    ids.s7B = (await call('structure', 'POST', { kind: 'section', grade_id: ids.g7, year_id: ids.year, label: 'B' })).body.section.id
    await call('placement', 'POST', { section_id: ids.s7A, student_ids: [ids.s1] })
  }, 180_000)

  afterAll(async () => {
    if (applied && ids.A) {
      const tenants = [ids.A, ids.B, ids.U]
      await owner`delete from public.schedules where tenant_id = any(${tenants})`
      await owner`delete from public.school_subject_teachers where tenant_id = any(${tenants})`
      await owner`delete from public.school_grade_subjects where tenant_id = any(${tenants})`
      await owner`delete from public.school_periods where tenant_id = any(${tenants})`
      await owner`delete from public.school_subjects where tenant_id = any(${tenants})`
      await owner`delete from public.groups where tenant_id = any(${tenants})`
      await owner`delete from public.school_terms where tenant_id = any(${tenants})`
      await owner`delete from public.school_grades where tenant_id = any(${tenants})`
      await owner`delete from public.school_stages where tenant_id = any(${tenants})`
      await owner`delete from public.school_years where tenant_id = any(${tenants})`
      await owner`delete from ba."user" where email like ${'%' + tag + '%'}`
      await owner`delete from public.tenants where id = any(${tenants})`.catch(() => {})
    }
    await owner.end()
  }, 90_000)

  it('builds subjects, grade links and a bell schedule, in the own school only', async ({ skip }) => {
    if (!applied) return skip()
    as(ids.aA, 'university_admin', ids.A)
    ids.math = (await call('subjects', 'POST', { kind: 'subject', name: 'Mathematics', code: 'MATH', colour: 'info' })).body.subject.id
    expect((await call('subjects', 'POST', { kind: 'subject', name: 'Other', code: 'math' })).body.code).toBe('codeTaken')
    expect((await call('subjects', 'POST', { kind: 'gradeSubject', grade_id: ids.g7, subject_id: ids.math, weekly_sessions: 5 })).body.gradeSubject)
      .toMatchObject({ weekly_sessions: 5 })
    ids.p1 = (await call('periods', 'POST', { starts_at: '08:00', ends_at: '08:45' })).body.period.id
    ids.p2 = (await call('periods', 'POST', { starts_at: '08:45', ends_at: '09:30' })).body.period.id
    expect((await call('periods', 'POST', { starts_at: '08:30', ends_at: '09:00' })).body.code).toBe('periodsOverlap')
    as(ids.aB, 'university_admin', ids.B)
    expect((await call('subjects', 'PATCH', { kind: 'subject', id: ids.math, name: 'Hijacked' })).body.code).toBe('subjectNotFound')
    expect((await call('subjects', 'POST', { kind: 'gradeSubject', grade_id: ids.g7, subject_id: ids.math, weekly_sessions: 1 })).body.code).toBe('gradeNotFound')
    as(ids.aU, 'university_admin', ids.U)
    expect((await call('subjects', 'POST', { kind: 'subject', name: 'M', code: 'M' })).body.code).toBe('schoolOnly')
  }, 120_000)

  it('timetable: the teacher comes with the subject and cannot be in two sections at once', async ({ skip }) => {
    if (!applied) return skip()
    as(ids.aA, 'university_admin', ids.A)
    expect((await teach(ids.s7A, ids.math, ids.tM)).status).toBe(200)
    expect((await teach(ids.s7B, ids.math, ids.tM)).status).toBe(200)
    expect((await teach(ids.s7A, ids.math, ids.tB)).body.code).toBe('teacherNotInTenant')
    expect((await cell(ids.s7A, 0, ids.p1, ids.math)).body.cell).toMatchObject({ teacher_id: ids.tM })
    expect((await cell(ids.s7B, 0, ids.p1, ids.math)).body).toMatchObject({ code: 'teacherBusy', params: { section: 'Grade 7 A' } })
    expect((await cell(ids.s7B, 0, ids.p2, ids.math)).status).toBe(200)
    expect((await call('periods', 'DELETE', { id: ids.p1 })).body.code).toBe('periodInUse')
    expect((await call('timetable', 'PATCH', { section_id: ids.s7A, is_published: true })).body.schedule).toEqual({ is_published: true })
    as(ids.aB, 'university_admin', ids.B)
    expect((await cell(ids.s7A, 1, ids.p1, ids.math)).body.code).toBe('sectionNotFound')
    expect((await call('timetable', 'GET', undefined, `?section_id=${ids.s7A}`)).body.code).toBe('sectionNotFound')
    const [n] = await owner`select count(*)::int n from public.schedule_slots where tenant_id = ${ids.A}`
    expect(n.n).toBe(2)
  }, 120_000)

  it('RLS: the subject teacher sees the sections they teach; the student sees the published timetable', async ({ skip }) => {
    if (!applied) return skip()
    expect(await visibleGroups(ids.tM, ids.A)).toEqual([ids.s7A, ids.s7B].sort())
    expect(await visibleGroups(ids.t2, ids.A)).toEqual([])
    const { loadStudentSchedule } = await import('@/lib/schedules-data')
    expect((await loadStudentSchedule(ids.s1)).map(x => [x.title, x.day_of_week, x.group_name])).toEqual([['Mathematics', 0, 'Grade 7 A']])
    const { loadTeacherSchoolPeriods } = await import('@/lib/data/school-timetable')
    expect((await loadTeacherSchoolPeriods(ids.tM, ids.A)).map(x => x.group_name)).toEqual(['Grade 7 A', 'Grade 7 B'])
    expect(await loadTeacherSchoolPeriods(ids.t2, ids.A)).toEqual([])
  }, 120_000)
})
