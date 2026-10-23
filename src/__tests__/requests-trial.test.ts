// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import postgres from 'postgres'

// The staff request channel (teacher ↔ institution admin) and the header
// notifications end to end on the Neon trial, with two institutions. Real
// routes, SQL layer, RLS and the feed function; only "who is signed in" comes
// from the test. Runs with `npm run test:neon`.

type Who = { sub: string; role: string; tenant_id: string | null }
const who = vi.hoisted(() => ({ ctx: null as null | Who }))
vi.mock('@/lib/auth/current', async () => ({
  ...(await vi.importActual<object>('@/lib/auth/current')),
  currentCtx: async () => (who.ctx ? { ...who.ctx, email: null, is_active: true, must_change_password: false } : null),
}))
vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))
vi.mock('next-intl/server', () => ({ getTranslations: async () => (k: string) => k }))

const READY = !!(process.env.NEON_GATEWAY_DATABASE_URL && process.env.NEON_DATABASE_URL)

describe.skipIf(!READY)('staff requests and notifications on the trial', () => {
  const owner = postgres(process.env.NEON_DATABASE_URL ?? 'postgres://unused', { max: 1, prepare: false, onnotice: () => {} })
  const tag = `rq${Date.now()}`
  const code = () => Math.random().toString(36).slice(2, 7).toUpperCase().replace(/[^A-Z0-9]/g, 'X').padEnd(5, 'X')
  const ids = { A: '', B: '', aA: '', aB: '', tA: '', tA2: '', gA: '', gA2: '', req: '' }

  async function person(role: string, tenant: string) {
    const [u] = await owner`insert into ba."user" (name, email, "emailVerified") values (${role}, ${role + Math.random().toString(36).slice(2, 7) + tag + '@rq-test.test'}, true) returning id`
    await owner`update public.users set role = ${role}, tenant_id = ${tenant}, full_name = ${role + ' ' + tag} where id = ${u.id}`
    return u.id as string
  }
  const as = (sub: string, role: string, tenant: string) => { who.ctx = { sub, role, tenant_id: tenant } }
  const requests = () => import('@/app/api/requests/route')
  const messages = () => import('@/app/api/requests/messages/route')
  const send = async (mod: () => Promise<unknown>, method: string, body: unknown) => {
    const m = (await mod()) as Record<string, (r: Request) => Promise<Response>>
    const res = await m[method](new Request('http://x', { method, body: JSON.stringify(body) }))
    return { status: res.status, body: await res.json() }
  }

  beforeAll(async () => {
    ids.A = (await owner`insert into public.tenants (name, slug, code) values ('RA', ${tag + 'a'}, ${code()}) returning id`)[0].id
    ids.B = (await owner`insert into public.tenants (name, slug, code) values ('RB', ${tag + 'b'}, ${code()}) returning id`)[0].id
    ids.aA = await person('university_admin', ids.A)
    ids.aB = await person('university_admin', ids.B)
    ids.tA = await person('teacher', ids.A)
    ids.tA2 = await person('teacher', ids.A)
    ids.gA = (await owner`insert into public.groups (tenant_id, teacher_id, name) values (${ids.A}, ${ids.tA}, 'GA') returning id`)[0].id
    ids.gA2 = (await owner`insert into public.groups (tenant_id, teacher_id, name) values (${ids.A}, ${ids.tA2}, 'GA2') returning id`)[0].id
  }, 120_000)
  afterAll(async () => {
    await owner`delete from public.staff_requests where tenant_id in (${ids.A}, ${ids.B})`
    await owner`delete from public.groups where tenant_id in (${ids.A}, ${ids.B})`
    await owner`delete from ba."user" where email like ${'%' + tag + '%'}`
    await owner`delete from public.tenants where id in (${ids.A}, ${ids.B})`
    await owner.end()
  }, 90_000)

  it('a teacher writes to their own admin about their own group, with a first message', async () => {
    as(ids.tA, 'teacher', ids.A)
    expect((await send(requests, 'POST', { to_user_id: ids.aB, subject: 'S' })).status).toBe(404)
    expect((await send(requests, 'POST', { to_user_id: ids.tA2, subject: 'S' })).status).toBe(403)
    expect((await send(requests, 'POST', { to_user_id: ids.aA, subject: 'S', group_id: ids.gA2 })).status).toBe(403)
    const ok = await send(requests, 'POST', { to_user_id: ids.aA, subject: 'Grade sheet', type: 'grade_sheet', group_id: ids.gA, message: 'Please send it' })
    expect(ok.status).toBe(201)
    ids.req = ok.body.id
    const [m] = await owner`select count(*)::int n from public.request_messages where request_id = ${ids.req}`
    expect(m.n).toBe(1)
    const [n] = await owner`select count(*)::int n from public.staff_requests where tenant_id in (${ids.A}, ${ids.B})`
    expect(n.n).toBe(1)
  }, 90_000)

  it('the thread: participants write; a colleague and another institution cannot', async () => {
    as(ids.tA2, 'teacher', ids.A)
    expect((await send(messages, 'POST', { request_id: ids.req, body: 'Hi' })).status).toBe(403)
    as(ids.aB, 'university_admin', ids.B)
    expect((await send(messages, 'POST', { request_id: ids.req, body: 'Hi' })).status).toBe(404)
    as(ids.aA, 'university_admin', ids.A)
    const ok = await send(messages, 'POST', { request_id: ids.req, body: 'On it' })
    expect(ok.status).toBe(201)
    expect(ok.body).toMatchObject({ body: 'On it', sender_id: ids.aA })
  }, 90_000)

  it('the state machine: only the recipient accepts, only from pending; another institution does not find it', async () => {
    as(ids.tA, 'teacher', ids.A)
    expect((await send(requests, 'PATCH', { id: ids.req, status: 'accepted' })).status).toBe(403)
    as(ids.aB, 'university_admin', ids.B)
    expect((await send(requests, 'PATCH', { id: ids.req, status: 'accepted' })).status).toBe(404)
    as(ids.aA, 'university_admin', ids.A)
    expect((await send(requests, 'PATCH', { id: ids.req, status: 'completed' })).status).toBe(409)
    expect((await send(requests, 'PATCH', { id: ids.req, status: 'accepted' })).body).toEqual({ success: true, status: 'accepted' })
    expect((await send(requests, 'PATCH', { id: ids.req, status: 'rejected' })).status).toBe(409)
    as(ids.tA, 'teacher', ids.A)
    expect((await send(requests, 'PATCH', { id: ids.req, status: 'completed' })).body).toEqual({ success: true, status: 'completed' })
    const [r] = await owner`select status from public.staff_requests where id = ${ids.req}`
    expect(r.status).toBe('completed')
  }, 90_000)

  it('notifications: the admin\'s feed shows their institution\'s new people, not another institution\'s', async () => {
    as(ids.aA, 'university_admin', ids.A)
    const { GET } = await import('@/app/api/notifications/route')
    const { notifications } = await (await GET()).json() as { notifications: { id: string }[] }
    const shown = notifications.map(n => n.id)
    expect(shown).toContain(`user-${ids.tA}`)
    expect(shown.some(id => id.includes(ids.aB))).toBe(false)
  }, 90_000)
})
