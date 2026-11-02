// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import postgres from 'postgres'

// The school structure end to end on the Neon trial (neon/migrations/0013),
// with two schools and a university. Real routes, SQL layer, RLS, triggers;
// only "who is signed in" comes from the test. Every cross-institution or
// non-school attempt must be refused and change nothing. Runs with
// `npm run test:neon`; skipped until 0013 is applied to the trial.

type Who = { sub: string; role: string; tenant_id: string | null }
const who = vi.hoisted(() => ({ ctx: null as null | Who }))
vi.mock('@/lib/auth/current', async () => ({
  ...(await vi.importActual<object>('@/lib/auth/current')),
  currentCtx: async () => (who.ctx ? { ...who.ctx, email: null, is_active: true, must_change_password: false } : null),
}))
vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: async () => ({ allowed: true, remaining: 1, resetAt: 0 }) }))

const READY = !!(process.env.NEON_GATEWAY_DATABASE_URL && process.env.NEON_DATABASE_URL)

describe.skipIf(!READY)('school structure on the trial', () => {
  const owner = postgres(process.env.NEON_DATABASE_URL ?? 'postgres://unused', { max: 1, prepare: false, onnotice: () => {} })
  const tag = `sch${Date.now()}`
  const code = () => Math.random().toString(36).slice(2, 7).toUpperCase().replace(/[^A-Z0-9]/g, 'X').padEnd(5, 'X')
  const ids = { A: '', B: '', U: '', aA: '', aB: '', aU: '', hr: '', t2: '', s1: '', s2: '', sB: '', stage: '', grade: '', year: '', secA: '', secB: '' }
  let applied = false

  async function person(role: string, tenant: string, name = role) {
    const [u] = await owner`insert into ba."user" (name, email, "emailVerified") values (${role}, ${role + Math.random().toString(36).slice(2, 7) + tag + '@sch-test.test'}, true) returning id`
    await owner`update public.users set role = ${role}, tenant_id = ${tenant}, full_name = ${name + ' ' + tag} where id = ${u.id}`
    return u.id as string
  }
  const as = (sub: string, role: string, tenant: string) => { who.ctx = { sub, role, tenant_id: tenant } }
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
  const visibleGroups = async (userId: string, tenant: string) => {
    const { run } = await import('@/lib/db/sql')
    const [rows] = await run({ as: 'user', userId }, sql => [sql`select id from public.groups where tenant_id = ${tenant}`])
    return rows.map(r => r.id as string)
  }

  beforeAll(async () => {
    const [t] = await owner`select to_regclass('public.school_stages') is not null as ok`
    applied = t.ok
    if (!applied) return
    ids.A = (await owner`insert into public.tenants (name, slug, code, institution_type) values ('SchA', ${tag + 'a'}, ${code()}, 'school') returning id`)[0].id
    ids.B = (await owner`insert into public.tenants (name, slug, code, institution_type) values ('SchB', ${tag + 'b'}, ${code()}, 'school') returning id`)[0].id
    ids.U = (await owner`insert into public.tenants (name, slug, code, institution_type) values ('Uni', ${tag + 'u'}, ${code()}, 'university') returning id`)[0].id
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
    if (applied && ids.A) {
      const tenants = [ids.A, ids.B, ids.U]
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

  it('builds stage → grade → sections and a year with a term, in the own school only', async ({ skip }) => {
    if (!applied) return skip()
    as(ids.aA, 'university_admin', ids.A)
    const stage = await call('structure', 'POST', { kind: 'stage', stage_kind: 'basic', name: 'Basic stage', code: 'BS' })
    expect(stage.status).toBe(201)
    ids.stage = stage.body.stage.id
    const grade = await call('structure', 'POST', { kind: 'grade', stage_id: ids.stage, name: 'Grade 7' })
    ids.grade = grade.body.grade.id
    const year = await call('structure', 'POST', { kind: 'year', name: tag, starts_on: '2026-09-01', ends_on: '2027-06-30', is_active: true })
    expect(year.body.year).toMatchObject({ is_active: true, starts_on: '2026-09-01' })
    ids.year = year.body.year.id
    expect((await call('structure', 'POST', { kind: 'term', year_id: ids.year, term_no: 1, name: 'T1', starts_on: '2026-09-01', ends_on: '2027-01-20' })).status).toBe(201)
    expect((await call('structure', 'POST', { kind: 'term', year_id: ids.year, term_no: 2, name: 'T2', starts_on: '2027-02-01', ends_on: '2027-07-30' })).body.code).toBe('termOutsideYear')
    expect((await call('teachers/search', 'GET', undefined, '?for=school&q=Huda')).body.teachers.map((x: { id: string }) => x.id)).toEqual([ids.hr])
    const a = await call('structure', 'POST', { kind: 'section', grade_id: ids.grade, year_id: ids.year, label: 'A', capacity: 1, teacher_id: ids.hr, shift: 'morning' })
    expect(a.body.section).toMatchObject({ name: 'Grade 7 A', capacity: 1, teacher_id: ids.hr, members: 0 })
    ids.secA = a.body.section.id
    const b = await call('structure', 'POST', { kind: 'section', grade_id: ids.grade, year_id: ids.year, label: 'B' })
    expect(b.body.section).toMatchObject({ name: 'Grade 7 B', teacher_id: null })
    ids.secB = b.body.section.id
    expect((await call('structure', 'POST', { kind: 'section', grade_id: ids.grade, year_id: ids.year, label: 'b' })).body.code).toBe('sectionLabelTaken')
    expect((await call('structure', 'POST', { kind: 'section', grade_id: ids.grade, year_id: ids.year, label: 'C', teacher_id: ids.s1 })).body.code).toBe('teacherNotInTenant')
    // a grade rename re-composes its sections' names
    await call('structure', 'PATCH', { kind: 'grade', id: ids.grade, name: 'Seventh grade' })
    const [n] = await owner`select name from public.groups where id = ${ids.secA}`
    expect(n.name).toBe('Seventh grade A')
  }, 120_000)

  it('another school and a university cannot see or touch it', async ({ skip }) => {
    if (!applied) return skip()
    as(ids.aB, 'university_admin', ids.B)
    expect((await call('structure', 'PATCH', { kind: 'stage', id: ids.stage, name: 'Hijacked' })).status).toBe(404)
    expect((await call('structure', 'DELETE', { kind: 'grade', id: ids.grade })).status).toBe(404)
    expect((await call('structure', 'POST', { kind: 'grade', stage_id: ids.stage, name: 'X' })).body.code).toBe('stageNotFound')
    expect((await call('placement', 'POST', { section_id: ids.secA, student_ids: [ids.sB] })).body.code).toBe('sectionNotFound')
    expect((await call('placement', 'GET', undefined, `?year_id=${ids.year}`)).status).toBe(404)
    as(ids.aU, 'university_admin', ids.U)
    expect((await call('structure', 'POST', { kind: 'stage', stage_kind: 'basic', name: 'X' })).body.code).toBe('schoolOnly')
    const [s] = await owner`select name from public.school_stages where id = ${ids.stage}`
    expect(s.name).toBe('Basic stage')
    const [c] = await owner`select count(*)::int n from public.school_stages where tenant_id in (${ids.B}, ${ids.U})`
    expect(c.n).toBe(0)
  }, 120_000)

  it('placement: capacity, one section per year, moves, and no foreign students', async ({ skip }) => {
    if (!applied) return skip()
    as(ids.aA, 'university_admin', ids.A)
    expect((await call('placement', 'POST', { section_id: ids.secA, student_ids: [ids.s1] })).body).toEqual({ placed: 1, moved: 0 })
    expect((await call('placement', 'POST', { section_id: ids.secA, student_ids: [ids.s2] })).body.code).toBe('sectionFull')
    expect((await call('placement', 'POST', { section_id: ids.secB, student_ids: [ids.sB] })).body.code).toBe('studentNotInTenant')
    expect((await call('placement', 'POST', { section_id: ids.secB, student_ids: [ids.s1, ids.s2] })).body).toEqual({ placed: 2, moved: 1 })
    const rows = await owner`select group_id, school_year_id from public.group_students where student_id = ${ids.s1}`
    expect(rows).toEqual([{ group_id: ids.secB, school_year_id: ids.year }])
    const list = await call('placement', 'GET', undefined, `?year_id=${ids.year}&q=${tag}`)
    expect(list.body.total).toBe(2)
    expect(list.body.students.every((x: { section_id: string }) => x.section_id === ids.secB)).toBe(true)
    expect((await call('placement', 'GET', undefined, `?year_id=${ids.year}&q=${tag}&unplaced=1`)).body.total).toBe(0)
  }, 120_000)

  it('RLS: the homeroom teacher sees only own section; another teacher none; a student only theirs', async ({ skip }) => {
    if (!applied) return skip()
    const hr = await visibleGroups(ids.hr, ids.A)
    expect(hr).toContain(ids.secA)
    expect(hr).not.toContain(ids.secB)
    expect(await visibleGroups(ids.t2, ids.A)).toEqual([])
    expect(await visibleGroups(ids.s1, ids.A)).toEqual([ids.secB])
    const { run } = await import('@/lib/db/sql')
    const [mine] = await run({ as: 'user', userId: ids.s1 }, sql => [sql`select group_id from public.group_students`])
    expect(mine.map(r => r.group_id)).toEqual([ids.secB])
    const [other] = await run({ as: 'user', userId: ids.sB }, sql => [sql`select count(*)::int n from public.school_stages`])
    expect(other[0].n).toBe(0)
  }, 120_000)

  it('archive: refused while sections are active, then allowed; the active year stays', async ({ skip }) => {
    if (!applied) return skip()
    as(ids.aA, 'university_admin', ids.A)
    expect((await call('structure', 'DELETE', { kind: 'stage', id: ids.stage })).body.code).toBe('hasActiveSections')
    expect((await call('structure', 'DELETE', { kind: 'year', id: ids.year })).body.code).toBe('yearIsActive')
    expect((await call('structure', 'DELETE', { kind: 'section', id: ids.secA })).status).toBe(200)
    expect((await call('structure', 'DELETE', { kind: 'section', id: ids.secB })).status).toBe(200)
    expect((await call('structure', 'DELETE', { kind: 'stage', id: ids.stage })).status).toBe(200)
    const [g] = await owner`select deleted_at is not null as archived from public.school_grades where id = ${ids.grade}`
    expect(g.archived).toBe(true)
  }, 120_000)
})
