// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Batch 2 / C-T — GET /api/teachers/search: the server alone decides who may
 * search (an active staff account of an institution holding the capability of
 * the screen it assigns from: manage_groups for /center/groups, manage_courses
 * for /center/courses — the same gate the save uses), an empty search returns
 * nothing, results are capped at 20 with only id / full_name, and the
 * institution always comes from the caller's profile.
 */

type Call = [string, ...unknown[]]
type Profile = { role: string; tenant_id: string | null; permissions: Record<string, unknown> | null; is_active?: boolean }
let authUser: { id: string } | null
let profile: Profile | null
let searchReply: { data: unknown[] | null; error: { message: string } | null }
let calls: Call[][]

function fakeClient() {
  return {
    auth: { getUser: async () => ({ data: { user: authUser } }) },
    from(table: string) {
      const c: Call[] = [['from', table]]
      calls.push(c)
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'or', 'order', 'is', 'limit', 'ilike']) {
        chain[m] = (...args: unknown[]) => { c.push([m, ...args]); return chain }
      }
      chain.single = () => Promise.resolve({ data: profile, error: null }) // getCaller's own profile
      chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(searchReply).then(resolve)
      return chain
    },
  }
}

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => fakeClient()) }))
vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))

import { GET } from '@/app/api/teachers/search/route'

const get = (qs: string) => GET(new Request(`http://localhost/api/teachers/search?${qs}`))
const MANAGER = (permissions: Record<string, unknown>): Profile =>
  ({ role: 'center_manager', tenant_id: 'tenant-a', permissions, is_active: true })
// The teacher search itself — not getCaller's own-profile read.
const searchCalls = () => calls.filter(c => c.some(x => x[0] === 'eq' && x[1] === 'role'))

beforeEach(() => {
  authUser = { id: 'manager-1' }
  profile = MANAGER({ manage_groups: true, manage_courses: true })
  searchReply = { data: [], error: null }
  calls = []
})

describe('GET /api/teachers/search — who may search', () => {
  it('401 without a session', async () => {
    authUser = null
    expect((await get('for=groups&q=sara')).status).toBe(401)
  })

  it('403 for an account without an institution (the owner) or a disabled account', async () => {
    profile = { role: 'super_admin', tenant_id: null, permissions: null }
    expect((await get('for=groups&q=sara')).status).toBe(403)
    profile = { ...MANAGER({ manage_groups: true }), is_active: false }
    expect((await get('for=groups&q=sara')).status).toBe(403)
    expect(searchCalls()).toHaveLength(0)
  })

  it('403 for teachers and students, whatever flags their row carries', async () => {
    for (const role of ['teacher', 'student']) {
      profile = { role, tenant_id: 'tenant-a', permissions: { manage_groups: true, manage_courses: true }, is_active: true }
      expect((await get('for=groups&q=sara')).status).toBe(403)
      expect((await get('for=courses&q=sara')).status).toBe(403)
    }
    expect(searchCalls()).toHaveLength(0)
  })

  it('a centre manager needs the capability of THAT screen — no more access than today', async () => {
    profile = MANAGER({})
    expect((await get('for=groups&q=sara')).status).toBe(403)
    expect((await get('for=courses&q=sara')).status).toBe(403)
    profile = MANAGER({ manage_courses: true })
    expect((await get('for=groups&q=sara')).status).toBe(403)
    expect((await get('for=courses&q=sara')).status).toBe(200)
    profile = MANAGER({ manage_groups: true })
    expect((await get('for=groups&q=sara')).status).toBe(200)
    expect((await get('for=courses&q=sara')).status).toBe(403)
    profile = MANAGER({ manage_teachers: true, manage_students: true })
    expect((await get('for=groups&q=sara')).status).toBe(403)
  })

  it('an institution admin follows the same flags (default ON, owner may switch off)', async () => {
    profile = { role: 'university_admin', tenant_id: 'tenant-a', permissions: {}, is_active: true }
    expect((await get('for=groups&q=sara')).status).toBe(200)
    profile = { role: 'university_admin', tenant_id: 'tenant-a', permissions: { manage_groups: false }, is_active: true }
    expect((await get('for=groups&q=sara')).status).toBe(403)
  })
})

describe('GET /api/teachers/search — input', () => {
  it('400 when the screen (for=) is missing or unknown — before any search', async () => {
    for (const qs of ['q=sara', 'for=&q=sara', 'for=students&q=sara', 'for=groups,courses&q=sara']) {
      expect((await get(qs)).status).toBe(400)
    }
    expect(searchCalls()).toHaveLength(0)
  })

  it('400 when q is empty, blank or only wildcards — and no search runs', async () => {
    for (const q of ['', '%20%20', '%25', '*', '%22%5C']) {
      const res = await get(`for=groups&q=${q}`)
      expect(res.status).toBe(400)
      expect((await res.json()).code).toBe('searchQueryRequired')
    }
    expect((await get('for=groups')).status).toBe(400)
    expect(searchCalls()).toHaveLength(0)
  })
})

describe('GET /api/teachers/search — results', () => {
  it('searches only active teachers of the caller’s own institution, ignoring a tenant_id in the URL', async () => {
    await get('for=groups&q=sara&tenant_id=tenant-b')
    const q = searchCalls()[0]
    expect(q).toContainEqual(['eq', 'tenant_id', 'tenant-a'])
    expect(q).not.toContainEqual(['eq', 'tenant_id', 'tenant-b'])
    expect(q).toContainEqual(['eq', 'role', 'teacher'])
    expect(q).toContainEqual(['eq', 'is_active', true])
    expect(q).toContainEqual(['ilike', 'full_name', '%sara%'])
    expect(q).toContainEqual(['limit', 20])
  })

  it('returns at most 20 teachers with only id / full_name (no email)', async () => {
    searchReply = {
      data: Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, full_name: `T ${i}`, email: `t${i}@x.test`, role: 'teacher', is_active: true })),
      error: null,
    }
    const res = await get('for=courses&q=t')
    expect(res.status).toBe(200)
    const { teachers } = await res.json()
    expect(teachers).toHaveLength(20)
    for (const t of teachers) expect(Object.keys(t).sort()).toEqual(['full_name', 'id'])
  })

  it('an injection attempt is one literal name pattern; it adds no condition', async () => {
    await get(`for=groups&q=${encodeURIComponent('x"),or(role.eq.student')}`)
    const q = searchCalls()[0]
    expect(q.filter(c => c[0] === 'ilike')).toEqual([['ilike', 'full_name', '%x ),or(role.eq.student%']])
    expect(q.some(c => c[0] === 'or')).toBe(false)
    expect(q).toContainEqual(['eq', 'role', 'teacher'])
  })

  it('500 (no data) when the database refuses', async () => {
    searchReply = { data: null, error: { message: 'boom' } }
    const res = await get('for=groups&q=sara')
    expect(res.status).toBe(500)
    expect((await res.json()).teachers).toBeUndefined()
  })
})
