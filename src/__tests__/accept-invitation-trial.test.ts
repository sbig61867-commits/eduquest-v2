// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import postgres from 'postgres'

// /api/auth/accept-invitation end to end on the Neon trial: real SQL layer,
// real Better Auth, real accept_invitation(). The route has no session — the
// invitation token is the credential. Runs with `npm run test:neon`.

vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))

const READY = !!(process.env.NEON_AUTH_DATABASE_URL && process.env.BETTER_AUTH_SECRET && process.env.NEON_GATEWAY_DATABASE_URL && process.env.NEON_DATABASE_URL)

describe.skipIf(!READY)('accept-invitation on the trial', () => {
  const owner = postgres(process.env.NEON_DATABASE_URL ?? 'postgres://unused', { max: 1, prepare: false, onnotice: () => {} })
  const tag = `ai${Date.now()}`
  const code = () => Math.random().toString(36).slice(2, 7).toUpperCase().replace(/[^A-Z0-9]/g, 'X').padEnd(5, 'X')
  const ids = { A: '', teacher: '', group: '' }
  const parts = { first: 'سارة', father: 'خالد', grandfather: 'يوسف', family: 'النجار' }
  let n = 0
  // each call comes from its own address, so the per-IP limit never interferes
  const accept = async (body: Record<string, unknown>) => {
    const { POST } = await import('@/app/api/auth/accept-invitation/route')
    const res = await POST(new Request('http://x/api/auth/accept-invitation', {
      method: 'POST', headers: { 'cf-connecting-ip': `198.18.${Math.floor(Math.random() * 250)}.${++n}` }, body: JSON.stringify(body),
    }))
    return { status: res.status, data: await res.json() }
  }
  const invite = async (fields: Record<string, unknown>) => {
    const [i] = await owner`insert into public.invitations ${owner({ role: 'student', tenant_id: ids.A, expires_at: new Date(Date.now() + 86_400_000), ...fields })} returning token`
    return i.token as string
  }
  const mail = (k: string) => `${k}-${tag}@ai-test.test`

  beforeAll(async () => {
    ids.A = (await owner`insert into public.tenants (name, slug, code) values ('IA', ${tag}, ${code()}) returning id`)[0].id
    const [t] = await owner`insert into ba."user" (name, email, "emailVerified") values ('t', ${mail('teacher')}, true) returning id`
    ids.teacher = t.id
    await owner`update public.users set role = 'teacher', tenant_id = ${ids.A} where id = ${t.id}`
    ids.group = (await owner`insert into public.groups (tenant_id, teacher_id, name) values (${ids.A}, ${t.id}, 'g') returning id`)[0].id
  }, 60_000)
  afterAll(async () => {
    await owner`delete from public.invitations where tenant_id = ${ids.A}`
    await owner`delete from public.groups where tenant_id = ${ids.A}`
    await owner`delete from ba."user" where email like ${'%' + tag + '%'}`
    await owner`delete from public.tenants where id = ${ids.A}`
    await owner.end()
  }, 60_000)

  it('a public group link: the student joins the institution and the group, with the private name', async () => {
    const token = await invite({ is_public: true, max_uses: 5, group_id: ids.group })
    const { status } = await accept({ token, email: mail('s1'), password: 'Secret-123', nameParts: parts })
    expect(status).toBe(200)
    const [u] = await owner`select u.id, u.role, u.tenant_id, u.full_name, u.must_change_password from public.users u join ba."user" b on b.id = u.id where b.email = ${mail('s1')}`
    expect(u).toMatchObject({ role: 'student', tenant_id: ids.A, full_name: 'سارة النجار', must_change_password: false })
    const [g] = await owner`select count(*)::int n from public.group_students where group_id = ${ids.group} and student_id = ${u.id}`
    expect(g.n).toBe(1)
    const [i] = await owner`select use_count from public.invitations where token = ${token}`
    expect(i.use_count).toBe(1)
  }, 90_000)

  it('a private invitation refuses another email and creates nothing', async () => {
    const token = await invite({ is_public: false, email: mail('invitee') })
    const { status, data } = await accept({ token, email: mail('intruder'), password: 'Secret-123', nameParts: parts })
    expect(status).toBe(403)
    expect(data.code).toBe('invitationEmailMismatch')
    const [c] = await owner`select count(*)::int n from ba."user" where email = ${mail('intruder')}`
    expect(c.n).toBe(0)
  }, 60_000)

  it('the invitee of a private invitation joins (email checked against the sign-in account)', async () => {
    const token = await invite({ is_public: false, email: mail('invitee2') })
    const { status } = await accept({ token, email: mail('invitee2'), password: 'Secret-123', nameParts: parts })
    expect(status).toBe(200)
    const [i] = await owner`select status from public.invitations where token = ${token}`
    expect(i.status).toBe('accepted')
  }, 90_000)

  it('a used-up link is refused', async () => {
    const token = await invite({ is_public: true, max_uses: 1, use_count: 1 })
    const { status } = await accept({ token, email: mail('late'), password: 'Secret-123', nameParts: parts })
    expect(status).toBe(410)
  }, 60_000)

  it('an unknown token is refused', async () => {
    const { status, data } = await accept({ token: 'no-such-token', email: mail('x'), password: 'Secret-123', nameParts: parts })
    expect(status).toBe(410)
    expect(data.code).toBe('invitationInvalid')
  }, 60_000)

  it('a suspended institution admits no one', async () => {
    const token = await invite({ is_public: true, max_uses: 5 })
    await owner`update public.tenants set is_active = false where id = ${ids.A}`
    const { status } = await accept({ token, email: mail('susp'), password: 'Secret-123', nameParts: parts })
    await owner`update public.tenants set is_active = true where id = ${ids.A}`
    expect(status).toBe(410)
  }, 60_000)
})
