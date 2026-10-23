// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import postgres from 'postgres'

// Group membership, course enrolment, roster pages and the student pickers end
// to end on the Neon trial, with two institutions. Real routes, SQL layer and
// RLS; only "who is signed in" comes from the test. Runs with `npm run test:neon`.

type Who = { sub: string; role: string; tenant_id: string | null }
const who = vi.hoisted(() => ({ ctx: null as null | Who }))
vi.mock('@/lib/auth/current', async () => ({
  ...(await vi.importActual<object>('@/lib/auth/current')),
  currentCtx: async () => (who.ctx ? { ...who.ctx, email: null, is_active: true, must_change_password: false } : null),
}))
vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))

const READY = !!(process.env.NEON_GATEWAY_DATABASE_URL && process.env.NEON_DATABASE_URL)

describe.skipIf(!READY)('membership on the trial', () => {
  const owner = postgres(process.env.NEON_DATABASE_URL ?? 'postgres://unused', { max: 1, prepare: false, onnotice: () => {} })
  const tag = `mb${Date.now()}`
  const code = () => Math.random().toString(36).slice(2, 7).toUpperCase().replace(/[^A-Z0-9]/g, 'X').padEnd(5, 'X')
  const ids = { A: '', B: '', aB: '', tA: '', tA2: '', tB: '', s1: '', s2: '', s3: '', sB: '', gA: '', gSmall: '', gB: '', course: '' }

  async function person(role: string, tenant: string, name: string) {
    const [u] = await owner`insert into ba."user" (name, email, "emailVerified") values (${role}, ${role + Math.random().toString(36).slice(2, 7) + tag + '@mb-test.test'}, true) returning id`
    await owner`update public.users set role = ${role}, tenant_id = ${tenant}, full_name = ${name} where id = ${u.id}`
    return u.id as string
  }
  const as = (sub: string, role: string, tenant: string) => { who.ctx = { sub, role, tenant_id: tenant } }
  const routes: Record<string, () => Promise<unknown>> = {
    'group-students': () => import('@/app/api/group-students/route'),
    'course-enrollments': () => import('@/app/api/course-enrollments/route'),
    'roster/candidates': () => import('@/app/api/roster/candidates/route'),
    'students/search': () => import('@/app/api/students/search/route'),
  }
  const call = async (path: string, method: string, body?: unknown, qs = '') => {
    const mod = (await routes[path]()) as Record<string, (r: Request) => Promise<Response>>
    const res = await mod[method](new Request(`http://x/api/${path}${qs}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }))
    return { status: res.status, body: await res.json().catch(() => null) }
  }

  beforeAll(async () => {
    ids.A = (await owner`insert into public.tenants (name, slug, code) values ('MA', ${tag + 'a'}, ${code()}) returning id`)[0].id
    ids.B = (await owner`insert into public.tenants (name, slug, code) values ('MB', ${tag + 'b'}, ${code()}) returning id`)[0].id
    ids.aB = await person('university_admin', ids.B, 'Admin B')
    ids.tA = await person('teacher', ids.A, 'Teacher A')
    ids.tA2 = await person('teacher', ids.A, 'Teacher A2')
    ids.tB = await person('teacher', ids.B, 'Teacher B')
    ids.s1 = await person('student', ids.A, `Huda ${tag}`)
    ids.s2 = await person('student', ids.A, `Hiba ${tag}`)
    ids.s3 = await person('student', ids.A, `Hala ${tag}`)
    ids.sB = await person('student', ids.B, `Huda ${tag}`)
    ids.course = (await owner`insert into public.courses (tenant_id, teacher_id, title) values (${ids.A}, ${ids.tA}, 'Course A') returning id`)[0].id
    ids.gA = (await owner`insert into public.groups (tenant_id, teacher_id, name, course_id) values (${ids.A}, ${ids.tA}, 'GA', ${ids.course}) returning id`)[0].id
    ids.gSmall = (await owner`insert into public.groups (tenant_id, teacher_id, name, max_students) values (${ids.A}, ${ids.tA}, 'Small', 1) returning id`)[0].id
    ids.gB = (await owner`insert into public.groups (tenant_id, teacher_id, name) values (${ids.B}, ${ids.tB}, 'GB') returning id`)[0].id
  }, 120_000)
  afterAll(async () => {
    await owner`delete from public.groups where tenant_id in (${ids.A}, ${ids.B})`
    await owner`delete from public.courses where tenant_id in (${ids.A}, ${ids.B})`
    await owner`delete from ba."user" where email like ${'%' + tag + '%'}`
    await owner`delete from public.tenants where id in (${ids.A}, ${ids.B})`
    await owner.end()
  }, 90_000)

  it('add to a group: the institution\'s own student only; a group that is a course section enrols in the course too', async () => {
    as(ids.tA, 'teacher', ids.A)
    expect((await call('group-students', 'POST', { group_id: ids.gA, student_id: ids.sB })).status).toBe(404)
    const ok = await call('group-students', 'POST', { group_id: ids.gA, student_id: ids.s1 })
    expect(ok.status).toBe(201)
    const [e] = await owner`select count(*)::int n from public.course_enrollments where course_id = ${ids.course} and student_id = ${ids.s1}`
    expect(e.n).toBe(1)
  }, 90_000)

  it('the seat cap holds; a colleague and another institution cannot add or remove', async () => {
    as(ids.tA, 'teacher', ids.A)
    expect((await call('group-students', 'POST', { group_id: ids.gSmall, student_id: ids.s2 })).status).toBe(201)
    expect((await call('group-students', 'POST', { group_id: ids.gSmall, student_id: ids.s2 })).status).toBe(201)
    expect((await call('group-students', 'POST', { group_id: ids.gSmall, student_id: ids.s3 })).status).toBe(409)
    as(ids.tA2, 'teacher', ids.A)
    expect((await call('group-students', 'POST', { group_id: ids.gA, student_id: ids.s2 })).status).toBe(403)
    expect((await call('group-students', 'DELETE', { group_id: ids.gA, student_id: ids.s1 })).status).toBe(403)
    as(ids.aB, 'university_admin', ids.B)
    expect((await call('group-students', 'DELETE', { group_id: ids.gA, student_id: ids.s1 })).status).toBe(404)
    expect((await call('group-students', 'GET', undefined, `?group_id=${ids.gA}`)).status).toBe(404)
    const rows = await owner`select student_id from public.group_students where group_id in (${ids.gA}, ${ids.gSmall}) order by student_id`
    expect(rows.map(r => r.student_id).sort()).toEqual([ids.s1, ids.s2].sort())
  }, 90_000)

  it('rosters: whole and paged, for the owner only', async () => {
    as(ids.tA, 'teacher', ids.A)
    const whole = await call('group-students', 'GET', undefined, `?group_id=${ids.gA}`)
    expect(whole.body.students.map((s: { id: string }) => s.id)).toEqual([ids.s1])
    const page = await call('group-students', 'GET', undefined, `?group_id=${ids.gA}&page=7`)
    expect(page.body).toMatchObject({ total: 1, page: 1, pageCount: 1 })
    const course = await call('course-enrollments', 'GET', undefined, `?course_id=${ids.course}&page=1`)
    expect(course.body.students.map((s: { id: string }) => s.id)).toEqual([ids.s1])
  }, 90_000)

  it('pickers: only the institution\'s students who are not yet members', async () => {
    as(ids.tA, 'teacher', ids.A)
    const search = await call('students/search', 'GET', undefined, `?q=${tag}&group_id=${ids.gA}`)
    expect(search.body.students.map((s: { id: string }) => s.id).sort()).toEqual([ids.s2, ids.s3].sort())
    const cand = await call('roster/candidates', 'GET', undefined, `?course_id=${ids.course}&q=${tag}`)
    expect(cand.body.students.map((s: { id: string }) => s.id).sort()).toEqual([ids.s2, ids.s3].sort())
    expect((await call('students/search', 'GET', undefined, `?q=${tag}&group_id=${ids.gB}`)).status).toBe(404)
    as(ids.aB, 'university_admin', ids.B)
    expect((await call('roster/candidates', 'GET', undefined, `?group_id=${ids.gA}&q=${tag}`)).status).toBe(404)
  }, 90_000)

  it('course enrolment: own course, own institution\'s student; removal by the owner only', async () => {
    as(ids.tA, 'teacher', ids.A)
    expect((await call('course-enrollments', 'POST', { course_id: ids.course, student_id: ids.sB })).status).toBe(404)
    expect((await call('course-enrollments', 'POST', { course_id: ids.course, student_id: ids.s2 })).status).toBe(201)
    as(ids.tA2, 'teacher', ids.A)
    expect((await call('course-enrollments', 'DELETE', { course_id: ids.course, student_id: ids.s2 })).status).toBe(403)
    as(ids.aB, 'university_admin', ids.B)
    expect((await call('course-enrollments', 'POST', { course_id: ids.course, student_id: ids.sB })).status).toBe(404)
    as(ids.tA, 'teacher', ids.A)
    expect((await call('course-enrollments', 'DELETE', { course_id: ids.course, student_id: ids.s2 })).body).toEqual({ ok: true })
    const rows = await owner`select student_id from public.course_enrollments where course_id = ${ids.course}`
    expect(rows.map(r => r.student_id)).toEqual([ids.s1])
  }, 90_000)
})
