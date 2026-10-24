// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import postgres from 'postgres'

// The owner's write routes (/api/super-admin/*) on the Neon trial (step 9). The
// owner gate is the statement itself (the caller's LIVE role in the same write),
// so a university admin gets 403 and changes nothing — and the owner's writes
// land. Runs with `npm run test:neon`.

type Who = { sub: string; role: string; tenant_id: string | null }
const who = vi.hoisted(() => ({ ctx: null as null | Who }))
vi.mock('@/lib/auth/current', async () => ({
  ...(await vi.importActual<object>('@/lib/auth/current')),
  currentCtx: async () => (who.ctx ? { ...who.ctx, email: null, is_active: true, must_change_password: false } : null),
  currentUser: async () => (who.ctx ? { id: who.ctx.sub, role: who.ctx.role, tenant_id: who.ctx.tenant_id } : null),
}))
vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))

const READY = !!(process.env.NEON_GATEWAY_DATABASE_URL && process.env.NEON_DATABASE_URL)
vi.setConfig({ testTimeout: 120_000 })

describe.skipIf(!READY)('owner write routes on the trial', () => {
  const owner = postgres(process.env.NEON_DATABASE_URL ?? 'postgres://unused', { max: 1, prepare: false, onnotice: () => {} })
  const tag = `ow${Date.now()}`
  const code = () => Math.random().toString(36).slice(2, 7).toUpperCase().replace(/[^A-Z0-9]/g, 'X').padEnd(5, 'X')
  const ids = { A: '', aA: '', owner: '', tA: '' }
  const json = (body: unknown) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const patch = (body: unknown) => ({ method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

  async function person(role: string, tenant: string | null, name = role) {
    const [u] = await owner`insert into ba."user" (name, email, "emailVerified") values (${name}, ${role + Math.random().toString(36).slice(2, 7) + tag + '@ow-test.test'}, true) returning id`
    await owner`update public.users set role = ${role}, tenant_id = ${tenant}, full_name = ${name} where id = ${u.id}`
    return u.id as string
  }

  beforeAll(async () => {
    ids.A = (await owner`insert into public.tenants (name, slug, code, student_limit) values ('OWA', ${tag + 'a'}, ${code()}, 10) returning id`)[0].id
    ids.aA = await person('university_admin', ids.A, 'Admin A')
    ids.tA = await person('teacher', ids.A, 'Teacher A')
    ids.owner = await person('super_admin', ids.A, 'Owner')
  }, 120_000)
  afterAll(async () => {
    await owner`delete from public.feature_flags where tenant_id = ${ids.A}`
    await owner`delete from public.platform_settings where key = 'deletion_policy'`
    await owner`delete from ba."user" where email like ${'%' + tag + '%'}`
    await owner`delete from public.tenants where id = ${ids.A}`
    await owner.end()
  }, 120_000)

  const as = (sub: string, role: string, tenant: string | null) => { who.ctx = { sub, role, tenant_id: tenant } }

  it('tenant limits: the owner writes; a university admin of that institution is refused and nothing changes', async () => {
    const { PATCH } = await import('@/app/api/super-admin/tenants/route')
    as(ids.aA, 'university_admin', ids.A)
    const refused = await PATCH(new Request('http://x', patch({ id: ids.A, student_limit: 999 })))
    expect(refused.status).toBe(403)
    const [still] = await owner`select student_limit from public.tenants where id = ${ids.A}`
    expect(still.student_limit).toBe(10)

    as(ids.owner, 'super_admin', ids.A)
    const ok = await PATCH(new Request('http://x', patch({ id: ids.A, student_limit: 25 })))
    expect(ok.status).toBe(200)
    expect((await ok.json()).student_limit).toBe(25)
    const [now] = await owner`select student_limit, teacher_limit from public.tenants where id = ${ids.A}`
    expect(now.student_limit).toBe(25)
    expect(now.teacher_limit).toBeNull()
  })

  it('feature flags: the owner creates and deletes; a teacher is refused on create', async () => {
    const { POST, DELETE } = await import('@/app/api/super-admin/feature-flags/route')
    as(ids.tA, 'teacher', ids.A)
    expect((await POST(new Request('http://x', json({ name: 'flag_x', tenant_id: ids.A })))).status).toBe(403)
    as(ids.owner, 'super_admin', ids.A)
    const made = await POST(new Request('http://x', json({ name: 'flag_x', tenant_id: ids.A })))
    expect(made.status).toBe(200)
    const row = await made.json()
    expect(row).toMatchObject({ name: 'flag_x', tenant_id: ids.A, is_enabled: true })
    expect((await DELETE(new Request(`http://x?id=${row.id}`, { method: 'DELETE' }))).status).toBe(200)
  })

  it('platform settings: the owner saves a known key; an unknown key or a non-owner is refused and nothing is stored', async () => {
    const { PUT } = await import('@/app/api/super-admin/platform-settings/route')
    as(ids.aA, 'university_admin', ids.A)
    expect((await PUT(new Request('http://x', json({ key: 'deletion_policy', value: { hard_delete_enabled: true } })))).status).toBe(403)
    as(ids.owner, 'super_admin', ids.A)
    expect((await PUT(new Request('http://x', json({ key: 'something_else', value: { x: 1 } })))).status).toBe(400)
    expect((await PUT(new Request('http://x', json({ key: 'deletion_policy', value: { hard_delete_enabled: 'yes' } })))).status).toBe(400)
    expect((await PUT(new Request('http://x', json({ key: 'deletion_policy', value: { hard_delete_enabled: true } })))).status).toBe(200)
    const [row] = await owner`select value from public.platform_settings where key = 'deletion_policy'`
    expect(row.value).toEqual({ hard_delete_enabled: true })
  })

  it('the owner\'s own name: only their own row changes', async () => {
    const { PATCH: profile } = await import('@/app/api/super-admin/profile/route')
    as(ids.owner, 'super_admin', ids.A)
    expect((await profile(new Request('http://x', patch({ full_name: 'Owner Renamed' })))).status).toBe(200)
    const [me] = await owner`select full_name from public.users where id = ${ids.owner}`
    expect(me.full_name).toBe('Owner Renamed')
    const [admin] = await owner`select full_name from public.users where id = ${ids.aA}`
    expect(admin.full_name).toBe('Admin A')
  })
})
