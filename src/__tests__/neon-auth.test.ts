// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import postgres from 'postgres'
import { signCtx, verifyCtx, refreshCtx, type SessionCtx } from '@/lib/auth/session'
import { neonCreateUser, neonSignIn, neonSetPassword, neonSignOut, neonSessionUser, neonRemoveUser } from '@/lib/auth/neon'

// Step 9.6: Neon Auth through our own server. The signed-context tests always
// run. The integration part runs against the Neon trial when its settings are
// present (npm run test:neon) and is skipped otherwise.

const CTX: SessionCtx = { sub: '11111111-1111-1111-1111-111111111111', email: 'a@b.test', role: 'teacher', tenant_id: '22222222-2222-2222-2222-222222222222', is_active: true, must_change_password: false }

describe('signed session context (tm_ctx)', () => {
  const realSecret = process.env.APP_SESSION_SECRET
  beforeAll(() => { process.env.APP_SESSION_SECRET ??= 'x'.repeat(48) })
  afterAll(() => { if (realSecret === undefined) delete process.env.APP_SESSION_SECRET; vi.useRealTimers() })

  it('round-trips the profile', async () => {
    expect(await verifyCtx(await signCtx(CTX))).toEqual(CTX)
  })
  it('rejects a tampered token', async () => {
    const t = await signCtx(CTX)
    const [h, p, s] = t.split('.')
    const forged = JSON.parse(Buffer.from(p, 'base64url').toString())
    forged.role = 'super_admin'
    expect(await verifyCtx(`${h}.${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${s}`)).toBeNull()
  })
  it('rejects a token signed with another secret', async () => {
    const t = await signCtx(CTX)
    const saved = process.env.APP_SESSION_SECRET
    process.env.APP_SESSION_SECRET = 'y'.repeat(48)
    expect(await verifyCtx(t)).toBeNull()
    process.env.APP_SESSION_SECRET = saved
  })
  it('rejects an expired token (15 minutes)', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-22T10:00:00Z'))
    const t = await signCtx(CTX)
    vi.setSystemTime(new Date('2026-10-22T10:16:00Z'))
    expect(await verifyCtx(t)).toBeNull()
    vi.useRealTimers()
  })
  it('rejects nothing / garbage', async () => {
    expect(await verifyCtx(undefined)).toBeNull()
    expect(await verifyCtx('not-a-token')).toBeNull()
  })
  it('refuses a short secret', async () => {
    const saved = process.env.APP_SESSION_SECRET
    process.env.APP_SESSION_SECRET = 'short'
    await expect(signCtx(CTX)).rejects.toThrow(/APP_SESSION_SECRET/)
    process.env.APP_SESSION_SECRET = saved
  })
})

const READY = !!(process.env.NEON_AUTH_URL && process.env.NEON_AUTH_SERVICE_PASSWORD && process.env.NEON_GATEWAY_DATABASE_URL && process.env.NEON_DATABASE_URL)

describe.skipIf(!READY)('Neon Auth on the trial', () => {
  const owner = postgres(process.env.NEON_DATABASE_URL ?? 'postgres://unused', { max: 1, prepare: false, onnotice: () => {} })
  const tag = `na${Date.now()}`
  const email = `teacher-${tag}@neonauth-test.test`
  const pw1 = 'T1-' + crypto.randomUUID(), pw2 = 'T2-' + crypto.randomUUID()
  let userId = '', tenant = ''

  beforeAll(async () => {
    tenant = (await owner`insert into public.tenants (name, slug, code) values ('NA', ${tag}, 'NA9') returning id`)[0].id
  }, 60_000)
  afterAll(async () => {
    await owner`delete from neon_auth."user" where email like '%@neonauth-test.test'`
    await owner`delete from public.tenants where id = ${tenant}`
    await owner.end()
  }, 60_000)

  it('the service account creates an account; the trigger adds its profile', async () => {
    const r = await neonCreateUser({ email, password: pw1, name: 'NA teacher' })
    expect(r.error).toBeNull()
    userId = r.id as string
    const [p] = await owner`select role, tenant_id from public.users where id = ${userId}`
    expect(p).toEqual({ role: 'student', tenant_id: null })
    await owner`update public.users set role = 'teacher', tenant_id = ${tenant} where id = ${userId}`
  }, 30_000)

  it('a second account with the same email is reported as a duplicate', async () => {
    const r = await neonCreateUser({ email, password: pw1, name: 'dup' })
    expect(r.error?.duplicate).toBe(true)
  }, 30_000)

  it('sign-in, then a fresh context carries the profile from the database', async () => {
    const s = await neonSignIn(email, pw1)
    expect(s?.userId).toBe(userId)
    const ctx = await refreshCtx(s!.session)
    expect(ctx).toMatchObject({ sub: userId, role: 'teacher', tenant_id: tenant, is_active: true, must_change_password: false })
    await neonSignOut(s!.session)
    expect(await neonSessionUser(s!.session)).toBeNull()
  }, 30_000)

  it('a wrong password is refused', async () => {
    expect(await neonSignIn(email, 'wrong-' + pw1)).toBeNull()
  }, 30_000)

  it('the service account sets a new password', async () => {
    expect((await neonSetPassword(userId, pw2)).error).toBeNull()
    expect(await neonSignIn(email, pw1)).toBeNull()
    expect((await neonSignIn(email, pw2))?.userId).toBe(userId)
  }, 30_000)

  it('a deactivated account gets no context, even with a live session', async () => {
    const s = await neonSignIn(email, pw2)
    await owner`update public.users set is_active = false where id = ${userId}`
    expect(await refreshCtx(s!.session)).toBeNull()
    await owner`update public.users set is_active = true where id = ${userId}`
    await neonSignOut(s!.session)
  }, 30_000)

  it('the service account removes the account (profile goes with it)', async () => {
    expect((await neonRemoveUser(userId)).error).toBeNull()
    const [n] = await owner`select (select count(*)::int from neon_auth."user" where id = ${userId}) a, (select count(*)::int from public.users where id = ${userId}) u`
    expect(n).toEqual({ a: 0, u: 0 })
  }, 30_000)
})
