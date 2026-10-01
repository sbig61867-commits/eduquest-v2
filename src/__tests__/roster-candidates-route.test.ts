// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Batch 2 / C-S — GET /api/roster/candidates: who may search a target's
 * candidates = who may add to it (owner's decision). The gate is checked here
 * scenario by scenario AND for parity against the membership routes, whose
 * GET runs the very gate the add uses (/api/group-students resolveGroupOwnership,
 * /api/course-enrollments authorize). Results: ≤ 20 active students by NAME,
 * id + name only, the target's members left out, institution from the profile.
 */

const GROUP = '11111111-1111-4111-8111-111111111111'
const COURSE = '22222222-2222-4222-8222-222222222222'

type Call = [string, ...unknown[]]
type Profile = { role: string; tenant_id: string | null; permissions: Record<string, unknown> | null }
let authUser: { id: string } | null
let profile: Profile | null
let group: { id: string; teacher_id: string; tenant_id: string } | null
let course: { id: string; teacher_id: string; tenant_id: string } | null
let searchReply: { data: unknown[] | null; error: { message: string } | null }
let userCalls: Call[][]

function chain(calls: Call[][], table: string, terminal: Record<string, () => Promise<unknown>>, thenReply: () => unknown) {
  const c: Call[] = [['from', table]]
  calls.push(c)
  const ch: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'or', 'order', 'is', 'limit', 'in', 'ilike']) {
    ch[m] = (...args: unknown[]) => { c.push([m, ...args]); return ch }
  }
  Object.assign(ch, terminal)
  ch.then = (resolve: (v: unknown) => unknown) => Promise.resolve(thenReply()).then(resolve)
  return ch
}

// The caller's session client: identity, own profile, and the search itself.
const userClient = () => ({
  auth: { getUser: async () => ({ data: { user: authUser } }) },
  from: (table: string) => chain(userCalls, table, { single: async () => ({ data: profile, error: null }) }, () => searchReply),
})
// The service-role client: target lookups only (and the membership routes' member lists).
const adminCalls: Call[][] = []
const adminClient = () => ({
  from: (table: string) => chain(adminCalls, table, {
    single: async () => ({ data: table === 'groups' ? group : null, error: null }),
    maybeSingle: async () => ({ data: table === 'courses' ? course : null, error: null }),
  }, () => ({ data: [], error: null })),
})

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => userClient()) }))
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => adminClient()) }))
vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))

import { GET } from '@/app/api/roster/candidates/route'
import { GET as groupMembersGET } from '@/app/api/group-students/route'
import { GET as courseMembersGET } from '@/app/api/course-enrollments/route'

const candidates = (qs: string) => GET(new Request(`http://localhost/api/roster/candidates?${qs}`))
// The student search = a users read filtered to role=student (not the caller's own-profile read).
const searches = () => userCalls.filter(c => c.some(x => x[0] === 'eq' && x[1] === 'role' && x[2] === 'student'))

const MANAGER = (permissions: Record<string, unknown>): Profile => ({ role: 'center_manager', tenant_id: 'tenant-a', permissions })

beforeEach(() => {
  authUser = { id: 'me' }
  profile = MANAGER({ manage_groups: true, manage_courses: true })
  group = { id: GROUP, teacher_id: 'teacher-x', tenant_id: 'tenant-a' }
  course = { id: COURSE, teacher_id: 'teacher-x', tenant_id: 'tenant-a' }
  searchReply = { data: [], error: null }
  userCalls = []
  adminCalls.length = 0
})

describe('GET /api/roster/candidates — input', () => {
  it('401 without a session, before anything else', async () => {
    authUser = null
    expect((await candidates(`group_id=${GROUP}&q=sara`)).status).toBe(401)
  })

  it('400 unless exactly one well-formed target is given — before any lookup or search', async () => {
    for (const qs of ['q=sara', `group_id=${GROUP}&course_id=${COURSE}&q=sara`, 'group_id=abc&q=sara',
      `group_id=${GROUP},or(id.neq.0)&q=sara`, 'course_id=&q=sara']) {
      expect((await candidates(qs)).status).toBe(400)
    }
    expect(adminCalls).toHaveLength(0)
    expect(searches()).toHaveLength(0)
  })

  it('400 when q is empty, blank or only wildcards — no lookup, no search', async () => {
    for (const q of ['', '%20%20', '%25', '*', '%22%5C']) {
      const res = await candidates(`course_id=${COURSE}&q=${q}`)
      expect(res.status).toBe(400)
      expect((await res.json()).code).toBe('searchQueryRequired')
    }
    expect(adminCalls).toHaveLength(0)
    expect(searches()).toHaveLength(0)
  })
})

