// @vitest-environment node
// Migration 0013 (school structure) PROVEN BEFORE IT IS APPLIED: the real
// /api/school/* routes and src/lib/data/school-structure.ts against 0013
// applied INSIDE one transaction on the Neon trial that is always ROLLED
// BACK — nothing is ever committed. The SQL layer is replaced by one that runs
// every unit in a savepoint of that transaction, with the same identity / role
// switch as src/lib/db/sql.ts (app_user / app_service / app_system).
// Opt-in only (it holds DDL locks on groups/group_students while it runs, ~4 min
// from a PC far from the database):
//   SCHOOL_DRYRUN=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run --pool=threads src/__tests__/school-structure-dryrun.test.ts
// Once 0013 is applied, school-structure-trial.test.ts covers the same ground.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import postgres from 'postgres'

type Who = { sub: string; role: string; tenant_id: string | null }
const h = vi.hoisted(() => ({ ctx: null as null | Who, db: null as unknown as import('postgres').Sql, n: 0 }))
vi.mock('@/lib/auth/current', async () => ({
  ...(await vi.importActual<object>('@/lib/auth/current')),
  currentCtx: async () => (h.ctx ? { ...h.ctx, email: null, is_active: true, must_change_password: false } : null),
}))
vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))
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
describe.skipIf(!URL_ || !process.env.SCHOOL_DRYRUN)('school structure: routes + data layer on 0013 inside a rolled-back transaction', () => {
  const db = postgres(URL_ ?? 'postgres://unused', { max: 1, prepare: false, onnotice: () => {} })
  h.db = db
  const tag = `dr${Date.now()}`
  const code = () => Math.random().toString(36).slice(2, 7).toUpperCase().replace(/[^A-Z0-9]/g, 'X').padEnd(5, 'X')
  const ids = { A: '', B: '', U: '', aA: '', aB: '', aU: '', hr: '', t2: '', s1: '', s2: '', sB: '', stage: '', stage2: '', grade: '', grade2: '', year: '', year2: '', term: '', secA: '', secB: '' }
  const as = (sub: string, role: string, tenant: string) => { h.ctx = { sub, role, tenant_id: tenant } }
  const routes: Record<string, () => Promise<unknown>> = {
    structure: () => import('@/app/api/school/structure/route'),
    placement: () => import('@/app/api/school/placement/route'),
    'teachers/search': () => import('@/app/api/teachers/search/route'),
  }
  const call = async (path: string, method: string, body?: unknown, qs = '') => {
    const mod = (await routes[path]()) as Record<string, (r: Request) => Promise<Response>>
    const res = await mod[method](new Request(`http://x/api/${path}${qs}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }))
    return { status: res.status, body: await res.json().catch(() => null) }
  }
  async function person(role: string, tenant: string, name = role) {
    const [u] = await db`insert into ba."user" (name, email, "emailVerified") values (${role}, ${role + Math.random().toString(36).slice(2, 7) + tag + '@dr.test'}, true) returning id`
    await db`update public.users set role = ${role}, tenant_id = ${tenant}, full_name = ${name + ' ' + tag} where id = ${u.id}`
    return u.id as string
  }

  beforeAll(async () => {
    const file = readFileSync('neon/migrations/0013_school_structure.sql', 'utf8')
    const body = file.split(/\r?\n/).filter(l => l.trim() !== 'BEGIN;' && l.trim() !== 'COMMIT;').join('\n')
    await db.unsafe('begin')
    await db.unsafe(body)
    ids.A = (await db`insert into public.tenants (name, slug, code, institution_type) values ('SchA', ${tag + 'a'}, ${code()}, 'school') returning id`)[0].id
    ids.B = (await db`insert into public.tenants (name, slug, code, institution_type) values ('SchB', ${tag + 'b'}, ${code()}, 'school') returning id`)[0].id
    ids.U = (await db`insert into public.tenants (name, slug, code, institution_type) values ('Uni', ${tag + 'u'}, ${code()}, 'university') returning id`)[0].id
    ids.aA = await person('university_admin', ids.A)
    ids.aB = await person('university_admin', ids.B)
    ids.aU = await person('university_admin', ids.U)
    ids.hr = await person('teacher', ids.A, 'Huda')
    ids.t2 = await person('teacher', ids.A, 'Omar')
    ids.s1 = await person('student', ids.A, 'Sara')
    ids.s2 = await person('student', ids.A, 'Sami')
    ids.sB = await person('student', ids.B, 'Sara')
  }, 120_000)
  afterAll(async () => {
    await db.unsafe('rollback').catch(() => {})
    const [left] = await db`select (select count(*) from pg_tables where schemaname = 'public' and tablename like 'school\_%')::int t,
                                   (select count(*) from public.tenants where slug like ${tag + '%'})::int ten`
    console.log('after ROLLBACK:', JSON.stringify(left))
    await db.end()
  }, 60_000)

  it('structure: create, edit, rename cascade, refusals', async () => {
    as(ids.aA, 'university_admin', ids.A)
    const stage = await call('structure', 'POST', { kind: 'stage', stage_kind: 'basic', name: 'Basic stage', code: 'BS' })
    expect(stage).toMatchObject({ status: 201, body: { stage: { kind: 'basic', name: 'Basic stage', code: 'BS', sort_order: 0 } } })
    ids.stage = stage.body.stage.id
    const stage2 = await call('structure', 'POST', { kind: 'stage', stage_kind: 'secondary', name: 'Secondary' })
    expect(stage2.body.stage.sort_order).toBe(1)
    ids.stage2 = stage2.body.stage.id
    expect((await call('structure', 'POST', { kind: 'stage', stage_kind: 'kindergarten', name: 'KG', code: 'bs' })).body.code).toBe('codeTaken')
    expect((await call('structure', 'PATCH', { kind: 'stage', id: ids.stage2, stage_kind: 'kindergarten', code: '' })).body.stage).toMatchObject({ kind: 'kindergarten', code: null })
    expect((await call('structure', 'PATCH', { kind: 'stage', order: [ids.stage2, ids.stage] })).body).toEqual({ order: { updated: 2 } })
    const grade = await call('structure', 'POST', { kind: 'grade', stage_id: ids.stage, name: 'Grade 7' })
    expect(grade).toMatchObject({ status: 201, body: { grade: { stage_id: ids.stage, track: null, sort_order: 0 } } })
    ids.grade = grade.body.grade.id
    const g2 = await call('structure', 'POST', { kind: 'grade', stage_id: ids.stage, name: 'Grade 10', track: 'scientific', code: 'G10S' })
    expect(g2.body.grade).toMatchObject({ track: 'scientific', sort_order: 1 })
    ids.grade2 = g2.body.grade.id
    expect((await call('structure', 'PATCH', { kind: 'grade', order: [ids.grade2, ids.grade] })).body).toEqual({ order: { updated: 2 } })
    const year = await call('structure', 'POST', { kind: 'year', name: '2026/2027', starts_on: '2026-09-01', ends_on: '2027-06-30', is_active: true })
    expect(year.body.year).toMatchObject({ name: '2026/2027', starts_on: '2026-09-01', ends_on: '2027-06-30', is_active: true })
    ids.year = year.body.year.id
    const y2 = await call('structure', 'POST', { kind: 'year', name: '2027/2028', starts_on: '2027-09-01', ends_on: '2028-06-30', is_active: true })
    expect(y2.body.year.is_active).toBe(true)
    ids.year2 = y2.body.year.id
    const [actives] = await db`select count(*)::int n from public.school_years where tenant_id = ${ids.A} and is_active`
    expect(actives.n).toBe(1)
    expect((await call('structure', 'POST', { kind: 'year', name: '2026/2027', starts_on: '2030-09-01', ends_on: '2031-06-30' })).body.code).toBe('yearNameTaken')
    expect((await call('structure', 'PATCH', { kind: 'year', id: ids.year, is_active: true })).body.year.is_active).toBe(true)
    expect((await call('structure', 'PATCH', { kind: 'year', id: ids.year, ends_on: '2026-08-01' })).body.code).toBe('endBeforeStart')
    const term = await call('structure', 'POST', { kind: 'term', year_id: ids.year, term_no: 1, name: 'T1', starts_on: '2026-09-01', ends_on: '2027-01-20' })
    expect(term).toMatchObject({ status: 201, body: { term: { term_no: 1, starts_on: '2026-09-01' } } })
    ids.term = term.body.term.id
    expect((await call('structure', 'POST', { kind: 'term', year_id: ids.year, term_no: 1, name: 'dup', starts_on: '2027-02-01', ends_on: '2027-06-01' })).body.code).toBe('termNumberTaken')
    expect((await call('structure', 'POST', { kind: 'term', year_id: ids.year, term_no: 2, name: 'T2', starts_on: '2027-02-01', ends_on: '2027-07-30' })).body.code).toBe('termOutsideYear')
    expect((await call('structure', 'PATCH', { kind: 'term', id: ids.term, name: 'First term' })).body.term.name).toBe('First term')
    expect((await call('structure', 'PATCH', { kind: 'year', id: ids.year, starts_on: '2026-10-01' })).body.code).toBe('termOutsideYear')
    expect((await call('teachers/search', 'GET', undefined, '?for=school&q=Huda')).body.teachers.map((x: { id: string }) => x.id)).toEqual([ids.hr])
    const a = await call('structure', 'POST', { kind: 'section', grade_id: ids.grade, year_id: ids.year, label: 'A', capacity: 1, teacher_id: ids.hr, shift: 'morning' })
    expect(a).toMatchObject({ status: 201, body: { section: { name: 'Grade 7 A', label: 'A', capacity: 1, teacher_id: ids.hr, teacher_name: `Huda ${tag}`, members: 0, shift: 'morning', is_active: true, section_order: 0 } } })
    ids.secA = a.body.section.id
    const b = await call('structure', 'POST', { kind: 'section', grade_id: ids.grade, year_id: ids.year, label: 'B' })
    expect(b.body.section).toMatchObject({ name: 'Grade 7 B', teacher_id: null, section_order: 1 })
    ids.secB = b.body.section.id
    expect((await call('structure', 'POST', { kind: 'section', grade_id: ids.grade, year_id: ids.year, label: 'b' })).body.code).toBe('sectionLabelTaken')
    expect((await call('structure', 'POST', { kind: 'section', grade_id: ids.grade, year_id: ids.year, label: 'C', teacher_id: ids.s1 })).body.code).toBe('teacherNotInTenant')
    expect((await call('structure', 'PATCH', { kind: 'section', id: ids.secB, teacher_id: ids.t2, label: 'Bee', capacity: 40 })).body.section)
      .toMatchObject({ name: 'Grade 7 Bee', teacher_id: ids.t2, capacity: 40 })
    expect((await call('structure', 'PATCH', { kind: 'section', id: ids.secB, teacher_id: null, label: 'B' })).body.section).toMatchObject({ teacher_id: null, name: 'Grade 7 B' })
    expect((await call('structure', 'PATCH', { kind: 'section', order: [ids.secB, ids.secA] })).body).toEqual({ order: { updated: 2 } })
    const renamed = await call('structure', 'PATCH', { kind: 'grade', id: ids.grade, name: 'Seventh grade' })
    expect(renamed.body.grade).toMatchObject({ name: 'Seventh grade' })
    const names = await db`select name from public.groups where school_grade_id = ${ids.grade} order by section_label`
    expect(names.map(r => r.name)).toEqual(['Seventh grade A', 'Seventh grade B'])
  }, 120_000)

  it('the page read: one unit as the admin, sections of the chosen year', async () => {
    const { loadSchoolStructure } = await import('@/lib/data/school-structure')
    const page = await loadSchoolStructure(ids.aA, ids.A)
    expect(page.institutionType).toBe('school')
    expect(page.stages.map(s => s.id)).toEqual([ids.stage2, ids.stage])
    expect(page.grades.filter(g => g.stage_id === ids.stage).map(g => g.id)).toEqual([ids.grade2, ids.grade])
    expect(page.yearId).toBe(ids.year)
    expect(page.terms).toHaveLength(1)
    expect(page.sections.map(s => s.id)).toEqual([ids.secB, ids.secA])
    const other = await loadSchoolStructure(ids.aA, ids.A, ids.year2)
    expect(other.yearId).toBe(ids.year2)
    expect(other.sections).toEqual([])
    const foreign = await loadSchoolStructure(ids.aB, ids.B, ids.year)
    expect(foreign.yearId).toBeNull()
    expect(foreign.stages).toEqual([])
  }, 60_000)

  it('another school and a university cannot see or touch it', async () => {
    as(ids.aB, 'university_admin', ids.B)
    expect((await call('structure', 'PATCH', { kind: 'stage', id: ids.stage, name: 'Hijacked' })).body.code).toBe('stageNotFound')
    expect((await call('structure', 'PATCH', { kind: 'section', id: ids.secA, label: 'Z' })).body.code).toBe('sectionNotFound')
    expect((await call('structure', 'DELETE', { kind: 'grade', id: ids.grade })).body.code).toBe('gradeNotFound')
    expect((await call('structure', 'POST', { kind: 'grade', stage_id: ids.stage, name: 'X' })).body.code).toBe('stageNotFound')
    expect((await call('structure', 'POST', { kind: 'section', grade_id: ids.grade, year_id: ids.year, label: 'Z' })).body.code).toBe('gradeNotFound')
    expect((await call('structure', 'PATCH', { kind: 'stage', order: [ids.stage] })).body.code).toBe('invalidOrder')
    expect((await call('placement', 'POST', { section_id: ids.secA, student_ids: [ids.sB] })).body.code).toBe('sectionNotFound')
    expect((await call('placement', 'DELETE', { section_id: ids.secA, student_ids: [ids.s1] })).body.code).toBe('sectionNotFound')
    expect((await call('placement', 'GET', undefined, `?year_id=${ids.year}`)).body.code).toBe('yearNotFound')
    as(ids.aU, 'university_admin', ids.U)
    expect((await call('structure', 'POST', { kind: 'stage', stage_kind: 'basic', name: 'X' })).body.code).toBe('schoolOnly')
    as(ids.hr, 'teacher', ids.A)
    expect((await call('structure', 'POST', { kind: 'stage', stage_kind: 'basic', name: 'X' })).status).toBe(403)
    const [s] = await db`select name from public.school_stages where id = ${ids.stage}`
    expect(s.name).toBe('Basic stage')
  }, 60_000)

  it('placement: capacity, one section per year, moves, removal, foreign students', async () => {
    as(ids.aA, 'university_admin', ids.A)
    expect((await call('placement', 'POST', { section_id: ids.secA, student_ids: [ids.s1] })).body).toEqual({ placed: 1, moved: 0 })
    expect((await call('placement', 'POST', { section_id: ids.secA, student_ids: [ids.s1] })).body).toEqual({ placed: 1, moved: 0 })
    expect((await call('placement', 'POST', { section_id: ids.secA, student_ids: [ids.s2] })).body.code).toBe('sectionFull')
    expect((await call('placement', 'POST', { section_id: ids.secB, student_ids: [ids.sB] })).body.code).toBe('studentNotInTenant')
    expect((await call('placement', 'POST', { section_id: ids.secB, student_ids: [ids.s1, ids.s2] })).body).toEqual({ placed: 2, moved: 1 })
    const rows = await db`select group_id, school_year_id from public.group_students where student_id = ${ids.s1}`
    expect(rows).toEqual([{ group_id: ids.secB, school_year_id: ids.year }])
    const list = await call('placement', 'GET', undefined, `?year_id=${ids.year}&q=${tag}`)
    expect(list.body).toMatchObject({ total: 2, page: 1, pageCount: 1 })
    expect(list.body.students.every((x: { section_id: string }) => x.section_id === ids.secB)).toBe(true)
    expect((await call('placement', 'GET', undefined, `?year_id=${ids.year}&q=${tag}&unplaced=1`)).body.total).toBe(0)
    expect((await call('placement', 'GET', undefined, `?year_id=${ids.year}&section_id=${ids.secB}&page=99`)).body).toMatchObject({ total: 2, page: 1 })
    expect((await call('placement', 'GET', undefined, `?year_id=${ids.year2}&q=${tag}&unplaced=1`)).body.total).toBe(2)
    expect((await call('placement', 'DELETE', { section_id: ids.secB, student_ids: [ids.s2] })).body).toEqual({ removed: 1 })
    expect((await call('placement', 'GET', undefined, `?year_id=${ids.year}&q=${tag}&unplaced=1`)).body.total).toBe(1)
    const { loadSchoolStructure } = await import('@/lib/data/school-structure')
    const page = await loadSchoolStructure(ids.aA, ids.A)
    expect(page.sections.find(s => s.id === ids.secB)?.members).toBe(1)
  }, 120_000)

  it('RLS: homeroom teacher sees only own section; another teacher none; a student only theirs', async () => {
    const { run } = await import('@/lib/db/sql')
    const visible = async (userId: string) => ((await run({ as: 'user', userId }, sql => [sql`select id from public.groups where tenant_id = ${ids.A}`]))[0] as { id: string }[]).map(r => r.id)
    const hr = await visible(ids.hr)
    expect(hr).toContain(ids.secA)
    expect(hr).not.toContain(ids.secB)
    expect(await visible(ids.t2)).toEqual([])
    expect(await visible(ids.s1)).toEqual([ids.secB])
    const [mine] = await run({ as: 'user', userId: ids.s1 }, sql => [sql`select group_id from public.group_students`])
    expect((mine as { group_id: string }[]).map(r => r.group_id)).toEqual([ids.secB])
    const [other] = await run({ as: 'user', userId: ids.sB }, sql => [sql`select count(*)::int n from public.school_stages`])
    expect((other as { n: number }[])[0].n).toBe(0)
  }, 60_000)

  it('archive: refused while sections are active, then allowed; the active year stays', async () => {
    as(ids.aA, 'university_admin', ids.A)
    expect((await call('structure', 'DELETE', { kind: 'stage', id: ids.stage })).body.code).toBe('hasActiveSections')
    expect((await call('structure', 'DELETE', { kind: 'grade', id: ids.grade })).body.code).toBe('hasActiveSections')
    expect((await call('structure', 'DELETE', { kind: 'year', id: ids.year })).body.code).toBe('yearIsActive')
    expect((await call('structure', 'DELETE', { kind: 'year', id: ids.year2 })).body).toEqual({ success: true })
    expect((await call('structure', 'DELETE', { kind: 'term', id: ids.term })).body).toEqual({ success: true })
    expect((await call('structure', 'DELETE', { kind: 'section', id: ids.secA })).status).toBe(200)
    expect((await call('structure', 'PATCH', { kind: 'section', id: ids.secA, is_active: true })).body.section.is_active).toBe(true)
    expect((await call('structure', 'DELETE', { kind: 'section', id: ids.secA })).status).toBe(200)
    expect((await call('structure', 'DELETE', { kind: 'section', id: ids.secB })).status).toBe(200)
    expect((await call('structure', 'POST', { kind: 'section', grade_id: ids.grade, year_id: ids.year2, label: 'A' })).body.code).toBe('yearNotFound')
    expect((await call('structure', 'DELETE', { kind: 'stage', id: ids.stage })).body).toEqual({ success: true })
    const [g] = await db`select count(*) filter (where deleted_at is not null)::int archived from public.school_grades where stage_id = ${ids.stage}`
    expect(g.archived).toBe(2)
    expect((await call('placement', 'POST', { section_id: ids.secA, student_ids: [ids.s2] })).body.code).toBe('sectionNotFound')
  }, 60_000)
})
