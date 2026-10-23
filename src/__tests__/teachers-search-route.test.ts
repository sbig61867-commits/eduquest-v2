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
// The search runs on the SQL layer (step 9): each statement is recorded, and
// answered with the selected columns of `searchReply` (or the error).
const sqlCalls = vi.hoisted(() => [] as { text: string; values: unknown[]; ctx: { as: string; userId?: string } }[])
vi.mock('@/lib/db/sql', async () => (await import('./helpers/fake-sql')).fakeSqlModule(q => {
  sqlCalls.push(q)
  if (searchReply.error) return new Error(searchReply.error.message)
  return (searchReply.data ?? []).slice(0, q.values.at(-1) as number)
    .map(r => ({ id: (r as { id: string }).id, full_name: (r as { full_name: string }).full_name }))
}))
vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))
// getCaller reads the caller's live row on the SQL layer (step 9): answered
// here from the same profile — no session 401; no institution or disabled 403.
vi.mock('@/lib/staff-auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/staff-auth')>('@/lib/staff-auth')
  const { NextResponse } = await vi.importActual<typeof import('next/server')>('next/server')
  return {
    ...actual,
    getCaller: async () => {
      if (!authUser) return { error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) }
      if (!profile?.tenant_id || profile.is_active === false) return { error: NextResponse.json({ error: 'forbidden' }, { status: 403 }) }
      return { caller: { id: authUser.id, role: profile.role, tenant_id: profile.tenant_id, permissions: profile.permissions } }
    },
  }
})

import { GET } from '@/app/api/teachers/search/route'

const get = (qs: string) => GET(new Request(`http://localhost/api/teachers/search?${qs}`))
const MANAGER = (permissions: Record<string, unknown>): Profile =>
  ({ role: 'center_manager', tenant_id: 'tenant-a', permissions, is_active: true })
// The teacher search itself — not getCaller's own-profile read.
const searchCalls = () => sqlCalls

beforeEach(() => {
  authUser = { id: 'manager-1' }
  profile = MANAGER({ manage_groups: true, manage_courses: true })
  searchReply = { data: [], error: null }
  calls = []
  sqlCalls.length = 0
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
    expect(q.ctx).toEqual({ as: 'user', userId: 'manager-1' })
    expect(q.text).toContain("where tenant_id = $ and role = 'teacher' and is_active and full_name ilike $")
    expect(q.values).toEqual(['tenant-a', '%sara%', 20])
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
    // a bound parameter: the text of the statement is the same whatever q holds
    expect(q.values).toEqual(['tenant-a', '%x ),or(role.eq.student%', 20])
    expect(q.text).not.toContain('student')
  })

  it('500 (no data) when the database refuses', async () => {
    searchReply = { data: null, error: { message: 'boom' } }
    const res = await get('for=groups&q=sara')
    expect(res.status).toBe(500)
    expect((await res.json()).teachers).toBeUndefined()
  })
})
