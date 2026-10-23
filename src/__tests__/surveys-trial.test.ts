// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import postgres from 'postgres'

// The group pilot survey end to end on the Neon trial, with two institutions:
// open / close by the group's teacher, the student's pending survey and their
// one answer. Only "who is signed in" comes from the test.
// Runs with `npm run test:neon`.

type Who = { sub: string; role: string; tenant_id: string | null }
const who = vi.hoisted(() => ({ ctx: null as null | Who }))
vi.mock('@/lib/auth/current', async () => ({
  ...(await vi.importActual<object>('@/lib/auth/current')),
  currentCtx: async () => (who.ctx ? { ...who.ctx, email: null, is_active: true, must_change_password: false } : null),
}))
vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))

const READY = !!(process.env.NEON_GATEWAY_DATABASE_URL && process.env.NEON_DATABASE_URL)

describe.skipIf(!READY)('surveys on the trial', () => {
  const owner = postgres(process.env.NEON_DATABASE_URL ?? 'postgres://unused', { max: 1, prepare: false, onnotice: () => {} })
  const tag = `sv${Date.now()}`
  const code = () => Math.random().toString(36).slice(2, 7).toUpperCase().replace(/[^A-Z0-9]/g, 'X').padEnd(5, 'X')
  const ids = { A: '', B: '', tA: '', tA2: '', aB: '', s1: '', sOut: '', sB: '', gA: '', survey: '' }

  async function person(role: string, tenant: string) {
    const [u] = await owner`insert into ba."user" (name, email, "emailVerified") values (${role}, ${role + Math.random().toString(36).slice(2, 7) + tag + '@sv-test.test'}, true) returning id`
    await owner`update public.users set role = ${role}, tenant_id = ${tenant} where id = ${u.id}`
    return u.id as string
  }
  const as = (sub: string, role: string, tenant: string) => { who.ctx = { sub, role, tenant_id: tenant } }
  const surveys = () => import('@/app/api/surveys/route')
  const respond = () => import('@/app/api/surveys/respond/route')
  const send = async (mod: () => Promise<unknown>, method: string, body?: unknown, qs = '') => {
    const m = (await mod()) as Record<string, (r: Request) => Promise<Response>>
    const res = await m[method](new Request(`http://x/api/surveys${qs}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }))
    return { status: res.status, body: await res.json() }
  }
  const answer = { ease_rating: 5, prefer_platform: true, recommend: true, comment: 'Good' }

  beforeAll(async () => {
    ids.A = (await owner`insert into public.tenants (name, slug, code) values ('VA', ${tag + 'a'}, ${code()}) returning id`)[0].id
    ids.B = (await owner`insert into public.tenants (name, slug, code) values ('VB', ${tag + 'b'}, ${code()}) returning id`)[0].id
    ids.tA = await person('teacher', ids.A)
    ids.tA2 = await person('teacher', ids.A)
    ids.aB = await person('university_admin', ids.B)
    ids.s1 = await person('student', ids.A)
    ids.sOut = await person('student', ids.A)
    ids.sB = await person('student', ids.B)
    ids.gA = (await owner`insert into public.groups (tenant_id, teacher_id, name) values (${ids.A}, ${ids.tA}, 'GA') returning id`)[0].id
    await owner`insert into public.group_students (group_id, student_id) values (${ids.gA}, ${ids.s1})`
  }, 120_000)
  afterAll(async () => {
    await owner`delete from public.surveys where tenant_id in (${ids.A}, ${ids.B})`
    await owner`delete from public.groups where tenant_id in (${ids.A}, ${ids.B})`
    await owner`delete from ba."user" where email like ${'%' + tag + '%'}`
    await owner`delete from public.tenants where id in (${ids.A}, ${ids.B})`
    await owner.end()
  }, 90_000)

  it('the group\'s teacher opens the survey; a colleague and another institution cannot', async () => {
    as(ids.tA2, 'teacher', ids.A)
    expect((await send(surveys, 'POST', { group_id: ids.gA })).status).toBe(403)
    as(ids.aB, 'university_admin', ids.B)
    expect((await send(surveys, 'POST', { group_id: ids.gA })).status).toBe(404)
    as(ids.tA, 'teacher', ids.A)
    const ok = await send(surveys, 'POST', { group_id: ids.gA })
    expect(ok.status).toBe(201)
    ids.survey = ok.body.survey.id
    expect(ok.body.survey.is_open).toBe(true)
  }, 90_000)

  it('the member sees it and answers once; a non-member and another institution\'s student cannot', async () => {
    as(ids.s1, 'student', ids.A)
    expect((await send(respond, 'GET')).body.survey).toMatchObject({ id: ids.survey, groupName: 'GA' })
    expect((await send(respond, 'POST', { survey_id: ids.survey, ...answer })).status).toBe(201)
    expect((await send(respond, 'POST', { survey_id: ids.survey, ...answer })).status).toBe(409)
    expect((await send(respond, 'GET')).body.survey).toBeNull()
    as(ids.sOut, 'student', ids.A)
    expect((await send(respond, 'POST', { survey_id: ids.survey, ...answer })).status).toBe(403)
    as(ids.sB, 'student', ids.B)
    expect((await send(respond, 'POST', { survey_id: ids.survey, ...answer })).status).toBe(404)
  }, 90_000)

  it('the teacher sees the count and closes it; a closed survey takes no answers', async () => {
    as(ids.tA, 'teacher', ids.A)
    const view = await send(surveys, 'GET', undefined, `?group_id=${ids.gA}`)
    expect(view.body).toMatchObject({ responseCount: 1, memberCount: 1 })
    expect((await send(surveys, 'PATCH', { group_id: ids.gA, is_open: false })).body.survey.is_open).toBe(false)
    await owner`insert into public.group_students (group_id, student_id) values (${ids.gA}, ${ids.sOut})`
    as(ids.sOut, 'student', ids.A)
    expect((await send(respond, 'POST', { survey_id: ids.survey, ...answer })).status).toBe(404)
    as(ids.aB, 'university_admin', ids.B)
    expect((await send(surveys, 'GET', undefined, `?group_id=${ids.gA}`)).status).toBe(404)
  }, 90_000)
})
