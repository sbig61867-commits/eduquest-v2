// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import postgres from 'postgres'

// Centre mail end to end on the Neon trial, with two institutions: who may
// mail, recipient search and count, sending from the caller's own linked
// mailbox, the log, and unlinking. Gmail is NOT called: sending and token
// revocation are stand-ins, so no email leaves this test. Real routes, SQL
// layer and RLS; only "who is signed in" comes from the test.
// Runs with `npm run test:neon`.

type Who = { sub: string; role: string; tenant_id: string | null }
const who = vi.hoisted(() => ({ ctx: null as null | Who }))
const gmail = vi.hoisted(() => ({ sent: [] as string[] }))
vi.mock('@/lib/auth/current', async () => ({
  ...(await vi.importActual<object>('@/lib/auth/current')),
  currentCtx: async () => (who.ctx ? { ...who.ctx, email: null, is_active: true, must_change_password: false } : null),
}))
vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: async () => ({ allowed: true, remaining: 1, resetAt: 0 }) }))
vi.mock('@/lib/mail/google', async () => ({
  ...(await vi.importActual<object>('@/lib/mail/google')),
  sendGmail: async (_token: string, mime: string) => { gmail.sent.push(mime); return { ok: true } },
  buildMime: (m: { to: string }) => m.to,
  revokeToken: async () => {},
}))

const READY = !!(process.env.NEON_GATEWAY_DATABASE_URL && process.env.NEON_DATABASE_URL && process.env.MAIL_TOKEN_ENCRYPTION_KEY)

