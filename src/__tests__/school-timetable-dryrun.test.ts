// @vitest-environment node
// Migration 0014 (subjects, subject teachers, bell schedule, section timetables)
// PROVEN BEFORE IT IS APPLIED: the real /api/school/* routes, the data layers
// (src/lib/data/school-timetable.ts, school-structure.ts, schedules-data.ts) and
// the student's get_student_schedule() against 0014 applied INSIDE one
// transaction on the Neon trial that is always ROLLED BACK — nothing is ever
// committed. 0013 must already be applied there. The SQL layer is replaced by
// one that runs every unit in a savepoint of that transaction, with the same
// identity / role switch as src/lib/db/sql.ts (app_user / app_service / app_system).
// Opt-in only (it holds DDL locks on groups / schedules / schedule_slots while it runs):
//   TIMETABLE_DRYRUN=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run --pool=threads src/__tests__/school-timetable-dryrun.test.ts
// Once 0014 is applied, school-timetable-trial.test.ts covers the same ground.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import postgres from 'postgres'

type Who = { sub: string; role: string; tenant_id: string | null }
const h = vi.hoisted(() => ({ ctx: null as null | Who, db: null as unknown as import('postgres').Sql, n: 0 }))
vi.mock('@/lib/auth/current', async () => ({
  ...(await vi.importActual<object>('@/lib/auth/current')),
  currentCtx: async () => (h.ctx ? { ...h.ctx, email: null, is_active: true, must_change_password: false } : null),
}))
vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string, params?: unknown) => ({ error: code, code, params }) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: async () => ({ allowed: true, remaining: 1, resetAt: 0 }) }))
vi.mock('@/lib/db/sql', async () => {
  type Ctx = { as: 'user'; userId: string } | { as: 'service'; tenantId?: string; platform?: true } | { as: 'system' }
  async function unit<T>(ctx: Ctx, fn: (s: import('postgres').Sql) => Promise<T>): Promise<T> {
    const db = h.db
    const sp = `u${++h.n}`
    await db.unsafe(`savepoint ${sp}`)
    try {
      if (ctx.as === 'user') {
        await db`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ctx.userId, role: 'authenticated' })}, true), set_config('app.tenant_id', '', true), set_config('app.scope', '', true)`
        await db.unsafe('set local role app_user')
      } else if (ctx.as === 'service') {
        await db`select set_config('request.jwt.claims', '', true), set_config('app.tenant_id', ${ctx.tenantId ?? ''}, true), set_config('app.scope', ${ctx.platform ? 'platform' : ''}, true)`
        await db.unsafe('set local role app_service')
      } else {
        await db.unsafe('set local role app_system')
      }
      const r = await fn(db)
      await db.unsafe('reset role')
      await db.unsafe(`release savepoint ${sp}`)
      return r
    } catch (e) {
      await db.unsafe(`rollback to savepoint ${sp}`)
      throw e
    }
  }
  return {
    run: (ctx: Ctx, build: (s: import('postgres').Sql) => unknown[]) =>
      unit(ctx, async s => { const out: unknown[] = []; for (const q of build(s)) out.push(await (q as Promise<unknown>)); return out }),
    transaction: (ctx: Ctx, work: (s: import('postgres').Sql) => Promise<unknown>) => unit(ctx, s => work(s)),
    maybeOne: (rows: unknown[]) => { if (rows.length > 1) throw new Error('more than one'); return rows[0] ?? null },
    one: (rows: unknown[]) => { if (rows.length !== 1) throw new Error('not one'); return rows[0] },
    dbStats: { units: 0, statements: 0 },
    onWorkers: false,
  }
})

