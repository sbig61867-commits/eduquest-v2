// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import postgres from 'postgres'

// /api/admin/create-user end to end on the Neon trial: real SQL layer, real
// Better Auth, real RLS. Only "who is signed in" is supplied by the test.
// Runs with `npm run test:neon`; skipped without the trial settings.

const caller = vi.hoisted(() => ({ id: '' }))
vi.mock('@/lib/auth', () => ({ getSessionUser: async () => (caller.id ? { id: caller.id } : null) }))
// error messages need a Next request context; the code is what the tests check
vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))

const READY = !!(process.env.NEON_AUTH_DATABASE_URL && process.env.BETTER_AUTH_SECRET && process.env.NEON_GATEWAY_DATABASE_URL && process.env.NEON_DATABASE_URL)

describe.skipIf(!READY)('create-user on the trial', () => {
  const owner = postgres(process.env.NEON_DATABASE_URL ?? 'postgres://unused', { max: 1, prepare: false, onnotice: () => {} })
  const tag = `cu${Date.now()}`
  const code = () => Math.random().toString(36).slice(2, 7).toUpperCase().replace(/[^A-Z0-9]/g, 'X').padEnd(5, 'X')
  const ids = { A: '', B: '', admin: '', teacher: '', otherTeacher: '', ownGroup: '', otherGroup: '' }

  async function account(role: string, tenant: string) {
    const [u] = await owner`insert into ba."user" (name, email, "emailVerified") values (${role}, ${role + '-' + tag + Math.random().toString(36).slice(2, 6) + '@cu-test.test'}, true) returning id`
    await owner`update public.users set role = ${role}, tenant_id = ${tenant}, permissions = ${owner.json({ manage_students: true, manage_teachers: true })} where id = ${u.id}`
    return u.id as string
  }
  const post = async (body: Record<string, unknown>) => {
    const { POST } = await import('@/app/api/admin/create-user/route')
    const res = await POST(new Request('http://x/api/admin/create-user', { method: 'POST', body: JSON.stringify(body) }))
    return { status: res.status, data: await res.json() }
  }
  const parts = { first: 'أحمد', father: 'محمود', grandfather: 'صالح', family: 'الخطيب' }

  beforeAll(async () => {
    ids.A = (await owner`insert into public.tenants (name, slug, code) values ('CA', ${tag + 'a'}, ${code()}) returning id`)[0].id
    ids.B = (await owner`insert into public.tenants (name, slug, code) values ('CB', ${tag + 'b'}, ${code()}) returning id`)[0].id
    ids.admin = await account('university_admin', ids.A)
    ids.teacher = await account('teacher', ids.A)
    ids.otherTeacher = await account('teacher', ids.A)
    ids.ownGroup = (await owner`insert into public.groups (tenant_id, teacher_id, name) values (${ids.A}, ${ids.teacher}, 'own') returning id`)[0].id
    ids.otherGroup = (await owner`insert into public.groups (tenant_id, teacher_id, name) values (${ids.A}, ${ids.otherTeacher}, 'other') returning id`)[0].id
  }, 60_000)
  afterAll(async () => {
    await owner`delete from public.groups where tenant_id in (${ids.A}, ${ids.B})`
    await owner`delete from ba."user" where id in (select id from public.users where tenant_id in (${ids.A}, ${ids.B}))`
    await owner`delete from ba."user" where email like ${'%' + tag + '%'}`
    await owner`delete from public.tenants where id in (${ids.A}, ${ids.B})`
    await owner.end()
  }, 60_000)

  it('an admin creates a student by email: account, profile in the institution, forced password change', async () => {
    caller.id = ids.admin
    const email = `s1-${tag}@cu-test.test`
    const { status, data } = await post({ role: 'student', email, password: 'Secret-123', name_parts: parts })
    expect(status).toBe(200)
    const [p] = await owner`select u.role, u.tenant_id, u.must_change_password, u.full_name, u.name_complete, b.email from public.users u join ba."user" b on b.id = u.id where u.id = ${data.user.id}`
    expect(p).toEqual({ role: 'student', tenant_id: ids.A, must_change_password: true, full_name: 'أحمد الخطيب', name_complete: true, email })
    const [n] = await owner`select first_name, family_name from public.student_names where user_id = ${data.user.id}`
    expect(n).toEqual({ first_name: 'أحمد', family_name: 'الخطيب' })
  }, 60_000)

  it('a member-ID teacher gets an ID shown in place of the email and a one-time password', async () => {
    caller.id = ids.admin
    const { status, data } = await post({ role: 'teacher', login_mode: 'member_id', full_name: 'Teacher By ID' })
    expect(status).toBe(200)
    expect(data.member_code).toBeTruthy()
    expect(data.temp_password).toMatch(/^[A-Za-z2-9]{10}$/)
    const [p] = await owner`select email, member_code, role from public.users where id = ${data.user.id}`
    expect(p.email).toBe(p.member_code)
    expect(p.role).toBe('teacher')
  }, 60_000)

  it('a teacher creates a student straight into their own group', async () => {
    caller.id = ids.teacher
    const { status, data } = await post({ role: 'student', email: `s2-${tag}@cu-test.test`, password: 'Secret-123', name_parts: parts, group_id: ids.ownGroup })
    expect(status).toBe(200)
    const [g] = await owner`select count(*)::int n from public.group_students where group_id = ${ids.ownGroup} and student_id = ${data.user.id}`
    expect(g.n).toBe(1)
  }, 60_000)

  it("a teacher cannot add into another teacher's group, and no account is left behind", async () => {
    caller.id = ids.teacher
    const email = `s3-${tag}@cu-test.test`
    const { status } = await post({ role: 'student', email, password: 'Secret-123', name_parts: parts, group_id: ids.otherGroup })
    expect(status).toBe(403)
    const [n] = await owner`select count(*)::int n from ba."user" where email = ${email}`
    expect(n.n).toBe(0)
  }, 60_000)

  it('the seat limit is enforced', async () => {
    caller.id = ids.admin
    const [{ n }] = await owner`select count(*)::int n from public.users where tenant_id = ${ids.A} and role = 'student' and is_active`
    await owner`update public.tenants set student_limit = ${n} where id = ${ids.A}`
    const { status, data } = await post({ role: 'student', email: `s4-${tag}@cu-test.test`, password: 'Secret-123', name_parts: parts })
    await owner`update public.tenants set student_limit = null where id = ${ids.A}`
    expect(status).toBe(403)
    expect(data.code).toBe('studentLimit')
  }, 60_000)

  it('provision_user_profile refuses another institution and an account that is not new', async () => {
    const gw = postgres(process.env.NEON_GATEWAY_DATABASE_URL ?? '', { max: 1, onnotice: () => {} })
    const [fresh] = await owner`insert into ba."user" (name, email, "emailVerified") values ('p', ${'p-' + tag + '@cu-test.test'}, true) returning id`
    const asService = (tenant: string) => gw.begin(async tx => {
      await tx`select set_config('app.tenant_id', ${tenant}, true), set_config('role', 'app_service', true)`
      return tx`select public.provision_user_profile(${fresh.id}, ${ids.A}, 'student', 'x@x.test', 'x', true, true)`
    }).then(() => 'ok', e => e.message as string)
    // a unit pinned to B cannot place an account into A
    expect(await asService(ids.B)).toMatch(/PROVISION_SCOPE/)
    // an account older than ten minutes is not "new"
    await owner`update public.users set created_at = now() - interval '1 hour' where id = ${fresh.id}`
    expect(await asService(ids.A)).toMatch(/PROVISION_NOT_NEW/)
    await gw.end()
  }, 60_000)
})
