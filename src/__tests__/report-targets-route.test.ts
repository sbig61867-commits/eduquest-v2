// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Batch 2 / R1 — GET /api/admin/report-targets and searchReportTargets
 * (src/lib/data/report-targets.ts). Owner only (role read from the database,
 * like the page); scoped to the chosen institution; ≤ 20 rows of the picker's
 * fields; no write, no service-role client. Plus: the page reads only the
 * institutions.
 */

const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

type Call = [string, ...unknown[]]
let calls: Call[][]
let reply: { data?: unknown[] | null; error?: { message: string } | null }
let profile: { role: string } | null
let signedIn: boolean

function sessionClient() {
  return {
    auth: {
      getUser: async () => ({ data: { user: signedIn ? { id: 'me' } : null } }),
      getClaims: async () => ({ data: signedIn ? { claims: { sub: 'me', app_metadata: { user_role: profile?.role } } } : null }),
    },
    from(table: string) {
      const c: Call[] = [['from', table]]
      calls.push(c)
      const ch: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'or', 'ilike', 'order', 'limit', 'neq', 'in', 'is']) ch[m] = (...a: unknown[]) => { c.push([m, ...a]); return ch }
      ch.single = async () => { c.push(['single']); return { data: table === 'users' ? profile : null, error: null } }
      ch.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null, ...reply }).then(resolve)
      return ch
    },
  }
}

const createAdmin = vi.fn()
vi.mock('@supabase/supabase-js', () => ({ createClient: (...a: unknown[]) => createAdmin(...a) }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => sessionClient()),
  getAuthUser: vi.fn(async () => (signedIn ? { id: 'me', role: profile?.role } : null)),
}))
vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))
const redirect = vi.fn((to: string) => { throw new Error('REDIRECT ' + to) })
vi.mock('next/navigation', () => ({ redirect: (to: string) => redirect(to) }))

import { searchReportTargets, REPORT_TARGET_LIMIT } from '@/lib/data/report-targets'
import { GET } from '@/app/api/admin/report-targets/route'

const person = (i: number) => ({ id: `u${i}`, full_name: `Person ${i}`, email: `p${i}@x.test`, role: 'student', permissions: { secret: true } })
const searches = () => calls.filter(c => c[0][1] !== 'users' || !c.some(x => x[0] === 'single'))
const get = (qs: string) => GET(new Request(`http://x/api/admin/report-targets?${qs}`))

beforeEach(() => {
  calls = []
  reply = {}
  profile = { role: 'super_admin' }
  signedIn = true
  createAdmin.mockReset()
})

describe('searchReportTargets', () => {
  it('students/teachers: ONE institution, the role, name OR email, ordered, ≤ 20, any status (as the old list)', async () => {
    reply = { data: Array.from({ length: 25 }, (_, i) => person(i)) }
    const { rows, error } = await searchReportTargets(sessionClient() as never, TENANT, 'student', '  huda  ')
    expect(error).toBeNull()
    const q = calls[0]
    expect(q).toContainEqual(['from', 'users'])
    expect(q).toContainEqual(['select', 'id, full_name, email'])
    expect(q).toContainEqual(['eq', 'tenant_id', TENANT])
    expect(q).toContainEqual(['eq', 'role', 'student'])
    expect(q).toContainEqual(['or', 'full_name.ilike."%huda%",email.ilike."%huda%"'])
    expect(q).toContainEqual(['order', 'full_name', { ascending: true }])
    expect(q).toContainEqual(['order', 'id', { ascending: true }])
    expect(q).toContainEqual(['limit', REPORT_TARGET_LIMIT])
    expect(q.some(x => x[0] === 'eq' && x[1] === 'is_active')).toBe(false)
    // capped, and only the picker's fields (role/permissions never leave)
    expect(rows).toHaveLength(20)
    expect(rows[0]).toEqual({ id: 'u0', label: 'Person 0', email: 'p0@x.test' })
  })

  it('teachers use role=teacher', async () => {
    await searchReportTargets(sessionClient() as never, TENANT, 'teacher', 'a')
    expect(calls[0]).toContainEqual(['eq', 'role', 'teacher'])
  })

  it('groups: ONE institution, by name, id + name only, ≤ 20', async () => {
    reply = { data: Array.from({ length: 30 }, (_, i) => ({ id: `g${i}`, name: `Group ${i}`, tenant_id: TENANT, teacher_id: 't' })) }
    const { rows } = await searchReportTargets(sessionClient() as never, TENANT, 'group', 'Group 1')
    const q = calls[0]
    expect(q).toContainEqual(['from', 'groups'])
    expect(q).toContainEqual(['select', 'id, name'])
    expect(q).toContainEqual(['eq', 'tenant_id', TENANT])
    expect(q).toContainEqual(['ilike', 'name', '%Group 1%'])
    expect(q).toContainEqual(['limit', REPORT_TARGET_LIMIT])
    expect(rows).toHaveLength(20)
    expect(rows[0]).toEqual({ id: 'g0', label: 'Group 0' })
  })

  it('filter syntax and wildcards are neutralised; an empty / wildcard-only query touches no table', async () => {
    await searchReportTargets(sessionClient() as never, TENANT, 'student', 'a"),role.eq.super_admin,(x%*')
    expect(calls[0]).toContainEqual(['or', 'full_name.ilike."%a ),role.eq.super_admin,(x%",email.ilike."%a ),role.eq.super_admin,(x%"'])
    calls = []
    expect((await searchReportTargets(sessionClient() as never, TENANT, 'group', ' %* ')).rows).toEqual([])
    expect(calls).toHaveLength(0)
  })

  it('a database error is returned, with no rows', async () => {
    reply = { error: { message: 'boom' } }
    expect(await searchReportTargets(sessionClient() as never, TENANT, 'group', 'g')).toEqual({ rows: [], error: { message: 'boom' } })
  })
})

