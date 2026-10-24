// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Batch 2 / R1 — GET /api/admin/report-targets and searchReportTargetsAs
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
// The route searches on the SQL layer (step 9), as the owner: every statement is
// recorded with its context; the answer is the same `reply` the session gets.
const db = vi.hoisted(() => ({ sql: [] as { text: string; values: unknown[]; ctx: { as: string } }[] }))
vi.mock('@/lib/db/sql', async () => (await import('./helpers/fake-sql')).fakeSqlModule(q => {
  db.sql.push(q)
  // the page's owner check reads the caller's live role; the rest of the statements are the search's
  if (q.text.startsWith('select role from public.users')) return [{ role: profile?.role ?? null }]
  if (reply.error) return new Error(reply.error.message)
  return (reply.data ?? []) as unknown[]
}))
vi.mock('@/lib/auth/current', async () => ({
  ...(await vi.importActual<object>('@/lib/auth/current')),
  currentUser: async () => (signedIn ? { id: 'me', role: profile?.role ?? null, tenant_id: null } : null),
  currentCtx: async () => (signedIn ? { sub: 'me', role: profile?.role ?? null, tenant_id: null, email: null, is_active: true, must_change_password: false } : null),
}))
vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))
const redirect = vi.fn((to: string) => { throw new Error('REDIRECT ' + to) })
vi.mock('next/navigation', () => ({ redirect: (to: string) => redirect(to) }))

import { searchReportTargetsAs, REPORT_TARGET_LIMIT } from '@/lib/data/report-targets'
import { GET } from '@/app/api/admin/report-targets/route'

const person = (i: number) => ({ id: `u${i}`, full_name: `Person ${i}`, email: `p${i}@x.test`, role: 'student', permissions: { secret: true } })
const searches = () => db.sql
const get = (qs: string) => GET(new Request(`http://x/api/admin/report-targets?${qs}`))

beforeEach(() => {
  calls = []
  db.sql = []
  reply = {}
  profile = { role: 'super_admin' }
  signedIn = true
  createAdmin.mockReset()
})

describe('searchReportTargetsAs', () => {
  it('students/teachers: ONE institution, the role, name OR email, ordered, ≤ 20, any status (as the old list), as the owner', async () => {
    reply = { data: [person(1)] }
    const rows = await searchReportTargetsAs('me', TENANT, 'student', '  huda  ')
    const [q] = searches()
    expect(q.ctx).toEqual({ as: 'user', userId: 'me' })
    expect(q.text).toContain('where tenant_id = $ and role = $ and (full_name ilike $ or email ilike $)')
    expect(q.text).toContain('order by full_name, id limit $')
    expect(q.text).not.toContain('is_active')
    expect(q.values).toEqual([TENANT, 'student', '%huda%', '%huda%', REPORT_TARGET_LIMIT])
    expect(rows).toEqual([{ id: 'u1', label: 'Person 1', email: 'p1@x.test' }])
  })

  it('teachers use role=teacher', async () => {
    await searchReportTargetsAs('me', TENANT, 'teacher', 'a')
    expect(searches()[0].values[1]).toBe('teacher')
  })

  it('groups: ONE institution, by name, id + name only, ≤ 20', async () => {
    reply = { data: [{ id: 'g1', name: 'Group 1' }] }
    const rows = await searchReportTargetsAs('me', TENANT, 'group', 'Group 1')
    const [q] = searches()
    expect(q.text).toMatch(/^select id, name from public\.groups where tenant_id = \$ and name ilike \$/)
    expect(q.values).toEqual([TENANT, '%Group 1%', REPORT_TARGET_LIMIT])
    expect(rows).toEqual([{ id: 'g1', label: 'Group 1' }])
  })

  it('the term is a bound parameter with wildcards removed; an empty / wildcard-only query touches no table', async () => {
    await searchReportTargetsAs('me', TENANT, 'student', 'a"),role.eq.super_admin,(x%*')
    const [q] = searches()
    expect(q.text).not.toContain('super_admin')
    expect(q.values[2]).toBe('%a ),role.eq.super_admin,(x%')
    db.sql = []
    expect(await searchReportTargetsAs('me', TENANT, 'group', ' %* ')).toEqual([])
    expect(searches()).toHaveLength(0)
  })

  it('a database error is thrown to the route (which answers 500), never an empty success', async () => {
    reply = { error: { message: 'boom' } }
    await expect(searchReportTargetsAs('me', TENANT, 'group', 'g')).rejects.toThrow('boom')
  })
})

describe('GET /api/admin/report-targets', () => {
  it('signed out → 401, nothing searched', async () => {
    signedIn = false
    expect((await get(`kind=student&tenant_id=${TENANT}&q=a`)).status).toBe(401)
    expect(searches()).toHaveLength(0)
  })

  it.each(['university_admin', 'center_manager', 'teacher', 'student'])('%s → 403 before any search', async role => {
    profile = { role }
    const res = await get(`kind=student&tenant_id=${TENANT}&q=a`)
    expect(res.status).toBe(403)
    expect(searches()).toHaveLength(0)
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

  it('owner → 200 { results } from the chosen institution, ≤ 20, as the owner (never the service scope)', async () => {
    reply = { data: Array.from({ length: 20 }, (_, i) => person(i)) }
    const res = await get(`kind=student&tenant_id=${TENANT}&q=Person`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Object.keys(body)).toEqual(['results'])
    expect(body.results).toHaveLength(20)
    expect(Object.keys(body.results[0]).sort()).toEqual(['email', 'id', 'label'])
    const [q] = searches()
    expect(q.ctx).toEqual({ as: 'user', userId: 'me' })
    expect(q.text).toMatch(/^select id, full_name, email from public\.users where tenant_id = \$ and role = \$ .* limit \$$/)
    expect(q.values).toEqual([TENANT, 'student', '%Person%', '%Person%', 20])
    expect(createAdmin).not.toHaveBeenCalled()
    // read-only: one select, nothing written
    expect(searches().every(x => x.text.startsWith('select '))).toBe(true)
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
    const texts = searches().map(q => q.text)
    expect(texts.some(x => x.includes('from public.tenants'))).toBe(true)
    expect(texts.filter(x => !x.startsWith('select role from public.users') && /from public\.(users|groups|lessons)\b/.test(x))).toEqual([])
  })

  it('a non-owner is redirected before the institutions are read', async () => {
    profile = { role: 'university_admin' }
    const { default: Page } = await import('@/app/(super-admin)/super-admin/reports/page')
    await expect(Page()).rejects.toThrow('REDIRECT /login')
    expect(searches().some(x => x.text.includes('from public.tenants'))).toBe(false)
  })
})