describe.skipIf(!READY)('centre mail on the trial', () => {
  const owner = postgres(process.env.NEON_DATABASE_URL ?? 'postgres://unused', { max: 1, prepare: false, onnotice: () => {} })
  const tag = `ml${Date.now()}`
  const code = () => Math.random().toString(36).slice(2, 7).toUpperCase().replace(/[^A-Z0-9]/g, 'X').padEnd(5, 'X')
  const ids = { A: '', B: '', cmA: '', aB: '', tA: '', sA: '', sA2: '', sB: '', gA: '', gB: '' }

  async function person(role: string, tenant: string) {
    const [u] = await owner`insert into ba."user" (name, email, "emailVerified") values (${role}, ${role + Math.random().toString(36).slice(2, 7) + tag + '@ml-test.test'}, true) returning id`
    await owner`update public.users set role = ${role}, tenant_id = ${tenant}, full_name = ${role + ' ' + tag} where id = ${u.id}`
    return u.id as string
  }
  const as = (sub: string, role: string, tenant: string) => { who.ctx = { sub, role, tenant_id: tenant } }
  const routes = {
    recipients: () => import('@/app/api/mail/recipients/route'),
    send: () => import('@/app/api/mail/send/route'),
    connection: () => import('@/app/api/mail/connection/route'),
  }
  const call = async (r: keyof typeof routes, method: string, body?: unknown, qs = '') => {
    const mod = (await routes[r]()) as unknown as Record<string, (req?: Request) => Promise<Response>>
    const res = await mod[method](new Request(`http://x/api/mail/${r}${qs}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }))
    return { status: res.status, body: await res.json().catch(() => null) }
  }

  beforeAll(async () => {
    ids.A = (await owner`insert into public.tenants (name, slug, code) values ('MA', ${tag + 'a'}, ${code()}) returning id`)[0].id
    ids.B = (await owner`insert into public.tenants (name, slug, code) values ('MB', ${tag + 'b'}, ${code()}) returning id`)[0].id
    ids.cmA = await person('center_manager', ids.A)
    await owner`update public.users set permissions = ${owner.json({ manage_students: true })} where id = ${ids.cmA}`
    ids.aB = await person('university_admin', ids.B)
    ids.tA = await person('teacher', ids.A)
    ids.sA = await person('student', ids.A)
    ids.sA2 = await person('student', ids.A)
    ids.sB = await person('student', ids.B)
    ids.gA = (await owner`insert into public.groups (tenant_id, teacher_id, name) values (${ids.A}, ${ids.tA}, 'GA') returning id`)[0].id
    ids.gB = (await owner`insert into public.groups (tenant_id, teacher_id, name) values (${ids.B}, ${await person('teacher', ids.B)}, 'GB') returning id`)[0].id
    await owner`insert into public.group_students (group_id, student_id) values (${ids.gA}, ${ids.sA}), (${ids.gA}, ${ids.sA2}), (${ids.gB}, ${ids.sB})`
    // a linked mailbox for the centre manager, with a still-valid access token (no refresh, no Google call)
    const { encrypt } = await import('@/lib/mail/crypto')
    await owner`insert into public.mail_connections (user_id, tenant_id, provider, email, refresh_token_enc, access_token_enc, access_expires_at, status)
      values (${ids.cmA}, ${ids.A}, 'google', 'centre@ml-test.test', ${encrypt('refresh')}, ${encrypt('access')}, now() + interval '1 hour', 'active')`
  }, 120_000)
  afterAll(async () => {
    await owner`delete from public.mail_messages where tenant_id in (${ids.A}, ${ids.B})`
    await owner`delete from public.mail_connections where tenant_id in (${ids.A}, ${ids.B})`
    await owner`delete from public.groups where tenant_id in (${ids.A}, ${ids.B})`
    await owner`delete from ba."user" where email like ${'%' + tag + '%'}`
    await owner`delete from public.tenants where id in (${ids.A}, ${ids.B})`
    await owner.end()
  }, 90_000)

  it('only staff who manage students may mail; a teacher is refused', async () => {
    as(ids.tA, 'teacher', ids.A)
    expect((await call('recipients', 'GET', undefined, '?q=student')).status).toBe(403)
    expect((await call('send', 'POST', { recipient_ids: [ids.sA], subject: 'S', body: 'B' })).status).toBe(403)
  }, 90_000)

  it('search and count stay inside the caller\'s institution', async () => {
    as(ids.cmA, 'center_manager', ids.A)
    const found = await call('recipients', 'GET', undefined, '?q=ml-test')
    expect(found.body.students.map((s: { id: string }) => s.id).sort()).toEqual([ids.sA, ids.sA2].sort())
    expect((await call('recipients', 'POST', { group_ids: [ids.gA] })).body).toEqual({ count: 2 })
    expect((await call('recipients', 'POST', { group_ids: [ids.gB] })).status).toBe(404)
  }, 90_000)

  it('send: only the institution\'s own active people receive it; every attempt is logged in that institution', async () => {
    as(ids.cmA, 'center_manager', ids.A)
    const res = await call('send', 'POST', { recipient_ids: [ids.sA, ids.sB], group_ids: [ids.gA], subject: 'Hello', body: 'Text' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ sent: 2, failed: 0, skipped: 1 })
    expect(gmail.sent.every(to => to.includes('ml-test.test'))).toBe(true)
    const log = await owner`select tenant_id, recipient_id from public.mail_messages where sender_id = ${ids.cmA}`
    expect(log.map(l => l.recipient_id).sort()).toEqual([ids.sA, ids.sA2].sort())
    expect(log.every(l => l.tenant_id === ids.A)).toBe(true)
  }, 90_000)

  it('the mailbox is the caller\'s own: another institution\'s admin has none and cannot unlink it', async () => {
    as(ids.aB, 'university_admin', ids.B)
    expect((await call('connection', 'GET')).body.connections).toEqual([])
    expect((await call('connection', 'DELETE', { provider: 'google' })).body).toEqual({ success: true })
    const [still] = await owner`select count(*)::int n from public.mail_connections where user_id = ${ids.cmA}`
    expect(still.n).toBe(1)
    as(ids.cmA, 'center_manager', ids.A)
    const mine = await call('connection', 'GET')
    expect(mine.body.connections).toEqual([expect.objectContaining({ provider: 'google', email: 'centre@ml-test.test', status: 'active' })])
    expect(JSON.stringify(mine.body)).not.toContain('token')
    expect((await call('connection', 'DELETE', { provider: 'google' })).body).toEqual({ success: true })
    const [gone] = await owner`select count(*)::int n from public.mail_connections where user_id = ${ids.cmA}`
    expect(gone.n).toBe(0)
  }, 90_000)
})
