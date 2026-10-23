// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import postgres from 'postgres'

// Group attendance end to end on the Neon trial, with two institutions. Real
// route, SQL layer and RLS; only "who is signed in" comes from the test.
// Runs with `npm run test:neon`.

type Who = { sub: string; role: string; tenant_id: string | null }
const who = vi.hoisted(() => ({ ctx: null as null | Who }))
vi.mock('@/lib/auth/current', async () => ({
  ...(await vi.importActual<object>('@/lib/auth/current')),
  currentCtx: async () => (who.ctx ? { ...who.ctx, email: null, is_active: true, must_change_password: false } : null),
}))
vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))

const READY = !!(process.env.NEON_GATEWAY_DATABASE_URL && process.env.NEON_DATABASE_URL)

describe.skipIf(!READY)('attendance on the trial', () => {
  const owner = postgres(process.env.NEON_DATABASE_URL ?? 'postgres://unused', { max: 1, prepare: false, onnotice: () => {} })
  const tag = `at${Date.now()}`
  const code = () => Math.random().toString(36).slice(2, 7).toUpperCase().replace(/[^A-Z0-9]/g, 'X').padEnd(5, 'X')
  const ids = { A: '', B: '', aA: '', aB: '', tA: '', tA2: '', s1: '', s2: '', sOut: '', gA: '', session: '' }
  const DAY = '2026-10-20'

  async function person(role: string, tenant: string, name = role) {
    const [u] = await owner`insert into ba."user" (name, email, "emailVerified") values (${role}, ${role + Math.random().toString(36).slice(2, 7) + tag + '@at-test.test'}, true) returning id`
    await owner`update public.users set role = ${role}, tenant_id = ${tenant}, full_name = ${name} where id = ${u.id}`
    return u.id as string
  }
  const as = (sub: string, role: string, tenant: string) => { who.ctx = { sub, role, tenant_id: tenant } }
  const route = () => import('@/app/api/attendance/route')
  const send = async (method: 'POST' | 'DELETE', body: unknown) => {
    const res = await (await route())[method](new Request('http://x', { method, body: JSON.stringify(body) }))
    return { status: res.status, body: await res.json() }
  }
  const get = async (qs: string) => {
    const res = await (await route()).GET(new Request(`http://x/api/attendance?${qs}`))
    return { status: res.status, body: await res.json() }
  }

  beforeAll(async () => {
    ids.A = (await owner`insert into public.tenants (name, slug, code) values ('AA', ${tag + 'a'}, ${code()}) returning id`)[0].id
    ids.B = (await owner`insert into public.tenants (name, slug, code) values ('AB', ${tag + 'b'}, ${code()}) returning id`)[0].id
    ids.aA = await person('university_admin', ids.A)
    ids.aB = await person('university_admin', ids.B)
    ids.tA = await person('teacher', ids.A)
    ids.tA2 = await person('teacher', ids.A)
    ids.s1 = await person('student', ids.A, 'Bassam')
    ids.s2 = await person('student', ids.A, 'Adel')
    ids.sOut = await person('student', ids.A, 'Outsider')
    ids.gA = (await owner`insert into public.groups (tenant_id, teacher_id, name) values (${ids.A}, ${ids.tA}, 'GA') returning id`)[0].id
    await owner`insert into public.group_students (group_id, student_id) values (${ids.gA}, ${ids.s1}), (${ids.gA}, ${ids.s2})`
  }, 120_000)
  afterAll(async () => {
    await owner`delete from public.attendance_sessions where tenant_id in (${ids.A}, ${ids.B})`
    await owner`delete from public.groups where tenant_id in (${ids.A}, ${ids.B})`
    await owner`delete from ba."user" where email like ${'%' + tag + '%'}`
    await owner`delete from public.tenants where id in (${ids.A}, ${ids.B})`
    await owner.end()
  }, 90_000)

  it('the group\'s teacher marks members only; marking again updates the same session', async () => {
    as(ids.tA, 'teacher', ids.A)
    const bad = await send('POST', { group_id: ids.gA, session_date: DAY, records: [{ student_id: ids.sOut, status: 'present' }] })
    expect(bad.status).toBe(400)
    const ok = await send('POST', { group_id: ids.gA, session_date: DAY, title: 'Lecture 1', records: [
      { student_id: ids.s1, status: 'present' }, { student_id: ids.s2, status: 'absent', note: 'sick' },
    ] })
    expect(ok.status).toBe(200)
    ids.session = ok.body.session_id
    const again = await send('POST', { group_id: ids.gA, session_date: DAY, records: [{ student_id: ids.s2, status: 'excused' }] })
    expect(again.body.session_id).toBe(ids.session)
    const rows = await owner`select student_id, status from public.attendance_records where session_id = ${ids.session} order by status`
    expect(rows.map(r => r.status)).toEqual(['excused', 'present'])
    const [n] = await owner`select count(*)::int n from public.attendance_sessions where group_id = ${ids.gA}`
    expect(n.n).toBe(1)
  }, 90_000)

  it('the day\'s sheet: roster sorted, records and recent counts — one read', async () => {
    as(ids.tA, 'teacher', ids.A)
    const res = await get(`group_id=${ids.gA}&date=${DAY}`)
    expect(res.status).toBe(200)
    expect(res.body.roster.map((u: { full_name: string }) => u.full_name)).toEqual(['Adel', 'Bassam'])
    expect(res.body.records[ids.s2]).toEqual({ status: 'excused', note: null })
    expect(res.body.recent[0]).toMatchObject({ id: ids.session, present: 1, excused: 1, absent: 0 })
  }, 90_000)

  it('a colleague and another institution see nothing and change nothing', async () => {
    as(ids.tA2, 'teacher', ids.A)
    expect((await get(`group_id=${ids.gA}&date=${DAY}`)).status).toBe(403)
    expect((await send('POST', { group_id: ids.gA, session_date: DAY, records: [{ student_id: ids.s1, status: 'absent' }] })).status).toBe(403)
    expect((await send('DELETE', { session_id: ids.session })).status).toBe(403)
    as(ids.aB, 'university_admin', ids.B)
    expect((await get(`group_id=${ids.gA}&date=${DAY}`)).status).toBe(404)
    expect((await send('DELETE', { session_id: ids.session })).status).toBe(404)
    const [r] = await owner`select status from public.attendance_records where session_id = ${ids.session} and student_id = ${ids.s1}`
    expect(r.status).toBe('present')
  }, 90_000)

  it('the institution\'s admin (manage_attendance) reads and deletes the session', async () => {
    as(ids.aA, 'university_admin', ids.A)
    expect((await get(`group_id=${ids.gA}&date=${DAY}`)).status).toBe(200)
    expect((await send('DELETE', { session_id: ids.session })).body).toEqual({ ok: true })
    const [n] = await owner`select count(*)::int n from public.attendance_sessions where group_id = ${ids.gA}`
    expect(n.n).toBe(0)
  }, 90_000)
})