describe('GET /api/admin/report-targets', () => {
  it('signed out → 401, nothing searched', async () => {
    signedIn = false
    expect((await get(`kind=student&tenant_id=${TENANT}&q=a`)).status).toBe(401)
    expect(calls).toHaveLength(0)
  })

  it.each(['university_admin', 'center_manager', 'teacher', 'student'])('%s → 403 before any search', async role => {
    profile = { role }
    const res = await get(`kind=student&tenant_id=${TENANT}&q=a`)
    expect(res.status).toBe(403)
    expect(calls.every(c => c.some(x => x[0] === 'single'))).toBe(true)   // only the caller's own profile
  })

  it('no profile row → 403', async () => {
    profile = null
    expect((await get(`kind=group&tenant_id=${TENANT}&q=a`)).status).toBe(403)
  })

  it.each([
    ['unknown kind', `kind=admin&tenant_id=${TENANT}&q=a`],
    ['no kind', `tenant_id=${TENANT}&q=a`],
    ['no institution', 'kind=student&q=a'],
    ['malformed institution', 'kind=student&tenant_id=abc&q=a'],
    ['injected institution', `kind=student&tenant_id=${TENANT},tenant_id.neq.x&q=a`],
    ['empty query', `kind=student&tenant_id=${TENANT}&q=`],
    ['wildcard-only query', `kind=student&tenant_id=${TENANT}&q=%25*`],
  ])('%s → 400, nothing searched', async (_n, qs) => {
    expect((await get(qs)).status).toBe(400)
    expect(searches()).toHaveLength(0)
  })

  it('owner → 200 { results } from the chosen institution, ≤ 20, on the session (never the service role)', async () => {
    reply = { data: Array.from({ length: 22 }, (_, i) => person(i)) }
    const res = await get(`kind=student&tenant_id=${TENANT}&q=Person`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Object.keys(body)).toEqual(['results'])
    expect(body.results).toHaveLength(20)
    expect(Object.keys(body.results[0]).sort()).toEqual(['email', 'id', 'label'])
    expect(searches()[0]).toContainEqual(['eq', 'tenant_id', TENANT])
    expect(createAdmin).not.toHaveBeenCalled()
    // read-only: no write method was ever called
    expect(calls.flat().some(x => ['insert', 'update', 'upsert', 'delete', 'rpc'].includes(x[0] as string))).toBe(false)
  })

  it('a database error → 500', async () => {
    reply = { error: { message: 'boom' } }
    expect((await get(`kind=group&tenant_id=${TENANT}&q=g`)).status).toBe(500)
  })
})

describe('/super-admin/reports page', () => {
  it('reads only the institutions — no teachers, students or groups', async () => {
    const { default: Page } = await import('@/app/(super-admin)/super-admin/reports/page')
    const el = await Page() as { props: Record<string, unknown> }
    expect(Object.keys(el.props)).toEqual(['tenants'])
    const reads = calls.filter(c => !c.some(x => x[0] === 'single')).map(c => c[0][1])
    expect(reads).toEqual(['tenants'])
  })

  it('a non-owner is redirected before anything is read', async () => {
    profile = { role: 'university_admin' }
    const { default: Page } = await import('@/app/(super-admin)/super-admin/reports/page')
    await expect(Page()).rejects.toThrow('REDIRECT /login')
    expect(calls.filter(c => !c.some(x => x[0] === 'single'))).toHaveLength(0)
  })
})
