// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import postgres from 'postgres'

// Lessons, courses, groups, the academic structure, teacher search and group
// transfers end to end on the Neon trial, with two institutions. Real routes,
// SQL layer, RLS and database functions; only "who is signed in" comes from
// the test. Every cross-teacher and cross-institution attempt must be
// refused and change nothing. Runs with `npm run test:neon`.

type Who = { sub: string; role: string; tenant_id: string | null }
const who = vi.hoisted(() => ({ ctx: null as null | Who }))
vi.mock('@/lib/auth/current', async () => ({
  ...(await vi.importActual<object>('@/lib/auth/current')),
  currentCtx: async () => (who.ctx ? { ...who.ctx, email: null, is_active: true, must_change_password: false } : null),
}))
vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: async () => ({ allowed: true, remaining: 1, resetAt: 0 }) }))

const READY = !!(process.env.NEON_GATEWAY_DATABASE_URL && process.env.NEON_DATABASE_URL)

describe.skipIf(!READY)('lessons, courses, groups and structure on the trial', () => {
  const owner = postgres(process.env.NEON_DATABASE_URL ?? 'postgres://unused', { max: 1, prepare: false, onnotice: () => {} })
  const tag = `ts${Date.now()}`
  const code = () => Math.random().toString(36).slice(2, 7).toUpperCase().replace(/[^A-Z0-9]/g, 'X').padEnd(5, 'X')
  const ids = { A: '', B: '', aA: '', aB: '', tA: '', tA2: '', tB: '', sA: '', gA: '', gA2: '', gB: '', lesson: '', course: '', unit: '', term: '' }

  async function person(role: string, tenant: string, name = role) {
    const [u] = await owner`insert into ba."user" (name, email, "emailVerified") values (${role}, ${role + Math.random().toString(36).slice(2, 7) + tag + '@ts-test.test'}, true) returning id`
    await owner`update public.users set role = ${role}, tenant_id = ${tenant}, full_name = ${name + ' ' + tag} where id = ${u.id}`
    return u.id as string
  }
  const as = (sub: string, role: string, tenant: string) => { who.ctx = { sub, role, tenant_id: tenant } }
  const routes: Record<string, () => Promise<unknown>> = {
    lessons: () => import('@/app/api/lessons/route'),
    courses: () => import('@/app/api/courses/route'),
    'courses/create-full': () => import('@/app/api/courses/create-full/route'),
    groups: () => import('@/app/api/groups/route'),
    'academic/units': () => import('@/app/api/academic/units/route'),
    'academic/terms': () => import('@/app/api/academic/terms/route'),
    'teachers/search': () => import('@/app/api/teachers/search/route'),
    'group-transfers': () => import('@/app/api/group-transfers/route'),
  }
  const call = async (path: string, method: string, body?: unknown, qs = '') => {
    const mod = (await routes[path]()) as Record<string, (r: Request) => Promise<Response>>
    const res = await mod[method](new Request(`http://x/api/${path}${qs}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }))
    return { status: res.status, body: await res.json().catch(() => null) }
  }

  beforeAll(async () => {
    ids.A = (await owner`insert into public.tenants (name, slug, code, structure_mode) values ('SA', ${tag + 'a'}, ${code()}, 'academic') returning id`)[0].id
    ids.B = (await owner`insert into public.tenants (name, slug, code, structure_mode) values ('SB', ${tag + 'b'}, ${code()}, 'academic') returning id`)[0].id
    ids.aA = await person('university_admin', ids.A)
    ids.aB = await person('university_admin', ids.B)
    ids.tA = await person('teacher', ids.A, 'Sara')
    ids.tA2 = await person('teacher', ids.A, 'Omar')
    ids.tB = await person('teacher', ids.B, 'Sara')
    ids.sA = await person('student', ids.A)
    await owner`update public.users set can_create_courses = true where id = ${ids.tA}`
    ids.gB = (await owner`insert into public.groups (tenant_id, teacher_id, name) values (${ids.B}, ${ids.tB}, 'GB') returning id`)[0].id
  }, 120_000)
  afterAll(async () => {
    await owner`delete from public.lessons where tenant_id in (${ids.A}, ${ids.B})`
    await owner`delete from public.unit_items where tenant_id in (${ids.A}, ${ids.B})`
    await owner`delete from public.course_units where tenant_id in (${ids.A}, ${ids.B})`
    await owner`delete from public.courses where tenant_id in (${ids.A}, ${ids.B})`
    await owner`delete from public.groups where tenant_id in (${ids.A}, ${ids.B})`
    await owner`delete from public.academic_units where tenant_id in (${ids.A}, ${ids.B})`
    await owner`delete from public.academic_terms where tenant_id in (${ids.A}, ${ids.B})`
    await owner`delete from ba."user" where email like ${'%' + tag + '%'}`
    await owner`delete from public.tenants where id in (${ids.A}, ${ids.B})`.catch(() => {})
    await owner.end()
  }, 90_000)

  it('groups: an admin creates for their own teacher; another institution\'s teacher is refused', async () => {
    as(ids.aA, 'university_admin', ids.A)
    expect((await call('groups', 'POST', { name: 'X', teacher_id: ids.tB })).status).toBe(400)
    const ok = await call('groups', 'POST', { name: 'GA', teacher_id: ids.tA, max_students: 30 })
    expect(ok.status).toBe(201)
    expect(ok.body).toMatchObject({ name: 'GA', teacher_id: ids.tA, max_students: 30, group_students: [{ count: 0 }] })
    ids.gA = ok.body.id
    as(ids.tA2, 'teacher', ids.A)
    ids.gA2 = (await call('groups', 'POST', { name: 'GA2' })).body.id
    expect((await call('groups', 'PATCH', { id: ids.gA, name: 'Hijacked' })).status).toBe(403)
    as(ids.aB, 'university_admin', ids.B)
    expect((await call('groups', 'PATCH', { id: ids.gA, name: 'Hijacked' })).status).toBe(404)
    expect((await call('groups', 'DELETE', { id: ids.gA })).status).toBe(404)
    const [g] = await owner`select name from public.groups where id = ${ids.gA}`
    expect(g.name).toBe('GA')
  }, 90_000)

  it('teacher search: the caller\'s own institution only', async () => {
    as(ids.aA, 'university_admin', ids.A)
    const res = await call('teachers/search', 'GET', undefined, '?for=groups&q=Sara')
    expect(res.body.teachers.map((t: { id: string }) => t.id)).toEqual([ids.tA])
  }, 90_000)

  it('lessons: in the own group only; a colleague cannot edit or delete', async () => {
    as(ids.tA, 'teacher', ids.A)
    expect((await call('lessons', 'POST', { title: 'L', group_id: ids.gA2 })).status).toBe(403)
    expect((await call('lessons', 'POST', { title: 'L', group_id: ids.gB })).status).toBe(404)
    const ok = await call('lessons', 'POST', { title: 'Lesson 1', content: 'Hello', group_id: ids.gA })
    expect(ok.status).toBe(201)
    expect(ok.body.groups).toEqual({ name: 'GA' })
    ids.lesson = ok.body.id
    as(ids.tA2, 'teacher', ids.A)
    expect((await call('lessons', 'PATCH', { id: ids.lesson, title: 'X' })).status).toBe(403)
    expect((await call('lessons', 'DELETE', { id: ids.lesson })).status).toBe(403)
    as(ids.tA, 'teacher', ids.A)
    expect((await call('lessons', 'PATCH', { id: ids.lesson, is_published: true })).body).toMatchObject({ title: 'Lesson 1', is_published: true })
    expect((await call('lessons', 'DELETE', { id: ids.lesson })).body).toMatchObject({ ok: true, mode: 'archive' })
  }, 90_000)

  it('courses: a teacher allowed to create builds a whole course in one go; another institution cannot touch it', async () => {
    as(ids.tA2, 'teacher', ids.A)
    expect((await call('courses/create-full', 'POST', { course: { title: 'X', units: [{ name: 'U', order: 1, lessons: [] }] } })).status).toBe(403)
    as(ids.tA, 'teacher', ids.A)
    const full = await call('courses/create-full', 'POST', { course: {
      title: 'Arabic 101', description: '', language: 'ar', has_levels: false,
      units: [{ name: 'Unit 1', order: 1, lessons: [{ title: 'A', order: 1 }, { title: 'B', order: 2 }] }, { name: 'Unit 2', order: 2, lessons: [] }],
    } })
    expect(full.status).toBe(201)
    ids.course = full.body.id
    const [n] = await owner`select (select count(*) from public.course_units where course_id = ${ids.course})::int units,
                                   (select count(*) from public.unit_items where course_id = ${ids.course})::int items`
    expect(n).toEqual({ units: 2, items: 2 })
    as(ids.aB, 'university_admin', ids.B)
    expect((await call('courses', 'PATCH', { id: ids.course, title: 'Hijacked' })).status).toBe(403)
    expect((await call('courses', 'DELETE', { id: ids.course })).status).toBe(403)
    as(ids.aA, 'university_admin', ids.A)
    expect((await call('courses', 'PATCH', { id: ids.course, teacher_id: ids.tB })).status).toBe(400)
    expect((await call('courses', 'PATCH', { id: ids.course, teacher_id: ids.tA2 })).body).toMatchObject({ teacher_id: ids.tA2 })
    expect((await call('courses', 'POST', { title: 'Staff course', teacher_id: ids.tA })).body).toMatchObject({ teacher_id: ids.tA, course_levels: [{ count: 0 }] })
  }, 90_000)

  it('academic structure: units and terms of the own institution; another institution does not find them', async () => {
    as(ids.aA, 'university_admin', ids.A)
    const unit = await call('academic/units', 'POST', { name: 'Faculty of Arts' })
    expect(unit.status).toBe(201)
    ids.unit = unit.body.unit.id
    const child = await call('academic/units', 'POST', { name: 'Languages', parent_id: ids.unit })
    expect(child.body.unit).toMatchObject({ level: 2, parent_id: ids.unit })
    expect((await call('academic/units', 'POST', { name: 'Too deep', parent_id: child.body.unit.id })).status).toBe(400)
    const term = await call('academic/terms', 'POST', { name: 'Fall', starts_on: '2026-09-01', ends_on: '2027-01-15', is_current: true })
    ids.term = term.body.term.id
    const spring = await call('academic/terms', 'POST', { name: 'Spring', starts_on: '2027-02-01', ends_on: '2027-06-15', is_current: true })
    expect(spring.status).toBe(201)
    const current = await owner`select name from public.academic_terms where tenant_id = ${ids.A} and is_current`
    expect(current.map(r => r.name)).toEqual(['Spring'])
    expect((await call('groups', 'PATCH', { id: ids.gA, academic_unit_id: ids.unit, term_id: ids.term })).body).toMatchObject({ academic_unit_id: ids.unit, term_id: ids.term })

    as(ids.aB, 'university_admin', ids.B)
    expect((await call('academic/units', 'PATCH', { id: ids.unit, name: 'Hijacked' })).status).toBe(404)
    expect((await call('academic/terms', 'DELETE', { id: ids.term })).status).toBe(404)
    expect((await call('academic/units', 'POST', { name: 'X', parent_id: ids.unit })).status).toBe(404)
    expect((await call('groups', 'PATCH', { id: ids.gB, academic_unit_id: ids.unit })).status).toBe(400)

    as(ids.aA, 'university_admin', ids.A)
    expect((await call('academic/units', 'DELETE', { id: ids.unit })).body).toEqual({ success: true })
    const [u] = await owner`select count(*)::int n from public.academic_units where tenant_id = ${ids.A} and deleted_at is null`
    expect(u.n).toBe(0)
  }, 120_000)

  it('group transfer: inside the institution; another institution\'s group is refused', async () => {
    await owner`insert into public.group_students (group_id, student_id) values (${ids.gA}, ${ids.sA})`
    as(ids.aA, 'university_admin', ids.A)
    expect((await call('group-transfers', 'POST', { student_id: ids.sA, from_group_id: ids.gA, to_group_id: ids.gB, reason: 'Schedule' })).status).toBe(404)
    const ok = await call('group-transfers', 'POST', { student_id: ids.sA, from_group_id: ids.gA, to_group_id: ids.gA2, reason: 'Schedule' })
    expect(ok.status).toBe(201)
    const rows = await owner`select group_id from public.group_students where student_id = ${ids.sA}`
    expect(rows.map(r => r.group_id)).toEqual([ids.gA2])
  }, 90_000)
})
