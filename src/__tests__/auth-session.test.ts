// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import postgres from 'postgres'
import { signCtx, verifyCtx, refreshCtx, type SessionCtx } from '@/lib/auth/session'
import { authCreateUser, authSignIn, authSetPassword, authSignOut, authSessionUser, authRemoveUser, authVerifyPassword, SIGN_IN_LIMITS } from '@/lib/auth/better'

// Step 9.6: Better Auth inside our server. The signed-context tests always
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

const READY = !!(process.env.NEON_AUTH_DATABASE_URL && process.env.BETTER_AUTH_SECRET && process.env.APP_SESSION_SECRET && process.env.NEON_GATEWAY_DATABASE_URL && process.env.NEON_DATABASE_URL)

// request headers as a browser behind one school NAT would send them
// the successful result, or null
const signedIn = (r: Awaited<ReturnType<typeof authSignIn>>) => (r.ok ? r : null)

const headersFor = (setCookies: string[] = []) => new Headers({
  'cf-connecting-ip': '198.51.100.7',
  ...(setCookies.length ? { cookie: setCookies.map(c => c.split(';')[0]).join('; ') } : {}),
})

describe.skipIf(!READY)('Better Auth on the trial', () => {
  const owner = postgres(process.env.NEON_DATABASE_URL ?? 'postgres://unused', { max: 1, prepare: false, onnotice: () => {} })
  // institution codes are unique: a random one per run
  const code = () => Math.random().toString(36).slice(2, 7).toUpperCase().replace(/[^A-Z0-9]/g, 'X').padEnd(5, 'X')
  const tag = `ba${Date.now()}`
  const email = `teacher-${tag}@auth-test.test`
  const pw1 = 'T1-' + crypto.randomUUID(), pw2 = 'T2-' + crypto.randomUUID()
  let userId = '', tenant = ''

  beforeAll(async () => {
    tenant = (await owner`insert into public.tenants (name, slug, code) values ('BA', ${tag}, ${code()}) returning id`)[0].id
  }, 60_000)
  afterAll(async () => {
    await owner`delete from ba."user" where email like '%@auth-test.test'`
    await owner`delete from public.tenants where id = ${tenant}`
    await owner.end()
  }, 60_000)

  it('the server creates an account with a UUID id; the trigger adds its profile', async () => {
    const r = await authCreateUser({ email, password: pw1, name: 'BA teacher' })
    expect(r.error).toBeNull()
    userId = r.id as string
    expect(userId).toMatch(/^[0-9a-f-]{36}$/)
    const [p] = await owner`select role, tenant_id from public.users where id = ${userId}`
    expect(p).toEqual({ role: 'student', tenant_id: null })
    await owner`update public.users set role = 'teacher', tenant_id = ${tenant} where id = ${userId}`
  }, 30_000)

  it('refuses a duplicate email, a malformed email and a short password', async () => {
    expect((await authCreateUser({ email: email.toUpperCase(), password: pw1, name: 'dup' })).error?.duplicate).toBe(true)
    expect((await authCreateUser({ email: 'not-an-email', password: pw1, name: 'x' })).error?.invalidEmail).toBe(true)
    expect((await authCreateUser({ email: `short-${tag}@auth-test.test`, password: 'short', name: 'x' })).error).not.toBeNull()
  }, 30_000)

  it('sign-in sets the session cookie; a fresh context carries the profile from the database', async () => {
    const s = signedIn(await authSignIn(email, pw1, headersFor()))
    expect(s?.userId).toBe(userId)
    expect(s!.setCookies.some(c => c.startsWith('tm.session_token='))).toBe(true)
    const ctx = await refreshCtx(headersFor(s!.setCookies))
    expect(ctx).toMatchObject({ sub: userId, role: 'teacher', tenant_id: tenant, is_active: true, must_change_password: false })
    await authSignOut(headersFor(s!.setCookies))
    expect(await authSessionUser(headersFor(s!.setCookies))).toBeNull()
  }, 30_000)

  it('a wrong password is refused; verifyPassword agrees', async () => {
    expect(await authSignIn(email, 'wrong-' + pw1, headersFor())).toEqual({ ok: false, reason: 'invalid' })
    expect(await authVerifyPassword(email, pw1)).toBe(userId)
    expect(await authVerifyPassword(email, 'wrong-' + pw1)).toBeNull()
  }, 30_000)

  it('a whole class behind one IP can sign in at once (40 students, 40 accounts)', async () => {
    const pw = 'C-' + crypto.randomUUID()
    const made = await Promise.all(Array.from({ length: 40 }, (_, i) => authCreateUser({ email: `student${i}-${tag}@auth-test.test`, password: pw, name: `s${i}` })))
    expect(made.filter(m => m.error === null)).toHaveLength(40)
    const nat = `198.51.${Math.floor(Math.random() * 200) + 1}.${Math.floor(Math.random() * 200) + 1}`
    const results = await Promise.all(made.map((_, i) => authSignIn(`student${i}-${tag}@auth-test.test`, pw, new Headers({ 'cf-connecting-ip': nat }))))
    expect(results.filter(r => r.ok)).toHaveLength(40)
  }, 180_000)

  it('the per-IP and per-account limits refuse once exceeded, and only there', async () => {
    const saved = { ...SIGN_IN_LIMITS.perIp }, savedAcct = { ...SIGN_IN_LIMITS.perAccount }
    try {
      // lowered for the test; the real values are 120/min per IP and 20/15 min per account
      SIGN_IN_LIMITS.perIp.limit = 3
      const ip = `203.0.${Math.floor(Math.random() * 200) + 1}.${Math.floor(Math.random() * 200) + 1}`
      const h = () => new Headers({ 'cf-connecting-ip': ip })
      const firstThree = [await authSignIn(email, pw1, h()), await authSignIn(email, pw1, h()), await authSignIn(email, pw1, h())]
      expect(firstThree.every(r => r.ok)).toBe(true)
      expect(await authSignIn(email, pw1, h())).toEqual({ ok: false, reason: 'rate_limited' })
      SIGN_IN_LIMITS.perIp.limit = saved.limit

      // per account: wrong passwords from many addresses still run out
      const victim = `victim-${tag}@auth-test.test`
      await authCreateUser({ email: victim, password: pw1, name: 'victim' })
      SIGN_IN_LIMITS.perAccount.limit = 3
      const guesses = []
      for (let i = 0; i < 3; i++) guesses.push(await authSignIn(victim, 'guess-' + i, new Headers({ 'cf-connecting-ip': `192.0.2.${i + 1}` })))
      expect(guesses.every(r => !r.ok && r.reason === 'invalid')).toBe(true)
      // even the right password is refused now, from a new address
      expect(await authSignIn(victim, pw1, new Headers({ 'cf-connecting-ip': '192.0.2.200' }))).toEqual({ ok: false, reason: 'rate_limited' })
      // another (unused) account is not affected
      const bystander = `bystander-${tag}@auth-test.test`
      await authCreateUser({ email: bystander, password: pw1, name: 'bystander' })
      expect((await authSignIn(bystander, pw1, new Headers({ 'cf-connecting-ip': '192.0.2.201' }))).ok).toBe(true)
    } finally {
      Object.assign(SIGN_IN_LIMITS.perIp, saved)
      Object.assign(SIGN_IN_LIMITS.perAccount, savedAcct)
    }
  }, 120_000)

  it('setting a new password ends the old sessions', async () => {
    const s = signedIn(await authSignIn(email, pw1, headersFor()))
    expect((await authSetPassword(userId, pw2)).error).toBeNull()
    expect(await authSessionUser(headersFor(s!.setCookies))).toBeNull()
    expect((await authSignIn(email, pw1, headersFor())).ok).toBe(false)
    expect(signedIn(await authSignIn(email, pw2, headersFor()))?.userId).toBe(userId)
  }, 60_000)

  it('a deactivated account gets no context, even with a live session', async () => {
    const s = signedIn(await authSignIn(email, pw2, headersFor()))
    await owner`update public.users set is_active = false where id = ${userId}`
    expect(await refreshCtx(headersFor(s!.setCookies))).toBeNull()
    await owner`update public.users set is_active = true where id = ${userId}`
  }, 30_000)

  it('removing the account removes its profile too', async () => {
    expect((await authRemoveUser(userId)).error).toBeNull()
    const [n] = await owner`select (select count(*)::int from ba."user" where id = ${userId}) a, (select count(*)::int from public.users where id = ${userId}) u, (select count(*)::int from ba.session where "userId" = ${userId}) s`
    expect(n).toEqual({ a: 0, u: 0, s: 0 })
  }, 30_000)
})
