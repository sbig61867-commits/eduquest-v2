// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import postgres from 'postgres'

// The daily cleanup on the Neon trial (step 12): run through the real route as
// app_system, it deletes ONLY pending invitations expired more than 30 days
// ago — not a recent expiry, not an accepted one, not a live one. Runs with
// `npm run test:neon`.

const READY = !!(process.env.NEON_GATEWAY_DATABASE_URL && process.env.NEON_DATABASE_URL)
vi.setConfig({ testTimeout: 120_000 })

describe.skipIf(!READY)('daily cleanup on the trial', () => {
  const owner = postgres(process.env.NEON_DATABASE_URL ?? 'postgres://unused', { max: 1, prepare: false, onnotice: () => {} })
  const tag = `cr${Date.now()}`
  const code = () => Math.random().toString(36).slice(2, 7).toUpperCase().replace(/[^A-Z0-9]/g, 'X').padEnd(5, 'X')
  const ids = { A: '', admin: '', old: '', recent: '', accepted: '', live: '' }

  beforeAll(async () => {
    ids.A = (await owner`insert into public.tenants (name, slug, code) values ('CRA', ${tag}, ${code()}) returning id`)[0].id
    const [u] = await owner`insert into ba."user" (name, email, "emailVerified") values ('Admin', ${'adm' + tag + '@cr-test.test'}, true) returning id`
    await owner`update public.users set role = 'university_admin', tenant_id = ${ids.A} where id = ${u.id}`
    ids.admin = u.id
    const inv = async (status: string, expires: string) => (await owner`
      insert into public.invitations (tenant_id, role, token, status, expires_at, invited_by)
      values (${ids.A}, 'student', ${tag + Math.random().toString(36).slice(2)}, ${status}, now() + ${expires}::interval, ${ids.admin}) returning id`)[0].id
    ids.old = await inv('pending', '-40 days')
    ids.recent = await inv('pending', '-5 days')
    ids.accepted = await inv('accepted', '-40 days')
    ids.live = await inv('pending', '7 days')
  }, 120_000)
  afterAll(async () => {
    await owner`delete from public.invitations where tenant_id = ${ids.A}`
    await owner`delete from ba."user" where email like ${'%' + tag + '%'}`
    await owner`delete from public.tenants where id = ${ids.A}`
    await owner.end()
  }, 120_000)

  it('deletes only pending invitations expired more than 30 days ago', async () => {
    process.env.CRON_SECRET = 'trial-cron-secret-long-enough'
    const { POST } = await import('@/app/api/cron/daily/route')
    const res = await POST(new Request('http://x', { method: 'POST', headers: { authorization: 'Bearer trial-cron-secret-long-enough' } }))
    expect(res.status).toBe(200)
    expect((await res.json()).expiredInvitationsDeleted).toBeGreaterThanOrEqual(1)
    const left = (await owner`select id from public.invitations where tenant_id = ${ids.A}`).map(r => r.id).sort()
    expect(left).toEqual([ids.recent, ids.accepted, ids.live].sort())
  })

  it('a signed-in user cannot run the cleanup function directly (app_system only)', async () => {
    await expect(owner.begin(async tx => {
      await tx`select set_config('role', 'app_user', true)`
      await tx`select public.cleanup_expired_invitations()`
    })).rejects.toThrow(/permission denied/)
  })
})
