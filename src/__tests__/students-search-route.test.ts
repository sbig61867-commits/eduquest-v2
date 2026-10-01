// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Batch 2 / T1 — GET /api/students/search: the server alone decides who may
 * search (a teacher, for a group they teach, in their own institution), an
 * empty search returns nothing, results are capped at 20 and carry only
 * id / full_name / email, and the tenant always comes from the session.
 */

const GROUP = '11111111-1111-4111-8111-111111111111'

type Call = [string, ...unknown[]]
let authUser: { id: string; role?: string; tenant_id?: string | null } | null
let ownedGroup: { id: string } | null
let usersReply: { data: unknown[] | null; error: { message: string } | null }
let calls: Call[][]

function fakeClient() {
  return {
    from(table: string) {
      const c: Call[] = [['from', table]]
      calls.push(c)
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'or', 'order', 'is', 'limit']) {
        chain[m] = (...args: unknown[]) => { c.push([m, ...args]); return chain }
      }
      chain.maybeSingle = () => Promise.resolve({ data: ownedGroup, error: null })
      chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(usersReply).then(resolve)
      return chain
    },
  }
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => fakeClient()),
  getAuthUser: vi.fn(async () => authUser),
}))
vi.mock('@/lib/api-error', () => ({
  apiErr: async (code: string) => ({ error: code, code }),
}))

import { GET } from '@/app/api/students/search/route'

const get = (qs: string) => GET(new Request(`http://localhost/api/students/search?${qs}`))
const TEACHER = { id: 'teacher-1', role: 'teacher', tenant_id: 'tenant-a' }

beforeEach(() => {
  authUser = TEACHER
  ownedGroup = { id: GROUP }
  usersReply = { data: [], error: null }
  calls = []
})

describe('GET /api/students/search — who may search', () => {
  it('401 without a session', async () => {
    authUser = null
    expect((await get(`q=sara&group_id=${GROUP}`)).status).toBe(401)
  })

  it('403 for every role but teacher — students, admins, centre managers, the owner', async () => {
    for (const role of ['student', 'university_admin', 'center_manager', 'super_admin', undefined]) {
      authUser = { id: 'u', role, tenant_id: 'tenant-a' }
      const res = await get(`q=sara&group_id=${GROUP}`)
      expect(res.status).toBe(403)
    }
    expect(calls).toHaveLength(0) // refused before any read
  })

  it('403 for a teacher without an institution', async () => {
    authUser = { id: 't', role: 'teacher', tenant_id: null }
    expect((await get(`q=sara&group_id=${GROUP}`)).status).toBe(403)
  })

  it('404 for a group the teacher does not teach (or of another institution) — and no rows leak', async () => {
    ownedGroup = null
    usersReply = { data: [{ id: 's1', full_name: 'Sara', email: 's@x.test' }], error: null }
    const res = await get(`q=sara&group_id=${GROUP}`)
    expect(res.status).toBe(404)
    expect(JSON.stringify(await res.json())).not.toContain('Sara')
    const groupQ = calls.find(c => c[0][1] === 'groups')!
    expect(groupQ).toContainEqual(['eq', 'id', GROUP])
    expect(groupQ).toContainEqual(['eq', 'teacher_id', 'teacher-1'])
    expect(groupQ).toContainEqual(['eq', 'tenant_id', 'tenant-a'])
  })
})

describe('GET /api/students/search — input', () => {
  it('400 when q is empty, blank or only wildcards — and nothing is read', async () => {
    for (const q of ['', '%20%20', '%25', '*', '%22%5C']) {
      const res = await get(`q=${q}&group_id=${GROUP}`)
      expect(res.status).toBe(400)
      expect((await res.json()).code).toBe('searchQueryRequired')
    }
    const res = await get(`group_id=${GROUP}`)
    expect(res.status).toBe(400)
    expect(calls).toHaveLength(0)
  })

  it('400 when group_id is missing or not a uuid (no filter text reaches the database)', async () => {
    for (const g of ['', 'abc', `${GROUP},or(id.neq.0)`]) {
      const res = await get(`q=sara&group_id=${encodeURIComponent(g)}`)
      expect(res.status).toBe(400)
    }
    expect(calls).toHaveLength(0)
  })
})

describe('GET /api/students/search — results', () => {
  it('searches only students of the caller’s own institution, ignoring a tenant_id in the URL', async () => {
    await get(`q=sara&group_id=${GROUP}&tenant_id=tenant-b`)
    const usersQ = calls.find(c => c[0][1] === 'users')!
    expect(usersQ).toContainEqual(['eq', 'tenant_id', 'tenant-a'])
    expect(usersQ).not.toContainEqual(['eq', 'tenant_id', 'tenant-b'])
    expect(usersQ).toContainEqual(['eq', 'role', 'student'])
    expect(usersQ).toContainEqual(['eq', 'is_active', true])
    expect(usersQ).toContainEqual(['limit', 20])
  })

  it('returns at most 20 students with only id / full_name / email', async () => {
    usersReply = {
      data: Array.from({ length: 30 }, (_, i) => ({
        id: `s${i}`, full_name: `S ${i}`, email: `s${i}@x.test`, group_students: [], role: 'student', is_active: true,
      })),
      error: null,
    }
    const res = await get(`q=s&group_id=${GROUP}`)
    expect(res.status).toBe(200)
    const { students } = await res.json()
    expect(students).toHaveLength(20)
    for (const s of students) expect(Object.keys(s).sort()).toEqual(['email', 'full_name', 'id'])
  })

  it('an injection attempt is one quoted literal; the role/tenant conditions stay separate', async () => {
    await get(`q=${encodeURIComponent('x"),or(role.eq.teacher')}&group_id=${GROUP}`)
    const usersQ = calls.find(c => c[0][1] === 'users')!
    const or = usersQ.filter(c => c[0] === 'or')
    expect(or).toHaveLength(1)
    expect(String(or[0][1])).toMatch(/^full_name\.ilike\."%x \),or\(role\.eq\.teacher%",email\.ilike\."%x \),or\(role\.eq\.teacher%"$/)
    expect(usersQ).toContainEqual(['eq', 'role', 'student'])
  })

  it('500 (no data) when the database refuses', async () => {
    usersReply = { data: null, error: { message: 'boom' } }
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