const URL_ = process.env.NEON_DATABASE_URL
describe.skipIf(!URL_ || !process.env.TIMETABLE_DRYRUN)('school timetable: routes + data layer on 0014 inside a rolled-back transaction', () => {
  const db = postgres(URL_ ?? 'postgres://unused', { max: 1, prepare: false, onnotice: () => {} })
  h.db = db
  const tag = `tt${Date.now()}`
  const code = () => Math.random().toString(36).slice(2, 7).toUpperCase().replace(/[^A-Z0-9]/g, 'X').padEnd(5, 'X')
  const ids: Record<string, string> = {}
  const before: Record<string, unknown> = {}
  const as = (sub: string, role: string, tenant: string) => { h.ctx = { sub, role, tenant_id: tenant } }
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
  async function person(role: string, tenant: string, name = role, permissions?: Record<string, boolean>) {
    const [u] = await db`insert into ba."user" (name, email, "emailVerified") values (${role}, ${role + Math.random().toString(36).slice(2, 7) + tag + '@dr.test'}, true) returning id`
    await db`update public.users set role = ${role}, tenant_id = ${tenant}, full_name = ${name + ' ' + tag} where id = ${u.id}`
    if (permissions) await db`update public.users set permissions = ${db.json(permissions)} where id = ${u.id}`
    return u.id as string
  }
  const cell = (section: string, day: number, period: string, subject: string) =>
    call('timetable', 'POST', { kind: 'cell', section_id: section, day, period_id: period, subject_id: subject })
  const teach = (section: string, subject: string, teacher: string | null) =>
    call('timetable', 'POST', { kind: 'teacher', section_id: section, subject_id: subject, teacher_id: teacher })
  const asUser = async <T,>(userId: string, q: (s: import('postgres').Sql) => unknown) => {
    const { run } = await import('@/lib/db/sql')
    return ((await run({ as: 'user', userId }, sql => [q(sql) as never]))[0]) as unknown as T[]
  }

  beforeAll(async () => {
    const [p] = await db`select (select qual from pg_policies where tablename = 'groups' and policyname = 'groups_select') g,
                                (select qual from pg_policies where tablename = 'schedules' and policyname = 'schedules_select') s,
                                (select qual from pg_policies where tablename = 'schedule_slots' and policyname = 'schedule_slots_select') sl,
                                to_regclass('public.school_stages') is not null as has0013`
    Object.assign(before, p)
    if (!p.has0013) throw new Error('0013 is not applied on this database')
    const file = readFileSync('neon/migrations/0014_school_subjects_timetable.sql', 'utf8')
    const body = file.split(/\r?\n/).filter(l => l.trim() !== 'BEGIN;' && l.trim() !== 'COMMIT;').join('\n')
    await db.unsafe('begin')
    await db.unsafe(body)
    await db.unsafe(body) // idempotent: a second run changes nothing and does not fail
    ids.A = (await db`insert into public.tenants (name, slug, code, institution_type) values ('SchA', ${tag + 'a'}, ${code()}, 'school') returning id`)[0].id
    ids.B = (await db`insert into public.tenants (name, slug, code, institution_type) values ('SchB', ${tag + 'b'}, ${code()}, 'school') returning id`)[0].id
    ids.U = (await db`insert into public.tenants (name, slug, code, institution_type) values ('Uni', ${tag + 'u'}, ${code()}, 'university') returning id`)[0].id
    ids.aA = await person('university_admin', ids.A)
    ids.aB = await person('university_admin', ids.B)
    ids.aU = await person('university_admin', ids.U)
    ids.cm = await person('center_manager', ids.A, 'Cm', { manage_academic_structure: true, manage_schedules: false })
    ids.tH = await person('teacher', ids.A, 'Huda')
    ids.tM = await person('teacher', ids.A, 'Maha')
    ids.tS = await person('teacher', ids.A, 'Salem')
    ids.t2 = await person('teacher', ids.A, 'Omar')
    ids.tB = await person('teacher', ids.B, 'Badr')
    ids.tU = await person('teacher', ids.U, 'Uri')
    ids.s1 = await person('student', ids.A, 'Sara')
    ids.s2 = await person('student', ids.A, 'Sami')
    ids.sB = await person('student', ids.B, 'Sana')
    // part 1 structure through its own routes
    as(ids.aA, 'university_admin', ids.A)
    ids.stage = (await call('structure', 'POST', { kind: 'stage', stage_kind: 'basic', name: 'Basic' })).body.stage.id
    ids.g7 = (await call('structure', 'POST', { kind: 'grade', stage_id: ids.stage, name: 'Grade 7' })).body.grade.id
    ids.g8 = (await call('structure', 'POST', { kind: 'grade', stage_id: ids.stage, name: 'Grade 8' })).body.grade.id
    ids.year = (await call('structure', 'POST', { kind: 'year', name: tag, starts_on: '2026-09-01', ends_on: '2027-06-30', is_active: true })).body.year.id
    ids.s7A = (await call('structure', 'POST', { kind: 'section', grade_id: ids.g7, year_id: ids.year, label: 'A', teacher_id: ids.tH })).body.section.id
    ids.s7B = (await call('structure', 'POST', { kind: 'section', grade_id: ids.g7, year_id: ids.year, label: 'B' })).body.section.id
    ids.s8A = (await call('structure', 'POST', { kind: 'section', grade_id: ids.g8, year_id: ids.year, label: 'A', shift: 'morning' })).body.section.id
    expect((await call('placement', 'POST', { section_id: ids.s7A, student_ids: [ids.s1] })).status).toBe(201)
    expect((await call('placement', 'POST', { section_id: ids.s7B, student_ids: [ids.s2] })).status).toBe(201)
    // an ordinary university group (nothing may change for it)
    ids.uGroup = (await db`insert into public.groups (tenant_id, teacher_id, name) values (${ids.U}, ${ids.tU}, 'Uni group') returning id`)[0].id
  }, 240_000)

  afterAll(async () => {
    await db.unsafe('rollback').catch(() => {})
    const [left] = await db`select to_regclass('public.school_subjects') is null as no_subjects,
                                   to_regclass('public.school_periods') is null as no_periods,
                                   (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'schedule_slots'
                                      and column_name in ('school_period_id', 'school_subject_id'))::int as slot_cols,
                                   (select count(*) from pg_trigger where tgname in ('trg_schedule_slots_school', 'trg_groups_school_timetable'))::int as triggers,
                                   (select count(*) from pg_proc where proname = 'current_teacher_section_ids')::int as helper,
                                   (select qual from pg_policies where tablename = 'groups' and policyname = 'groups_select') = ${before.g as string} as groups_select_same,
                                   (select qual from pg_policies where tablename = 'schedules' and policyname = 'schedules_select') = ${before.s as string} as schedules_select_same,
                                   (select qual from pg_policies where tablename = 'schedule_slots' and policyname = 'schedule_slots_select') = ${before.sl as string} as slots_select_same,
                                   (select count(*) from public.tenants where slug like ${tag + '%'})::int as tenants`
    console.log('after ROLLBACK:', JSON.stringify(left))
    await db.end()
  }, 60_000)

  it('subjects: catalogue, codes, colours, grade links with weekly sessions', async () => {
    as(ids.aA, 'university_admin', ids.A)
    const m = await call('subjects', 'POST', { kind: 'subject', name: 'Mathematics', code: 'MATH', colour: 'info' })
    expect(m).toMatchObject({ status: 201, body: { subject: { name: 'Mathematics', code: 'MATH', colour: 'info', sort_order: 0 } } })
    ids.math = m.body.subject.id
    ids.sci = (await call('subjects', 'POST', { kind: 'subject', name: 'Science', code: 'SCI' })).body.subject.id
    ids.art = (await call('subjects', 'POST', { kind: 'subject', name: 'Art', code: 'ART', colour: 'warning' })).body.subject.id
    expect((await call('subjects', 'POST', { kind: 'subject', name: 'Maths 2', code: ' math ' })).body.code).toBe('codeTaken')
    expect((await call('subjects', 'POST', { kind: 'subject', name: 'X', code: 'X', colour: '#ff0000' })).body.code).toBe('invalidColour')
    expect((await call('subjects', 'PATCH', { kind: 'subject', id: ids.sci, name: 'General science', colour: 'success' })).body.subject)
      .toMatchObject({ name: 'General science', colour: 'success' })
    const link = (grade: string, subject: string, n: number) => call('subjects', 'POST', { kind: 'gradeSubject', grade_id: grade, subject_id: subject, weekly_sessions: n })
    expect((await link(ids.g7, ids.math, 5)).body.gradeSubject).toMatchObject({ weekly_sessions: 5 })
    expect((await link(ids.g7, ids.math, 6)).body.gradeSubject).toMatchObject({ weekly_sessions: 6 })
    expect((await link(ids.g7, ids.sci, 3)).status).toBe(200)
    expect((await link(ids.g8, ids.math, 4)).status).toBe(200)
    expect((await link(ids.g7, ids.art, 1)).status).toBe(200)
    expect((await link(ids.g7, ids.art, 0)).body.gradeSubject).toEqual({ removed: 1 })
    const [n] = await db`select count(*) filter (where deleted_at is null)::int live, count(*) filter (where deleted_at is not null)::int archived from public.school_grade_subjects where grade_id = ${ids.g7}`
    expect(n).toEqual({ live: 2, archived: 1 })
    const { loadSchoolCurriculum } = await import('@/lib/data/school-timetable')
    const cur = await loadSchoolCurriculum(ids.aA, ids.A)
    expect(cur.subjects.map(s => s.code)).toEqual(['MATH', 'SCI', 'ART'])
    expect(cur.gradeSubjects).toHaveLength(3)
    // another school / a university
    as(ids.aB, 'university_admin', ids.B)
    expect((await link(ids.g7, ids.math, 2)).body.code).toBe('gradeNotFound')
    expect((await call('subjects', 'PATCH', { kind: 'subject', id: ids.math, name: 'Hijacked' })).body.code).toBe('subjectNotFound')
    expect((await call('subjects', 'POST', { kind: 'subject', name: 'Mathematics', code: 'MATH' })).status).toBe(201) // codes are per school
    expect((await loadSchoolCurriculum(ids.aB, ids.B)).subjects.map(s => s.code)).toEqual(['MATH'])
    as(ids.aU, 'university_admin', ids.U)
    expect((await call('subjects', 'POST', { kind: 'subject', name: 'M', code: 'M' })).body.code).toBe('schoolOnly')
  }, 120_000)

  it('bell schedule: lessons and breaks, no overlap inside a shift, shifts apart', async () => {
    as(ids.aA, 'university_admin', ids.A)
    const period = (b: Record<string, unknown>) => call('periods', 'POST', b)
    ids.p1 = (await period({ starts_at: '08:00', ends_at: '08:45' })).body.period.id
    ids.p2 = (await period({ starts_at: '08:45', ends_at: '09:30' })).body.period.id
    ids.br = (await period({ period_kind: 'break', name: 'Break', starts_at: '09:30', ends_at: '09:50' })).body.period.id
    ids.p3 = (await period({ starts_at: '09:50', ends_at: '10:35' })).body.period.id
    expect((await period({ starts_at: '08:30', ends_at: '09:00' })).body.code).toBe('periodsOverlap')
    const m1 = await period({ shift: 'morning', starts_at: '07:30', ends_at: '08:15' })
    expect(m1.body.period).toMatchObject({ shift: 'morning', kind: 'lesson', starts_at: '07:30:00' })
    ids.m1 = m1.body.period.id
    expect((await call('periods', 'PATCH', { id: ids.p3, name: 'Third' })).body.period).toMatchObject({ name: 'Third' })
    expect((await call('periods', 'PATCH', { id: ids.p3, starts_at: '09:00' })).body.code).toBe('periodsOverlap')
    as(ids.aB, 'university_admin', ids.B)
    expect((await call('periods', 'PATCH', { id: ids.p1, name: 'X' })).body.code).toBe('periodNotFound')
    expect((await call('periods', 'POST', { starts_at: '08:00', ends_at: '08:45' })).status).toBe(201) // another school's bell is separate
  }, 120_000)

  it('timetable: teacher copied in, grade / break / shift refused, no teacher in two places', async () => {
    as(ids.aA, 'university_admin', ids.A)
    expect((await teach(ids.s7A, ids.math, ids.tM)).body.teacher).toMatchObject({ teacher_id: ids.tM, teacher_name: `Maha ${tag}` })
    expect((await teach(ids.s7B, ids.math, ids.tM)).status).toBe(200)
    expect((await teach(ids.s7A, ids.sci, ids.tS)).status).toBe(200)
    expect((await teach(ids.s7A, ids.art, ids.tS)).body.code).toBe('subjectNotInGrade')
    expect((await teach(ids.s7A, ids.math, ids.tB)).body.code).toBe('teacherNotInTenant')
    expect((await teach(ids.s7A, ids.math, ids.s1)).body.code).toBe('teacherNotInTenant')

    const c1 = await cell(ids.s7A, 0, ids.p1, ids.math)
    expect(c1.body.cell).toMatchObject({ day: 0, period_id: ids.p1, subject_id: ids.math, teacher_id: ids.tM })
    ids.c1 = c1.body.cell.id
    const [slot] = await db`select title, start_time::text s, end_time::text e from public.schedule_slots where id = ${ids.c1}`
    expect(slot).toEqual({ title: 'Mathematics', s: '08:00:00', e: '08:45:00' })
    expect((await cell(ids.s7B, 0, ids.p1, ids.math)).body).toMatchObject({ code: 'teacherBusy', params: { section: 'Grade 7 A' } })
    expect((await cell(ids.s7B, 0, ids.p2, ids.math)).status).toBe(200)
    expect((await cell(ids.s7A, 0, ids.br, ids.math)).body.code).toBe('periodIsBreak')
    expect((await cell(ids.s7A, 0, ids.p2, ids.art)).body.code).toBe('subjectNotInGrade')
    expect((await cell(ids.s7A, 0, ids.m1, ids.math)).body.code).toBe('periodShiftMismatch')
    expect((await cell(ids.s8A, 1, ids.m1, ids.math)).body.cell).toMatchObject({ teacher_id: null })
    // replace a cell, then back
    expect((await cell(ids.s7A, 0, ids.p1, ids.sci)).body.cell).toMatchObject({ id: ids.c1, teacher_id: ids.tS })
    expect((await cell(ids.s7A, 0, ids.p1, ids.math)).body.cell).toMatchObject({ id: ids.c1, teacher_id: ids.tM })
    // a writer cannot override what the database copies in (times, title, teacher)
    await db`update public.schedule_slots set teacher_id = ${ids.t2}, start_time = '12:00', end_time = '13:00', title = 'Hacked' where id = ${ids.c1}`
    const [kept] = await db`select teacher_id, title, start_time::text s from public.schedule_slots where id = ${ids.c1}`
    expect(kept).toEqual({ teacher_id: ids.tM, title: 'Mathematics', s: '08:00:00' })
    // a teacher change that would clash is refused, and the assignment stays as it was
    expect((await cell(ids.s7B, 0, ids.p1, ids.sci)).body.cell).toMatchObject({ teacher_id: null })
    expect((await teach(ids.s7B, ids.sci, ids.tM)).body).toMatchObject({ code: 'teacherBusy', params: { section: 'Grade 7 A' } })
    const [st] = await db`select count(*)::int n from public.school_subject_teachers where group_id = ${ids.s7B} and subject_id = ${ids.sci} and deleted_at is null`
    expect(st.n).toBe(0)
    expect((await teach(ids.s7B, ids.sci, ids.t2)).status).toBe(200)
    const [b1] = await db`select sl.teacher_id from public.schedule_slots sl join public.schedules s on s.id = sl.schedule_id
                          where s.group_id = ${ids.s7B} and sl.day_of_week = 0 and sl.school_period_id = ${ids.p1}`
    expect(b1.teacher_id).toBe(ids.t2)
    expect((await teach(ids.s7B, ids.sci, null)).body.teacher).toEqual({ removed: 1 })
    const [b2] = await db`select sl.teacher_id from public.schedule_slots sl join public.schedules s on s.id = sl.schedule_id
                          where s.group_id = ${ids.s7B} and sl.day_of_week = 0 and sl.school_period_id = ${ids.p1}`
    expect(b2.teacher_id).toBeNull()
    // a period's new times reach its cells; a renamed subject reaches its cells
    expect((await call('periods', 'PATCH', { id: ids.p1, ends_at: '08:40' })).status).toBe(200)
    const [moved] = await db`select end_time::text e from public.schedule_slots where id = ${ids.c1}`
    expect(moved.e).toBe('08:40:00')
    expect((await call('subjects', 'PATCH', { kind: 'subject', id: ids.math, name: 'Maths' })).status).toBe(200)
    const [renamed] = await db`select title from public.schedule_slots where id = ${ids.c1}`
    expect(renamed.title).toBe('Maths')
    // in use: refused archive / unlink
    expect((await call('periods', 'DELETE', { id: ids.p1 })).body.code).toBe('periodInUse')
    expect((await call('subjects', 'DELETE', { kind: 'subject', id: ids.math })).body.code).toBe('subjectInUse')
    expect((await call('subjects', 'POST', { kind: 'gradeSubject', grade_id: ids.g7, subject_id: ids.math, weekly_sessions: 0 })).body.code).toBe('subjectInUse')
    // the database guard holds even without the route's check
    await db.unsafe('savepoint guard')
    await expect(db`update public.school_periods set deleted_at = now() where id = ${ids.p1}`).rejects.toMatchObject({ code: '55000' })
    await db.unsafe('rollback to savepoint guard')
    // clear, publish
    expect((await call('timetable', 'DELETE', { kind: 'cell', section_id: ids.s7B, day: 0, period_id: ids.p1 })).body.cell).toEqual({ removed: 1 })
    expect((await call('timetable', 'PATCH', { section_id: ids.s7A, is_published: true })).body.schedule).toEqual({ is_published: true })
    // the editor read
    const got = await call('timetable', 'GET', undefined, `?section_id=${ids.s7A}`)
    expect(got.body.section).toMatchObject({ id: ids.s7A, grade_id: ids.g7, year_id: ids.year })
    expect(got.body.schedule).toMatchObject({ is_published: true })
    expect(got.body.cells).toHaveLength(1)
    expect(got.body.teachers.map((x: { teacher_id: string }) => x.teacher_id).sort()).toEqual([ids.tM, ids.tS].sort())
    expect(got.body.busy).toEqual([expect.objectContaining({ teacher_id: ids.tM, day: 0, section_id: ids.s7B, section_name: 'Grade 7 B' })])
  }, 180_000)

  it('another school, a university and a manager without manage_schedules cannot touch it', async () => {
    as(ids.aB, 'university_admin', ids.B)
    expect((await cell(ids.s7A, 1, ids.p2, ids.math)).body.code).toBe('sectionNotFound')
    expect((await call('timetable', 'GET', undefined, `?section_id=${ids.s7A}`)).body.code).toBe('sectionNotFound')
    expect((await teach(ids.s7A, ids.math, ids.tB)).body.code).toBe('sectionNotFound')
    expect((await call('timetable', 'PATCH', { section_id: ids.s7A, is_published: false })).body.code).toBe('sectionNotFound')
    expect((await call('timetable', 'DELETE', { kind: 'cell', section_id: ids.s7A, day: 0, period_id: ids.p1 })).body.code).toBe('sectionNotFound')
    as(ids.aU, 'university_admin', ids.U)
    expect((await cell(ids.s7A, 1, ids.p2, ids.math)).body.code).toBe('schoolOnly')
    as(ids.cm, 'center_manager', ids.A)
    expect((await cell(ids.s7A, 1, ids.p2, ids.math)).status).toBe(403)
    expect((await call('subjects', 'POST', { kind: 'subject', name: 'Music', code: 'MUS' })).status).toBe(201)
    const [n] = await db`select count(*)::int n from public.schedule_slots sl join public.schedules s on s.id = sl.schedule_id where s.group_id = ${ids.s7A}`
    expect(n.n).toBe(1)
  }, 120_000)

  it('RLS: a subject teacher sees the sections, rosters and timetables they teach; students their own', async () => {
    const groups = async (u: string) => (await asUser<{ id: string }>(u, s => s`select id from public.groups where tenant_id = ${ids.A} order by name`)).map(r => r.id)
    expect((await groups(ids.tM)).sort()).toEqual([ids.s7A, ids.s7B].sort())
    expect(await groups(ids.tS)).toEqual([ids.s7A])
    expect(await groups(ids.tH)).toEqual([ids.s7A]) // homeroom rule of 0013 unchanged
    expect(await groups(ids.t2)).toEqual([])
    expect(await groups(ids.s1)).toEqual([ids.s7A])
    const roster = await asUser<{ student_id: string }>(ids.tS, s => s`select student_id from public.group_students where group_id in (${ids.s7A}, ${ids.s7B})`)
    expect(roster.map(r => r.student_id)).toEqual([ids.s1])
    const sched = await asUser<{ group_id: string }>(ids.tS, s => s`select group_id from public.schedules where tenant_id = ${ids.A}`)
    expect(sched.map(r => r.group_id)).toEqual([ids.s7A])
    expect(await asUser(ids.t2, s => s`select id from public.schedule_slots where tenant_id = ${ids.A}`)).toEqual([])
    const assigned = async (u: string) => (await asUser<{ group_id: string }>(u, s => s`select group_id from public.school_subject_teachers where tenant_id = ${ids.A}`)).map(r => r.group_id)
    expect((await assigned(ids.tS)).every(g => g === ids.s7A)).toBe(true)
    expect(await assigned(ids.t2)).toEqual([])
    expect((await assigned(ids.s1)).every(g => g === ids.s7A)).toBe(true)
    expect(await assigned(ids.s2)).toEqual([ids.s7B])
    expect(await assigned(ids.sB)).toEqual([])
    expect((await assigned(ids.aA)).length).toBe(3)
    const [subj] = await asUser<{ n: number }>(ids.sB, s => s`select count(*)::int n from public.school_subjects where tenant_id = ${ids.A}`)
    expect(subj.n).toBe(0)
    const [mineSubj] = await asUser<{ n: number }>(ids.s1, s => s`select count(*)::int n from public.school_subjects where tenant_id = ${ids.A}`)
    expect(mineSubj.n).toBe(4)
    // nothing changes for a university group
    expect(await asUser<{ id: string }>(ids.tU, s => s`select id from public.groups where tenant_id = ${ids.U}`)).toEqual([{ id: ids.uGroup }])
    // the student's existing schedule screen shows the published section timetable; 7B is not published
    const { loadStudentSchedule } = await import('@/lib/schedules-data')
    expect((await loadStudentSchedule(ids.s1)).map(x => [x.title, x.day_of_week, x.group_name, x.teacher_name]))
      .toEqual([['Maths', 0, 'Grade 7 A', `Maha ${tag}`]])
    expect(await loadStudentSchedule(ids.s2)).toEqual([])
    // «جدولي»: the teacher's own periods across sections (active year)
    const { loadTeacherSchoolPeriods } = await import('@/lib/data/school-timetable')
    expect((await loadTeacherSchoolPeriods(ids.tM, ids.A)).map(x => [x.day_of_week, x.start_time, x.group_name]))
      .toEqual([[0, '08:00:00', 'Grade 7 A'], [0, '08:45:00', 'Grade 7 B']])
    expect(await loadTeacherSchoolPeriods(ids.t2, ids.A)).toEqual([])
    const { loadTeacherSchedules } = await import('@/lib/schedules-data')
    expect((await loadTeacherSchedules(ids.tM, ids.A)).map(x => x.group_id).sort()).toEqual([ids.s7A, ids.s7B].sort())
  }, 120_000)

  it('privileges: app_user reads only, app_service never deletes, functions not callable by PUBLIC', async () => {
    const { run } = await import('@/lib/db/sql')
    await expect(run({ as: 'user', userId: ids.aA }, sql => [sql`insert into public.school_subjects (tenant_id, name, code) values (${ids.A}, 'X', 'XX')`]))
      .rejects.toMatchObject({ code: '42501' })
    await expect(run({ as: 'service', tenantId: ids.A }, sql => [sql`delete from public.school_subjects where id = ${ids.math}`]))
      .rejects.toMatchObject({ code: '42501' })
    await expect(run({ as: 'service', tenantId: ids.B }, sql => [sql`update public.school_subjects set name = 'X' where id = ${ids.math} returning id`]))
      .resolves.toEqual([[]]) // pinned to another school: the row is invisible
    const fns = await db`select p.proname, p.prosecdef, p.proconfig, coalesce(p.proacl::text, '') acl from pg_proc p
                          where p.pronamespace = 'public'::regnamespace and p.proname in
                            ('school_curriculum_row_check', 'school_slot_check', 'school_timetable_sync', 'groups_school_timetable_sync', 'current_teacher_section_ids')
                          order by p.proname`
    expect(fns).toHaveLength(5)
    for (const f of fns) {
      expect(f.prosecdef).toBe(true)
      expect(f.proconfig).toEqual(['search_path=public, pg_temp'])
      expect(f.acl).not.toMatch(/(^|[{,])=X/) // no PUBLIC execute
      expect(f.acl).not.toMatch(/\b(anon|authenticated|service_role)=/)
    }
    expect(fns.find(f => f.proname === 'current_teacher_section_ids')!.acl).toMatch(/app_user=X/)
    const grants = await db`select grantee, string_agg(privilege_type, ',' order by privilege_type) p from information_schema.role_table_grants
                             where table_schema = 'public' and table_name = 'school_subject_teachers' and grantee <> 'neondb_owner' group by grantee order by grantee`
    expect(grants).toEqual([{ grantee: 'app_service', p: 'INSERT,SELECT,UPDATE' }, { grantee: 'app_user', p: 'SELECT' }])
  }, 60_000)

  it('section changes: archive frees the teacher; restore and shift change are re-checked', async () => {
    as(ids.aA, 'university_admin', ids.A)
    // 8A (morning) has a morning-period cell: moving it to the evening shift is refused
    expect((await call('structure', 'PATCH', { kind: 'section', id: ids.s8A, shift: 'evening' })).body.code).toBe('periodShiftMismatch')
    // 7B archived: Maha's 7B period no longer blocks her; restoring 7B would clash, so it is refused
    expect((await call('structure', 'DELETE', { kind: 'section', id: ids.s7B })).status).toBe(200)
    expect((await cell(ids.s7A, 0, ids.p2, ids.math)).body.cell).toMatchObject({ teacher_id: ids.tM })
    expect((await call('structure', 'PATCH', { kind: 'section', id: ids.s7B, is_active: true })).body).toMatchObject({ code: 'teacherBusy', params: { section: 'Grade 7 A' } })
    expect((await call('timetable', 'DELETE', { kind: 'cell', section_id: ids.s7A, day: 0, period_id: ids.p2 })).status).toBe(200)
    expect((await call('structure', 'PATCH', { kind: 'section', id: ids.s7B, is_active: true })).body.section.is_active).toBe(true)
  }, 120_000)
})
