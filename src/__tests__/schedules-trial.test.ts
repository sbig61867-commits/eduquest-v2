// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import postgres from 'postgres'

// Weekly timetables and their slots end to end on the Neon trial, with two
// institutions. Real routes, SQL layer and RLS; only "who is signed in" comes
// from the test. Runs with `npm run test:neon`.

type Who = { sub: string; role: string; tenant_id: string | null }
const who = vi.hoisted(() => ({ ctx: null as null | Who }))
vi.mock('@/lib/auth/current', async () => ({
  ...(await vi.importActual<object>('@/lib/auth/current')),
  currentCtx: async () => (who.ctx ? { ...who.ctx, email: null, is_active: true, must_change_password: false } : null),
}))
vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))

const READY = !!(process.env.NEON_GATEWAY_DATABASE_URL && process.env.NEON_DATABASE_URL)

describe.skipIf(!READY)('schedules on the trial', () => {
  const owner = postgres(process.env.NEON_DATABASE_URL ?? 'postgres://unused', { max: 1, prepare: false, onnotice: () => {} })
  const tag = `sc${Date.now()}`
  const code = () => Math.random().toString(36).slice(2, 7).toUpperCase().replace(/[^A-Z0-9]/g, 'X').padEnd(5, 'X')
  const ids = { A: '', B: '', aA: '', aB: '', tA: '', tB: '', gA: '', gB: '', sched: '', slot: '' }

  async function person(role: string, tenant: string) {
    const [u] = await owner`insert into ba."user" (name, email, "emailVerified") values (${role}, ${role + Math.random().toString(36).slice(2, 7) + tag + '@sc-test.test'}, true) returning id`
    await owner`update public.users set role = ${role}, tenant_id = ${tenant} where id = ${u.id}`
    return u.id as string
  }
  const as = (sub: string, role: string, tenant: string) => { who.ctx = { sub, role, tenant_id: tenant } }
  const schedules = () => import('@/app/api/schedules/route')
  const slots = () => import('@/app/api/schedules/slots/route')
  const send = async (mod: () => Promise<unknown>, method: string, body: unknown) => {
    const m = (await mod()) as Record<string, (r: Request) => Promise<Response>>
    const res = await m[method](new Request('http://x', { method, body: JSON.stringify(body) }))
    return { status: res.status, body: await res.json() }
  }

  beforeAll(async () => {
    ids.A = (await owner`insert into public.tenants (name, slug, code) values ('CA', ${tag + 'a'}, ${code()}) returning id`)[0].id
    ids.B = (await owner`insert into public.tenants (name, slug, code) values ('CB', ${tag + 'b'}, ${code()}) returning id`)[0].id
    ids.aA = await person('university_admin', ids.A)
    ids.aB = await person('university_admin', ids.B)
    ids.tA = await person('teacher', ids.A)
    ids.tB = await person('teacher', ids.B)
    ids.gA = (await owner`insert into public.groups (tenant_id, teacher_id, name) values (${ids.A}, ${ids.tA}, 'GA') returning id`)[0].id
    ids.gB = (await owner`insert into public.groups (tenant_id, teacher_id, name) values (${ids.B}, ${ids.tB}, 'GB') returning id`)[0].id
  }, 120_000)
  afterAll(async () => {
    await owner`delete from public.schedules where tenant_id in (${ids.A}, ${ids.B})`
    await owner`delete from public.groups where tenant_id in (${ids.A}, ${ids.B})`
    await owner`delete from ba."user" where email like ${'%' + tag + '%'}`
    await owner`delete from public.tenants where id in (${ids.A}, ${ids.B})`
    await owner.end()
  }, 90_000)

  it('create: for the institution\'s own group, once; another institution\'s group or teacher is not found; a teacher cannot author', async () => {
    as(ids.tA, 'teacher', ids.A)
    expect((await send(schedules, 'POST', { kind: 'group', target_id: ids.gA, title: 'T' })).status).toBe(403)
    as(ids.aA, 'university_admin', ids.A)
    expect((await send(schedules, 'POST', { kind: 'group', target_id: ids.gB, title: 'T' })).status).toBe(404)
    expect((await send(schedules, 'POST', { kind: 'teacher', target_id: ids.tB, title: 'T' })).status).toBe(404)
    const ok = await send(schedules, 'POST', { kind: 'group', target_id: ids.gA, title: 'Week' })
    expect(ok.status).toBe(201)
    ids.sched = ok.body.id
    expect((await send(schedules, 'POST', { kind: 'group', target_id: ids.gA, title: 'Again' })).status).toBe(409)
  }, 90_000)

  it('slots: added with the institution\'s own teacher only; the end stays after the start', async () => {
    as(ids.aA, 'university_admin', ids.A)
    const slot = { schedule_id: ids.sched, title: 'Math', day_of_week: 1, start_time: '09:00', end_time: '10:00' }
    expect((await send(slots, 'POST', { ...slot, teacher_id: ids.tB })).status).toBe(400)
    const ok = await send(slots, 'POST', { ...slot, teacher_id: ids.tA, location: 'Room 1' })
    expect(ok.status).toBe(201)
    ids.slot = ok.body.id
    expect((await send(slots, 'PATCH', { id: ids.slot, start_time: '11:00' })).status).toBe(400)
    expect((await send(slots, 'PATCH', { id: ids.slot, end_time: '10:30', note: 'Bring books' })).body).toEqual({ success: true })
    const [s] = await owner`select end_time::text, note, location from public.schedule_slots where id = ${ids.slot}`
    expect(s).toEqual({ end_time: '10:30:00', note: 'Bring books', location: 'Room 1' })
  }, 90_000)

  it('another institution\'s admin does not find the timetable or its slots', async () => {
    as(ids.aB, 'university_admin', ids.B)
    expect((await send(schedules, 'PATCH', { id: ids.sched, title: 'Hijacked' })).status).toBe(404)
    expect((await send(slots, 'POST', { schedule_id: ids.sched, title: 'X', day_of_week: 2, start_time: '08:00', end_time: '09:00' })).status).toBe(404)
    expect((await send(slots, 'DELETE', { id: ids.slot })).status).toBe(404)
    expect((await send(schedules, 'DELETE', { id: ids.sched })).status).toBe(404)
    const [n] = await owner`select count(*)::int n from public.schedule_slots where schedule_id = ${ids.sched}`
    expect(n.n).toBe(1)
  }, 90_000)

  it('the author publishes and deletes (slots go with it)', async () => {
    as(ids.aA, 'university_admin', ids.A)
    expect((await send(schedules, 'PATCH', { id: ids.sched, is_published: true })).body).toEqual({ success: true })
    expect((await send(schedules, 'DELETE', { id: ids.sched })).body).toEqual({ success: true })
    const [n] = await owner`select count(*)::int n from public.schedule_slots where schedule_id = ${ids.sched}`
    expect(n.n).toBe(0)
  }, 90_000)
})
