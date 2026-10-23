// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import postgres from 'postgres'

// AI metering end to end on the Neon trial, with two institutions: the caller
// re-derived from the live users row, the monthly allowance of the caller's
// own institution, and the ledger row written to that institution only. No
// provider is called: the metered call is a local stand-in. Only "who is
// signed in" comes from the test. Runs with `npm run test:neon`.

type Who = { sub: string; role: string; tenant_id: string | null }
const who = vi.hoisted(() => ({ ctx: null as null | Who }))
vi.mock('@/lib/auth/current', () => ({
  currentCtx: async () => (who.ctx ? { ...who.ctx, email: null, is_active: true, must_change_password: false } : null),
}))
vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))
vi.mock('next-intl/server', () => ({ getTranslations: async () => (k: string) => k }))
// after() outside a request: the wrapper runs the ledger write at once; keep its promise to await it
const pending = vi.hoisted(() => ({ tasks: [] as Promise<void>[] }))
vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server')
  return { ...actual, after: (task: () => Promise<void>) => { pending.tasks.push(task()) } }
})

const READY = !!(process.env.NEON_GATEWAY_DATABASE_URL && process.env.NEON_DATABASE_URL)

describe.skipIf(!READY)('AI metering on the trial', () => {
  const owner = postgres(process.env.NEON_DATABASE_URL ?? 'postgres://unused', { max: 1, prepare: false, onnotice: () => {} })
  const tag = `ai${Date.now()}`
  const code = () => Math.random().toString(36).slice(2, 7).toUpperCase().replace(/[^A-Z0-9]/g, 'X').padEnd(5, 'X')
  const ids = { A: '', B: '', tA: '', tB: '', tOff: '' }

  async function person(role: string, tenant: string) {
    const [u] = await owner`insert into ba."user" (name, email, "emailVerified") values (${role}, ${role + Math.random().toString(36).slice(2, 7) + tag + '@ai-test.test'}, true) returning id`
    await owner`update public.users set role = ${role}, tenant_id = ${tenant} where id = ${u.id}`
    return u.id as string
  }
  const as = (sub: string, role: string, tenant: string | null) => { who.ctx = { sub, role, tenant_id: tenant } }
  const usage = () => import('@/lib/ai/usage')
  const meter = () => import('@/lib/ai/meter')

  /** One AI request as the signed-in user: allowance, one metered call, the ledger write. */
  async function request(feature: string) {
    const { meteredAiRoute, authorizeAiUsage } = await usage()
    const { meterCall } = await meter()
    const provider = vi.fn(async () => ({ value: 'ok', inputTokens: 120, outputTokens: 30 }))
    const res = await meteredAiRoute(feature, async () => {
      const denied = await authorizeAiUsage(who.ctx!.sub)
      if (denied) return denied
      await meterCall('groq', 'openai/gpt-oss-120b', 10, ['public'], provider)
      return new Response('ok')
    })()
    await Promise.all(pending.tasks.splice(0))
    return { status: res.status, called: provider.mock.calls.length }
  }

  beforeAll(async () => {
    ids.A = (await owner`insert into public.tenants (name, slug, code) values ('AA', ${tag + 'a'}, ${code()}) returning id`)[0].id
    ids.B = (await owner`insert into public.tenants (name, slug, code, ai_monthly_request_limit) values ('AB', ${tag + 'b'}, ${code()}, 0) returning id`)[0].id
    ids.tA = await person('teacher', ids.A)
    ids.tB = await person('teacher', ids.B)
    ids.tOff = await person('teacher', ids.A)
    await owner`update public.users set is_active = false where id = ${ids.tOff}`
  }, 90_000)
  afterAll(async () => {
    await owner`delete from public.ai_usage_log where tenant_id in (${ids.A}, ${ids.B})`
    await owner`delete from public.ai_usage_daily where tenant_id in (${ids.A}, ${ids.B})`
    await owner`delete from public.ai_usage_alerts where tenant_id in (${ids.A}, ${ids.B})`.catch(() => {})
    await owner`delete from ba."user" where email like ${'%' + tag + '%'}`
    await owner`delete from public.tenants where id in (${ids.A}, ${ids.B})`
    await owner.end()
  }, 90_000)

  it('a teacher of an institution with allowance: the call runs and one row lands in that institution', async () => {
    as(ids.tA, 'teacher', ids.A)
    expect(await request('lesson')).toEqual({ status: 200, called: 1 })
    const rows = await owner`select tenant_id, user_id, feature, status, input_tokens::int, output_tokens::int from public.ai_usage_log where user_id = ${ids.tA}`
    expect(rows).toEqual([{ tenant_id: ids.A, user_id: ids.tA, feature: 'lesson', status: 'success', input_tokens: 120, output_tokens: 30 }])
  }, 90_000)

  it('an institution with AI off (limit 0): refused before any call, recorded as blocked in that institution', async () => {
    as(ids.tB, 'teacher', ids.B)
    expect(await request('exam')).toEqual({ status: 429, called: 0 })
    const rows = await owner`select tenant_id, status from public.ai_usage_log where user_id = ${ids.tB}`
    expect(rows).toEqual([{ tenant_id: ids.B, status: 'blocked' }])
  }, 90_000)

  it('a session of institution A for a user now in B spends nothing from A', async () => {
    as(ids.tB, 'teacher', ids.A)
    expect(await request('lesson')).toEqual({ status: 403, called: 0 })
    const [n] = await owner`select count(*)::int n from public.ai_usage_log where tenant_id = ${ids.A} and user_id = ${ids.tB}`
    expect(n.n).toBe(0)
  }, 90_000)

  it('a deactivated account is refused; another user\'s id is not authorized', async () => {
    as(ids.tOff, 'teacher', ids.A)
    expect((await request('lesson')).status).toBe(403)
    as(ids.tA, 'teacher', ids.A)
    const { authorizeAiUsage } = await usage()
    expect((await authorizeAiUsage(ids.tB))?.status).toBe(403)
  }, 90_000)

  it('the quota panel reads the caller\'s own counters', async () => {
    as(ids.tA, 'teacher', ids.A)
    const { GET } = await import('@/app/api/ai/quota/route')
    const res = await GET()
    expect(res.status).toBe(200)
    const { quota } = await res.json() as { quota: { key: string; limit: number; used: number }[] }
    expect(quota.find(q => q.key === 'lesson')).toMatchObject({ used: 0 })
  }, 90_000)
})