type Scenario = { name: string; me?: string; profile: Profile | null; target: 'group' | 'course'; group?: typeof group; course?: typeof course; want: number }
const SCENARIOS: Scenario[] = [
  // groups — resolveGroupOwnership
  { name: 'student', profile: { role: 'student', tenant_id: 'tenant-a', permissions: { manage_groups: true } }, target: 'group', want: 403 },
  { name: 'centre manager without manage_groups', profile: MANAGER({ manage_courses: true }), target: 'group', want: 403 },
  { name: 'centre manager with manage_groups', profile: MANAGER({ manage_groups: true }), target: 'group', want: 200 },
  { name: 'institution admin (default ON)', profile: { role: 'university_admin', tenant_id: 'tenant-a', permissions: {} }, target: 'group', want: 200 },
  { name: 'institution admin switched off', profile: { role: 'university_admin', tenant_id: 'tenant-a', permissions: { manage_groups: false } }, target: 'group', want: 403 },
  { name: 'teacher of the group', me: 'teacher-x', profile: { role: 'teacher', tenant_id: 'tenant-a', permissions: null }, target: 'group', want: 200 },
  { name: 'another teacher', profile: { role: 'teacher', tenant_id: 'tenant-a', permissions: null }, target: 'group', want: 403 },
  { name: 'group of another institution', profile: MANAGER({ manage_groups: true }), target: 'group', group: { id: GROUP, teacher_id: 't', tenant_id: 'tenant-b' }, want: 404 },
  { name: 'unknown group', profile: MANAGER({ manage_groups: true }), target: 'group', group: null, want: 404 },
  { name: 'account without an institution', profile: { role: 'super_admin', tenant_id: null, permissions: null }, target: 'group', want: 403 },
  // courses — authorize
  { name: 'centre manager with manage_courses', profile: MANAGER({ manage_courses: true }), target: 'course', want: 200 },
  { name: 'centre manager without manage_courses', profile: MANAGER({ manage_groups: true }), target: 'course', want: 403 },
  { name: 'teacher of the course', me: 'teacher-x', profile: { role: 'teacher', tenant_id: 'tenant-a', permissions: null }, target: 'course', want: 200 },
  { name: 'another teacher (flags never count for a teacher)', profile: { role: 'teacher', tenant_id: 'tenant-a', permissions: { manage_courses: true } }, target: 'course', want: 403 },
  { name: 'course of another institution', profile: MANAGER({ manage_courses: true }), target: 'course', course: { id: COURSE, teacher_id: 't', tenant_id: 'tenant-b' }, want: 404 },
  { name: 'deleted / unknown course', profile: MANAGER({ manage_courses: true }), target: 'course', course: null, want: 404 },
  { name: 'student on a course', profile: { role: 'student', tenant_id: 'tenant-a', permissions: { manage_courses: true } }, target: 'course', want: 403 },
]

function arrange(s: Scenario) {
  authUser = { id: s.me ?? 'me' }
  profile = s.profile
  if ('group' in s) group = s.group ?? null
  if ('course' in s) course = s.course ?? null
}

describe('GET /api/roster/candidates — who may search = who may add', () => {
  it.each(SCENARIOS)('$name → $want', async s => {
    arrange(s)
    const qs = s.target === 'group' ? `group_id=${GROUP}&q=sara` : `course_id=${COURSE}&q=sara`
    const res = await candidates(qs)
    expect(res.status).toBe(s.want)
    expect(searches()).toHaveLength(s.want === 200 ? 1 : 0) // no search unless allowed
  })

  it.each(SCENARIOS)('parity with the membership gate: $name', async s => {
    arrange(s)
    const mine = await candidates(s.target === 'group' ? `group_id=${GROUP}&q=sara` : `course_id=${COURSE}&q=sara`)
    arrange(s)
    const theirs = s.target === 'group'
      ? await groupMembersGET(new Request(`http://localhost/api/group-students?group_id=${GROUP}`))
      : await courseMembersGET(new Request(`http://localhost/api/course-enrollments?course_id=${COURSE}`))
    expect(mine.status).toBe(theirs!.status)
  })
})

describe('GET /api/roster/candidates — results', () => {
  it('a group: students of the caller’s institution by name, the group’s members left out', async () => {
    await candidates(`group_id=${GROUP}&q=sara&tenant_id=tenant-b`)
    const q = searches()[0]
    expect(q).toContainEqual(['eq', 'tenant_id', 'tenant-a'])
    expect(q).not.toContainEqual(['eq', 'tenant_id', 'tenant-b'])
    expect(q).toContainEqual(['eq', 'is_active', true])
    expect(q).toContainEqual(['or', 'full_name.ilike."%sara%"'])
    expect(q).toContainEqual(['eq', 'group_students.group_id', GROUP])
    expect(q).toContainEqual(['is', 'group_students', null])
    expect(q).toContainEqual(['limit', 20])
  })

  it('a course: the course’s enrolments left out (not a group’s)', async () => {
    await candidates(`course_id=${COURSE}&q=sara`)
    const q = searches()[0]
    expect(q).toContainEqual(['eq', 'course_enrollments.course_id', COURSE])
    expect(q).toContainEqual(['is', 'course_enrollments', null])
    expect(q).not.toContainEqual(['is', 'group_students', null])
  })

  it('returns at most 20, with only id + name (no email)', async () => {
    searchReply = { data: Array.from({ length: 30 }, (_, i) => ({ id: `s${i}`, full_name: `S ${i}`, email: `s${i}@x.test`, course_enrollments: [] })), error: null }
    const res = await candidates(`course_id=${COURSE}&q=s`)
    expect(res.status).toBe(200)
    const { students } = await res.json()
    expect(students).toHaveLength(20)
    for (const s of students) expect(Object.keys(s).sort()).toEqual(['full_name', 'id'])
  })

  it('an injection attempt is one literal name pattern', async () => {
    await candidates(`group_id=${GROUP}&q=${encodeURIComponent('x"),or(role.eq.teacher')}`)
    expect(searches()[0].filter(c => c[0] === 'or')).toEqual([['or', 'full_name.ilike."%x ),or(role.eq.teacher%"']])
  })

  it('500 (no data) when the database refuses', async () => {
    searchReply = { data: null, error: { message: 'boom' } }
    const res = await candidates(`group_id=${GROUP}&q=sara`)
    expect(res.status).toBe(500)
    expect((await res.json()).students).toBeUndefined()
  })
})
