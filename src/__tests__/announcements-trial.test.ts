// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import postgres from 'postgres'

// Announcements end to end on the Neon trial, with two institutions: authoring
// (create, edit, delete, group targeting), the student's engagement events
// from their own feed, and the authors' list of interested students. Real
// routes, SQL layer, RLS and the feed function; only "who is signed in" comes
// from the test. Runs with `npm run test:neon`.

type Who = { sub: string; role: string; tenant_id: string | null }
const who = vi.hoisted(() => ({ ctx: null as null | Who }))
vi.mock('@/lib/auth/current', async () => ({
  ...(await vi.importActual<object>('@/lib/auth/current')),
  currentCtx: async () => (who.ctx ? { ...who.ctx, email: null, is_active: true, must_change_password: false } : null),
}))
vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: async () => ({ allowed: true, remaining: 1, resetAt: 0 }) }))

const READY = !!(process.env.NEON_GATEWAY_DATABASE_URL && process.env.NEON_DATABASE_URL)

describe.skipIf(!READY)('announcements on the trial', () => {
  const owner = postgres(process.env.NEON_DATABASE_URL ?? 'postgres://unused', { max: 1, prepare: false, onnotice: () => {} })
  const tag = `an${Date.now()}`
  const code = () => Math.random().toString(36).slice(2, 7).toUpperCase().replace(/[^A-Z0-9]/g, 'X').padEnd(5, 'X')
  const ids = { A: '', B: '', aA: '', aB: '', tA: '', sA: '', sB: '', gA: '', gB: '', ann: '', grpAnn: '' }

  async function person(role: string, tenant: string) {
    const [u] = await owner`insert into ba."user" (name, email, "emailVerified") values (${role}, ${role + Math.random().toString(36).slice(2, 7) + tag + '@an-test.test'}, true) returning id`
    await owner`update public.users set role = ${role}, tenant_id = ${tenant} where id = ${u.id}`
    return u.id as string
  }
  const as = (sub: string, role: string, tenant: string) => { who.ctx = { sub, role, tenant_id: tenant } }
  const routes: Record<string, () => Promise<unknown>> = {
    '': () => import('@/app/api/announcements/route'),
    '/events': () => import('@/app/api/announcements/events/route'),
    '/interested': () => import('@/app/api/announcements/interested/route'),
  }
  const call = async (path: string, method: string, body?: unknown, qs = '') => {
    const mod = (await routes[path]()) as unknown as Record<string, (r: Request) => Promise<Response>>
    const res = await mod[method](new Request(`http://x/api/announcements${path}${qs}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }))
    return { status: res.status, body: await res.json().catch(() => null) }
  }

  beforeAll(async () => {
    ids.A = (await owner`insert into public.tenants (name, slug, code, has_center) values ('NA', ${tag + 'a'}, ${code()}, false) returning id`)[0].id
    ids.B = (await owner`insert into public.tenants (name, slug, code, has_center) values ('NB', ${tag + 'b'}, ${code()}, false) returning id`)[0].id
    ids.aA = await person('university_admin', ids.A)
    ids.aB = await person('university_admin', ids.B)
    ids.tA = await person('teacher', ids.A)
    ids.sA = await person('student', ids.A)
    ids.sB = await person('student', ids.B)
    ids.gA = (await owner`insert into public.groups (tenant_id, teacher_id, name) values (${ids.A}, ${ids.tA}, 'GA') returning id`)[0].id
    ids.gB = (await owner`insert into public.groups (tenant_id, teacher_id, name) values (${ids.B}, ${(await person('teacher', ids.B))}, 'GB') returning id`)[0].id
    await owner`insert into public.group_students (group_id, student_id) values (${ids.gA}, ${ids.sA})`
  }, 120_000)
  afterAll(async () => {
    await owner`delete from public.announcement_events where tenant_id in (${ids.A}, ${ids.B})`
    await owner`delete from public.announcements where tenant_id in (${ids.A}, ${ids.B})`
    await owner`delete from public.groups where tenant_id in (${ids.A}, ${ids.B})`
    await owner`delete from ba."user" where email like ${'%' + tag + '%'}`
    await owner`delete from public.tenants where id in (${ids.A}, ${ids.B})`
    await owner.end()
  }, 90_000)

  it('create: for the whole institution, and for its own groups — never another institution\'s group', async () => {
    as(ids.aA, 'university_admin', ids.A)
    const ok = await call('', 'POST', { title: 'Open day', audience: 'all', is_published: true, collect_interest: true })
    expect(ok.status).toBe(201)
    ids.ann = ok.body.id
    expect((await call('', 'POST', { title: 'X', audience: 'groups', group_ids: [ids.gB], is_published: true })).status).toBe(400)
    expect((await call('', 'POST', { title: 'X', audience: 'groups', group_ids: [ids.gA, ids.gB], is_published: true })).status).toBe(400)
    const grp = await call('', 'POST', { title: 'For GA', audience: 'groups', group_ids: [ids.gA], is_published: true })
    expect(grp.status).toBe(201)
    ids.grpAnn = grp.body.id
    const [g] = await owner`select array_agg(group_id::text) ids from public.announcement_groups where announcement_id = ${ids.grpAnn}`
    expect(g.ids).toEqual([ids.gA])
    const [n] = await owner`select count(*)::int n from public.announcements where tenant_id = ${ids.A}`
    expect(n.n).toBe(2)
  }, 90_000)

  it('a teacher (no announcement capability) and a demoted admin cannot write', async () => {
    as(ids.tA, 'teacher', ids.A)
    expect((await call('', 'POST', { title: 'T', audience: 'all' })).status).toBe(403)
    await owner`update public.users set role = 'teacher' where id = ${ids.aA}`
    as(ids.aA, 'university_admin', ids.A)
    const res = await call('', 'PATCH', { id: ids.ann, title: 'Hijacked' })
    await owner`update public.users set role = 'university_admin' where id = ${ids.aA}`
    expect(res.status).toBe(403)
    const [a] = await owner`select title from public.announcements where id = ${ids.ann}`
    expect(a.title).toBe('Open day')
  }, 90_000)

  it('edit and delete: another institution\'s admin does not find it', async () => {
    as(ids.aB, 'university_admin', ids.B)
    expect((await call('', 'PATCH', { id: ids.ann, title: 'Hijacked' })).status).toBe(404)
    expect((await call('', 'DELETE', { id: ids.ann })).status).toBe(404)
    as(ids.aA, 'university_admin', ids.A)
    expect((await call('', 'PATCH', { id: ids.ann, title: 'Open day 2026', starts_at: '2030-01-02T00:00:00Z', ends_at: '2030-01-01T00:00:00Z' })).status).toBe(400)
    expect((await call('', 'PATCH', { id: ids.ann, title: 'Open day 2026' })).status).toBe(200)
    const [a] = await owner`select title, is_published, collect_interest from public.announcements where id = ${ids.ann}`
    expect(a).toEqual({ title: 'Open day 2026', is_published: true, collect_interest: true })
  }, 90_000)

  it('student events: only on what their own feed shows', async () => {
    as(ids.sA, 'student', ids.A)
    expect((await call('/events', 'POST', { id: ids.ann, kind: 'interest' })).body).toEqual({ ok: true })
    expect((await call('/events', 'POST', { id: ids.ann, kind: 'interest' })).body).toEqual({ ok: true })
    expect((await call('/events', 'POST', { id: ids.grpAnn, kind: 'interest' })).status).toBe(403)
    expect((await call('/events', 'POST', { id: ids.grpAnn, kind: 'view' })).body).toEqual({ ok: true })
    as(ids.sB, 'student', ids.B)
    expect((await call('/events', 'POST', { id: ids.ann, kind: 'view' })).status).toBe(404)
    const rows = await owner`select student_id, kind from public.announcement_events where tenant_id in (${ids.A}, ${ids.B}) order by kind`
    expect(rows).toEqual([{ student_id: ids.sA, kind: 'interest' }, { student_id: ids.sA, kind: 'view' }])
  }, 90_000)

  it('interested students: the institution\'s authors see the name; another institution does not', async () => {
    as(ids.aA, 'university_admin', ids.A)
    const ok = await call('/interested', 'GET', undefined, `?id=${ids.ann}`)
    expect(ok.status).toBe(200)
    expect(ok.body.students).toHaveLength(1)
    expect(ok.body.students[0].id).toBe(ids.sA)
    expect(ok.body.students[0].email).toContain('an-test.test')
    as(ids.aB, 'university_admin', ids.B)
    expect((await call('/interested', 'GET', undefined, `?id=${ids.ann}`)).status).toBe(404)
    as(ids.sA, 'student', ids.A)
    expect((await call('/events', 'DELETE', { id: ids.ann, kind: 'interest' })).body).toEqual({ ok: true })
    as(ids.aA, 'university_admin', ids.A)
    expect((await call('/interested', 'GET', undefined, `?id=${ids.ann}`)).body.students).toHaveLength(0)
  }, 90_000)

  it('delete: the author removes it', async () => {
    as(ids.aA, 'university_admin', ids.A)
    expect((await call('', 'DELETE', { id: ids.grpAnn })).body).toEqual({ success: true })
    const [n] = await owner`select count(*)::int n from public.announcements where id = ${ids.grpAnn}`
    expect(n.n).toBe(0)
  }, 90_000)
})
