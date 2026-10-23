// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import postgres from 'postgres'

// Institution administration end to end on the Neon trial, with two
// institutions: account status, affiliation, names, teacher and staff
// capabilities, branding, restore, and the owner's tools. Real routes, SQL
// layer and RLS; only "who is signed in" comes from the test. Every
// cross-institution attempt must be refused and change nothing.
// Runs with `npm run test:neon`.

type Who = { sub: string; role: string; tenant_id: string | null }
const who = vi.hoisted(() => ({ ctx: null as null | Who }))
vi.mock('@/lib/auth/current', async () => ({
  ...(await vi.importActual<object>('@/lib/auth/current')),
  currentCtx: async () => (who.ctx ? { ...who.ctx, email: null, is_active: true, must_change_password: false } : null),
}))
vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: async () => ({ allowed: true, remaining: 1, resetAt: 0 }) }))
vi.mock('next-intl/server', () => ({ getTranslations: async () => (k: string) => k }))

const READY = !!(process.env.NEON_GATEWAY_DATABASE_URL && process.env.NEON_DATABASE_URL)

describe.skipIf(!READY)('institution administration on the trial', () => {
  const owner = postgres(process.env.NEON_DATABASE_URL ?? 'postgres://unused', { max: 1, prepare: false, onnotice: () => {} })
  const tag = `ad${Date.now()}`
  const code = () => Math.random().toString(36).slice(2, 7).toUpperCase().replace(/[^A-Z0-9]/g, 'X').padEnd(5, 'X')
  const ids = { A: '', B: '', aA: '', aB: '', cmA: '', cmB: '', tA: '', tB: '', sA: '', sB: '', sOff: '', owner: '', gA: '' }

  async function person(role: string, tenant: string | null) {
    const [u] = await owner`insert into ba."user" (name, email, "emailVerified") values (${role}, ${role + Math.random().toString(36).slice(2, 7) + tag + '@ad-test.test'}, true) returning id`
    await owner`update public.users set role = ${role}, tenant_id = ${tenant} where id = ${u.id}`
    return u.id as string
  }
  const as = (sub: string, role: string, tenant: string | null) => { who.ctx = { sub, role, tenant_id: tenant } }
  const patch = async (path: string, body: unknown) => {
    const mod = await import(`@/app/api/admin/${path}/route`) as { PATCH?: (r: Request) => Promise<Response>; POST?: (r: Request) => Promise<Response> }
    const handler = (mod.PATCH ?? mod.POST)!
    const res = await handler(new Request(`http://x/api/admin/${path}`, { method: 'PATCH', body: JSON.stringify(body) }))
    return { status: res.status, body: await res.json().catch(() => null) }
  }
  const get = async (path: string, qs: string) => {
    const mod = await import(`@/app/api/admin/${path}/route`) as { GET: (r: Request) => Promise<Response> }
    const res = await mod.GET(new Request(`http://x/api/admin/${path}?${qs}`))
    return { status: res.status, body: await res.json().catch(() => null) }
  }
  const user = async (id: string) => (await owner`select is_active, is_university_student, can_create_courses, permissions, full_name from public.users where id = ${id}`)[0]

  beforeAll(async () => {
    ids.A = (await owner`insert into public.tenants (name, slug, code, student_limit) values ('IA', ${tag + 'a'}, ${code()}, 2) returning id`)[0].id
    ids.B = (await owner`insert into public.tenants (name, slug, code) values ('IB', ${tag + 'b'}, ${code()}) returning id`)[0].id
    ids.aA = await person('university_admin', ids.A)
    ids.aB = await person('university_admin', ids.B)
    ids.cmA = await person('center_manager', ids.A)
    ids.cmB = await person('center_manager', ids.B)
    ids.tA = await person('teacher', ids.A)
    ids.tB = await person('teacher', ids.B)
    ids.sA = await person('student', ids.A)
    ids.sB = await person('student', ids.B)
    ids.sOff = await person('student', ids.A)
    ids.owner = await person('super_admin', null)
    // institution A: two student seats, two active students → full
    await owner`update public.users set is_active = false where id = ${ids.sOff}`
    await person('student', ids.A)
    ids.gA = (await owner`insert into public.groups (tenant_id, teacher_id, name, deleted_at) values (${ids.A}, ${ids.tA}, 'Archived', now()) returning id`)[0].id
  }, 120_000)
  afterAll(async () => {
    await owner`delete from public.groups where tenant_id in (${ids.A}, ${ids.B})`
    await owner`delete from ba."user" where email like ${'%' + tag + '%'}`
    await owner`delete from public.tenants where id in (${ids.A}, ${ids.B})`
    await owner.end()
  }, 90_000)

  it('account status: an admin switches their own teacher off; another institution\'s account is not found', async () => {
    as(ids.aA, 'university_admin', ids.A)
    expect((await patch('toggle-user', { userId: ids.tA, isActive: false })).status).toBe(200)
    expect((await user(ids.tA)).is_active).toBe(false)
    expect((await patch('toggle-user', { userId: ids.tA, isActive: true })).status).toBe(200)
    expect((await patch('toggle-user', { userId: ids.tB, isActive: false })).status).toBe(404)
    expect((await user(ids.tB)).is_active).toBe(true)
    expect((await patch('toggle-user', { userId: ids.owner, isActive: false })).status).toBe(404)
  }, 90_000)

  it('account status: re-enabling a student is refused while the institution is full', async () => {
    as(ids.aA, 'university_admin', ids.A)
    const res = await patch('toggle-user', { userId: ids.sOff, isActive: true })
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('studentLimit')
    expect((await user(ids.sOff)).is_active).toBe(false)
  }, 90_000)

  it('a demoted admin with a fresh-looking session changes nothing', async () => {
    await owner`update public.users set role = 'teacher' where id = ${ids.aA}`
    as(ids.aA, 'university_admin', ids.A)
    const res = await patch('toggle-user', { userId: ids.sA, isActive: false })
    await owner`update public.users set role = 'university_admin' where id = ${ids.aA}`
    expect(res.status).toBe(403)
    expect((await user(ids.sA)).is_active).toBe(true)
  }, 90_000)

  it('centre manager: a university student stays with the institution admin', async () => {
    await owner`update public.users set permissions = ${owner.json({ manage_students: true })} where id = ${ids.cmA}`
    as(ids.cmA, 'center_manager', ids.A)
    const res = await patch('toggle-user', { userId: ids.sA, isActive: false })
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('universityStudent')
  }, 90_000)

  it('affiliation and student name: own institution only', async () => {
    as(ids.aA, 'university_admin', ids.A)
    expect((await patch('student-affiliation', { userId: ids.sA, isUniversityStudent: false })).status).toBe(200)
    expect((await user(ids.sA)).is_university_student).toBe(false)
    expect((await patch('student-affiliation', { userId: ids.sB, isUniversityStudent: false })).status).toBe(404)
    expect((await user(ids.sB)).is_university_student).not.toBe(false)
    const parts = { first: 'Huda', father: 'Ali', grandfather: 'Omar', family: 'Saleh' }
    const ok = await patch('student-name', { userId: ids.sA, nameParts: parts })
    expect(ok.status).toBe(200)
    expect((await user(ids.sA)).full_name).toBe(ok.body.full_name)
    const [n] = await owner`select father_name from public.student_names where user_id = ${ids.sA}`
    expect(n.father_name).toBe('Ali')
    expect((await patch('student-name', { userId: ids.sB, nameParts: parts })).status).toBe(404)
  }, 90_000)

  it('teacher course creation and staff capabilities: own institution, no escalation', async () => {
    as(ids.aA, 'university_admin', ids.A)
    expect((await patch('teacher-permissions', { teacher_id: ids.tA, can_create_courses: true })).status).toBe(200)
    expect((await user(ids.tA)).can_create_courses).toBe(true)
    expect((await patch('teacher-permissions', { teacher_id: ids.tB, can_create_courses: true })).status).toBe(404)
    expect((await user(ids.tB)).can_create_courses).not.toBe(true)
    expect((await patch('permissions', { user_id: ids.cmA, permissions: { manage_students: true } })).status).toBe(200)
    expect((await patch('permissions', { user_id: ids.cmB, permissions: { manage_students: true } })).status).toBe(404)
    // an admin restricted by the owner cannot grant what they no longer hold
    await owner`update public.users set permissions = ${owner.json({ manage_teachers: false })} where id = ${ids.aA}`
    const esc = await patch('permissions', { user_id: ids.cmA, permissions: { manage_teachers: true } })
    await owner`update public.users set permissions = '{}'::jsonb where id = ${ids.aA}`
    expect(esc.status).toBe(403)
  }, 90_000)

  it('branding: the admin\'s own institution only, never is_active', async () => {
    as(ids.aA, 'university_admin', ids.A)
    const res = await patch('tenant-branding', { name: 'IA renamed', logo_url: '', is_active: false, tenant_id: ids.B })
    expect(res.status).toBe(200)
    const rows = await owner`select id, name, is_active from public.tenants where id in (${ids.A}, ${ids.B}) order by name`
    expect(rows.find(r => r.id === ids.A)).toMatchObject({ name: 'IA renamed', is_active: true })
    expect(rows.find(r => r.id === ids.B)).toMatchObject({ name: 'IB' })
  }, 90_000)

  it('restore: own institution\'s archive only', async () => {
    as(ids.aB, 'university_admin', ids.B)
    expect((await patch('restore', { kind: 'group', id: ids.gA })).status).toBe(500)
    const [still] = await owner`select deleted_at is not null as archived from public.groups where id = ${ids.gA}`
    expect(still.archived).toBe(true)
    as(ids.aA, 'university_admin', ids.A)
    expect((await patch('restore', { kind: 'group', id: ids.gA })).status).toBe(200)
    const [back] = await owner`select deleted_at is not null as archived from public.groups where id = ${ids.gA}`
    expect(back.archived).toBe(false)
  }, 90_000)

  it('the owner\'s tools: users of one institution, search, lookup, suspend — refused to an institution admin', async () => {
    as(ids.aA, 'university_admin', ids.A)
    expect((await get('tenant-users', `tenant_id=${ids.B}`)).status).toBe(403)
    expect((await get('report-targets', `kind=teacher&tenant_id=${ids.B}&q=teacher`)).status).toBe(403)
    expect((await patch('archive-tenant', { tenant_id: ids.B, archive: true })).status).toBe(403)

    as(ids.owner, 'super_admin', null)
    const list = await get('tenant-users', `tenant_id=${ids.B}&role=teacher`)
    expect(list.body.total).toBe(1)
    expect(list.body.users[0].id).toBe(ids.tB)
    const found = await get('report-targets', `kind=student&tenant_id=${ids.B}&q=ad-test`)
    expect(found.body.results.map((r: { id: string }) => r.id)).toEqual([ids.sB])
    const [m] = await owner`select member_code from public.users where id = ${ids.sB}`
    if (m.member_code) {
      const lookup = await get('member-lookup', `code=${m.member_code}`)
      expect(lookup.body.member).toMatchObject({ id: ids.sB, tenant_id: ids.B, tenants: { name: 'IB' } })
    }
    expect((await patch('archive-tenant', { tenant_id: ids.B, archive: true })).status).toBe(200)
    expect((await user(ids.tB)).is_active).toBe(false)
    expect((await patch('archive-tenant', { tenant_id: ids.B, archive: false })).status).toBe(200)
    expect((await user(ids.tB)).is_active).toBe(true)
  }, 120_000)
})
