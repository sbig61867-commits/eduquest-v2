// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import postgres from 'postgres'

// Invitations end to end on the Neon trial, with two institutions: who may
// invite whom, public-link rules, seat caps, group invitations, duplicate
// addresses, the list each role sees, and revoking. No email is sent (the
// sender is a stand-in). Only "who is signed in" comes from the test.
// Runs with `npm run test:neon`.

type Who = { sub: string; role: string; tenant_id: string | null }
const who = vi.hoisted(() => ({ ctx: null as null | Who }))
const mail = vi.hoisted(() => ({ sent: [] as string[] }))
vi.mock('@/lib/auth/current', async () => ({
  ...(await vi.importActual<object>('@/lib/auth/current')),
  currentCtx: async () => (who.ctx ? { ...who.ctx, email: null, is_active: true, must_change_password: false } : null),
}))
vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: async () => ({ allowed: true, remaining: 1, resetAt: 0 }) }))
vi.mock('next-intl/server', () => ({ getLocale: async () => 'en' }))
vi.mock('@/lib/email', () => ({ sendInvitationEmail: async (m: { to: string }) => { mail.sent.push(m.to) } }))

const READY = !!(process.env.NEON_GATEWAY_DATABASE_URL && process.env.NEON_DATABASE_URL)

describe.skipIf(!READY)('invitations on the trial', () => {
  const owner = postgres(process.env.NEON_DATABASE_URL ?? 'postgres://unused', { max: 1, prepare: false, onnotice: () => {} })
  const tag = `iv${Date.now()}`
  const code = () => Math.random().toString(36).slice(2, 7).toUpperCase().replace(/[^A-Z0-9]/g, 'X').padEnd(5, 'X')
  const ids = { A: '', B: '', aA: '', aB: '', tA: '', tA2: '', gA: '', gA2: '', gB: '', inv: '' }

  async function person(role: string, tenant: string) {
    const [u] = await owner`insert into ba."user" (name, email, "emailVerified") values (${role}, ${role + Math.random().toString(36).slice(2, 7) + tag + '@iv-test.test'}, true) returning id`
    await owner`update public.users set role = ${role}, tenant_id = ${tenant} where id = ${u.id}`
    return u.id as string
  }
  const as = (sub: string, role: string, tenant: string) => { who.ctx = { sub, role, tenant_id: tenant } }
  const list = () => import('@/app/api/invitations/route')
  const one = () => import('@/app/api/invitations/[id]/route')
  const post = async (body: unknown) => {
    const res = await (await list()).POST(new Request('http://x/api/invitations', { method: 'POST', body: JSON.stringify(body) }))
    return { status: res.status, body: await res.json() }
  }
  const revoke = async (id: string) => {
    const res = await (await one()).PATCH(new Request(`http://x/api/invitations/${id}`, { method: 'PATCH' }), { params: Promise.resolve({ id }) })
    return { status: res.status, body: await res.json() }
  }
  const email = (s: string) => `${s}.${tag}@iv-invitee.test`

  beforeAll(async () => {
    ids.A = (await owner`insert into public.tenants (name, slug, code, teacher_limit, has_center) values ('IA', ${tag + 'a'}, ${code()}, 1, false) returning id`)[0].id
    ids.B = (await owner`insert into public.tenants (name, slug, code) values ('IB', ${tag + 'b'}, ${code()}) returning id`)[0].id
    ids.aA = await person('university_admin', ids.A)
    ids.aB = await person('university_admin', ids.B)
    ids.tA = await person('teacher', ids.A)          // institution A: one teacher seat, now full
    ids.gA = (await owner`insert into public.groups (tenant_id, teacher_id, name) values (${ids.A}, ${ids.tA}, 'GA') returning id`)[0].id
    ids.gB = (await owner`insert into public.groups (tenant_id, teacher_id, name) values (${ids.B}, ${await person('teacher', ids.B)}, 'GB') returning id`)[0].id
  }, 120_000)
  afterAll(async () => {
    await owner`delete from public.invitations where tenant_id in (${ids.A}, ${ids.B})`
    await owner`delete from public.groups where tenant_id in (${ids.A}, ${ids.B})`
    await owner`delete from ba."user" where email like ${'%' + tag + '%'}`
    await owner`delete from public.tenants where id in (${ids.A}, ${ids.B})`
    await owner.end()
  }, 90_000)

  it('an admin invites a student by email to the institution\'s own group; the email goes out', async () => {
    as(ids.aA, 'university_admin', ids.A)
    const ok = await post({ role: 'student', email: email('s1'), group_id: ids.gA })
    expect(ok.status).toBe(201)
    expect(ok.body.invitation).toMatchObject({ role: 'student', tenant_id: ids.A, group_name_snapshot: 'GA', status: 'pending' })
    expect(ok.body.joinUrl).toContain(ok.body.invitation.token)
    expect(mail.sent).toEqual([email('s1')])
    ids.inv = ok.body.invitation.id
    expect((await post({ role: 'student', email: email('s1') })).status).toBe(409)
  }, 90_000)

  it('rules: another institution\'s group, a full teacher seat, staff by public link, a centre manager without a centre', async () => {
    as(ids.aA, 'university_admin', ids.A)
    expect((await post({ role: 'student', email: email('s2'), group_id: ids.gB })).status).toBe(400)
    const full = await post({ role: 'teacher', email: email('t9') })
    expect(full.status).toBe(403)
    expect(full.body.code).toBe('teacherLimit')
    expect((await post({ role: 'center_manager', is_public: true })).status).toBe(400)
    expect((await post({ role: 'center_manager', email: email('cm') })).status).toBe(409)
    expect((await post({ role: 'university_admin', email: email('ua') })).status).toBe(403)
  }, 90_000)

  it('a teacher invites only to their own group; a demoted admin cannot invite', async () => {
    as(ids.tA, 'teacher', ids.A)
    ids.gA2 = (await owner`insert into public.groups (tenant_id, teacher_id, name) values (${ids.A}, ${ids.aA}, 'Other') returning id`)[0].id
    expect((await post({ role: 'student', email: email('s3'), group_id: ids.gA2 })).status).toBe(403)
    expect((await post({ role: 'teacher', email: email('t3') })).status).toBe(403)
    expect((await post({ role: 'student', is_public: true, group_id: ids.gA, max_uses: 30 })).status).toBe(201)
    await owner`update public.users set role = 'student' where id = ${ids.aA}`
    as(ids.aA, 'university_admin', ids.A)
    const res = await post({ role: 'student', email: email('s4') })
    await owner`update public.users set role = 'university_admin' where id = ${ids.aA}`
    expect(res.status).toBe(403)
  }, 90_000)

  it('lists: the admin sees the institution\'s, a teacher only theirs, another institution none', async () => {
    as(ids.aA, 'university_admin', ids.A)
    const admin = await (await (await list()).GET()).json()
    expect(admin.invitations).toHaveLength(2)
    expect(admin.seats.teacher).toMatchObject({ limit: 1, used: 1, allowed: false })
    as(ids.tA, 'teacher', ids.A)
    const teacher = await (await (await list()).GET()).json()
    expect(teacher.invitations).toHaveLength(1)
    expect(teacher.invitations[0]).toMatchObject({ is_public: true, invited_by: ids.tA, groups: { name: 'GA' } })
    as(ids.aB, 'university_admin', ids.B)
    expect((await (await (await list()).GET()).json()).invitations).toHaveLength(0)
  }, 90_000)

  it('revoke: not by another institution\'s admin; by the institution\'s admin once', async () => {
    as(ids.aB, 'university_admin', ids.B)
    expect((await revoke(ids.inv)).status).toBe(404)
    as(ids.aA, 'university_admin', ids.A)
    expect((await revoke(ids.inv)).body).toEqual({ ok: true })
    expect((await revoke(ids.inv)).status).toBe(409)
    const [i] = await owner`select status from public.invitations where id = ${ids.inv}`
    expect(i.status).toBe('revoked')
  }, 90_000)
})
