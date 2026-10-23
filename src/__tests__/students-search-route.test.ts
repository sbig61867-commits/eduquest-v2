// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * GET /api/students/search (Batch 2 / T1): only a teacher, only for a group
 * they teach in their own institution; at most 20 active students of that
 * institution matching q, minus the group's members. Step 9: read as the
 * teacher in ONE unit — the ownership check and the search together; the
 * rows are discarded unless the group is theirs.
 */

const GROUP = '11111111-1111-4111-8111-111111111111'

type Call = [string, ...unknown[]]
type Q = { text: string; values: unknown[]; ctx: { as: string; userId?: string } }
let ctx: { sub: string; role: string; tenant_id: string | null } | null
let ownsGroup: boolean
let searchRows: unknown[] | Error
let sql: Q[]

vi.mock('@/lib/auth/current', () => ({ currentCtx: async () => ctx }))
vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))
vi.mock('@/lib/db/sql', async () => (await import('./helpers/fake-sql')).fakeSqlModule(q => {
  sql.push(q as Q)
  if (q.text.startsWith('select id from public.groups')) return ownsGroup ? [{ id: GROUP }] : []
  if (q.text.startsWith('select u.id, u.full_name, u.email from public.users u')) {
    if (searchRows instanceof Error) return searchRows
    return searchRows.slice(0, q.values.at(-1) as number)
  }
  return new Error('unexpected statement: ' + q.text)
}))

import { GET } from '@/app/api/students/search/route'

const get = (qs: string) => GET(new Request(`http://x/api/students/search?${qs}`))
const search = () => sql.find(q => q.text.startsWith('select u.id, u.full_name, u.email'))

beforeEach(() => {
  ctx = { sub: 'teacher-1', role: 'teacher', tenant_id: 'tenant-a' }
  ownsGroup = true
  searchRows = []
  sql = []
})

describe('GET /api/students/search — who may search', () => {
  it('401 without a session', async () => {
    ctx = null
    expect((await get(`q=sara&group_id=${GROUP}`)).status).toBe(401)
  })

  it('403 for every role but teacher — students, admins, centre managers, the owner', async () => {
    for (const role of ['student', 'university_admin', 'center_manager', 'super_admin']) {
      ctx = { sub: 'x', role, tenant_id: 'tenant-a' }
      expect((await get(`q=sara&group_id=${GROUP}`)).status).toBe(403)
    }
    expect(sql).toHaveLength(0)
  })

  it('403 for a teacher without an institution', async () => {
    ctx = { sub: 'teacher-1', role: 'teacher', tenant_id: null }
    expect((await get(`q=sara&group_id=${GROUP}`)).status).toBe(403)
  })

  it('404 for a group the teacher does not teach (or of another institution) — and no rows leak', async () => {
    ownsGroup = false
    searchRows = [{ id: 's1', full_name: 'Must not leak', email: 'x@x.test' }]
    const res = await get(`q=sara&group_id=${GROUP}`)
    expect(res.status).toBe(404)
    expect(JSON.stringify(await res.json())).not.toContain('Must not leak')
  })
})

describe('GET /api/students/search — input', () => {
  it('400 when q is empty, blank or only wildcards — and nothing is read', async () => {
    for (const q of ['', '%20%20', '%25', '*']) expect((await get(`q=${q}&group_id=${GROUP}`)).status).toBe(400)
    expect(sql).toHaveLength(0)
  })

  it('400 when group_id is missing or not a uuid (no filter text reaches the database)', async () => {
    for (const g of ['', 'abc', `${GROUP},x`]) expect((await get(`q=sara&group_id=${g}`)).status).toBe(400)
    expect(sql).toHaveLength(0)
  })
})

describe('GET /api/students/search — results', () => {
  it('searches only students of the caller’s own institution, ignoring a tenant_id in the URL — read as the teacher', async () => {
    await get(`q=sara&group_id=${GROUP}&tenant_id=tenant-b`)
    expect(sql.every(q => q.ctx.as === 'user' && q.ctx.userId === 'teacher-1')).toBe(true)
    expect(sql[0].values).toEqual([GROUP, 'teacher-1', 'tenant-a'])
    expect(search()!.values).toEqual(['tenant-a', '%sara%', '%sara%', GROUP, 20])
    expect(JSON.stringify(sql)).not.toContain('tenant-b')
  })

  it('returns at most 20 students with only id / full_name / email', async () => {
    searchRows = Array.from({ length: 30 }, (_, i) => ({ id: `s${i}`, full_name: `S ${i}`, email: `s${i}@x.test` }))
    const { students } = await (await get(`q=s&group_id=${GROUP}`)).json()
    expect(students).toHaveLength(20)
    for (const s of students) expect(Object.keys(s).sort()).toEqual(['email', 'full_name', 'id'])
  })

  it('an injection attempt is one literal; the role/tenant conditions stay separate', async () => {
    await get(`q=${encodeURIComponent('x"),or(role.eq.teacher')}&group_id=${GROUP}`)
    expect(search()!.values[1]).toBe('%x ),or(role.eq.teacher%')
    expect(search()!.text).toContain("u.role = 'student'")
  })

  it('500 (no data) when the database refuses', async () => {
    searchRows = new Error('boom')
    const res = await get(`q=sara&group_id=${GROUP}`)
    expect(res.status).toBe(500)
    expect((await res.json()).students).toBeUndefined()
  })
})

describe('/teacher/groups page — the institution student list is no longer read', () => {
  it('reads only the teacher profile and their own groups; no student list reaches the client props', async () => {
    vi.resetModules()
    const reads: Call[][] = []
    const client = {
      from(table: string) {
        const c: Call[] = [['from', table]]
        reads.push(c)
        const chain: Record<string, unknown> = {}
        for (const m of ['select', 'eq', 'order', 'in', 'is', 'limit']) {
          chain[m] = (...args: unknown[]) => { c.push([m, ...args]); return chain }
        }
        chain.single = () => Promise.resolve({ data: { tenant_id: 'tenant-a', role: 'teacher' }, error: null })
        chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve)
        return chain
      },
    }
    vi.doMock('@/lib/supabase/server', () => ({
      createClient: vi.fn(async () => client),
      getAuthUser: vi.fn(async () => ({ id: 'teacher-1', role: 'teacher', tenant_id: 'tenant-a' })),
    }))
    vi.doMock('next/navigation', () => ({ redirect: vi.fn() }))
    vi.doMock('@/app/(teacher)/teacher/groups/groups-client', () => ({ GroupsClient: () => null }))
    const { default: GroupsPage } = await import('@/app/(teacher)/teacher/groups/page')
    const element = await GroupsPage() as { props: Record<string, unknown> }

    const userReads = reads.filter(c => c[0][1] === 'users')
    expect(userReads).toHaveLength(1) // the teacher's own profile only
    expect(userReads[0]).toContainEqual(['eq', 'id', 'teacher-1'])
    expect(reads.flat().some(c => c[0] === 'eq' && c[1] === 'role' && c[2] === 'student')).toBe(false)
    expect(Object.keys(element.props)).not.toContain('tenantStudents')
  })
})
