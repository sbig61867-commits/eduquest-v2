// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * GET /api/roster/candidates (Batch 2, owner's decision 2026-10-01): who may
 * search = who may add — the gate mirrors /api/group-students and
 * /api/course-enrollments step for step. Step 9: the caller's live row, the
 * target and the search come in ONE unit (as app_service pinned to the
 * caller's institution); the rows are discarded unless the gate passes.
 */

const GROUP = '11111111-1111-4111-8111-111111111111'
const COURSE = '22222222-2222-4222-8222-222222222222'

type Profile = { role: string; tenant_id: string | null; permissions: Record<string, unknown> | null }
type Target = { id: string; teacher_id: string; tenant_id: string } | null
type Q = { text: string; values: unknown[]; ctx: { as: string; tenantId?: string } }

let authUser: { id: string } | null
let profile: Profile | null
let group: Target
let course: Target
let searchRows: unknown[] | Error
let sql: Q[]

vi.mock('@/lib/auth/current', () => ({
  currentCtx: async () => (authUser ? { sub: authUser.id, role: profile?.role ?? null, tenant_id: profile?.tenant_id ?? null } : null),
}))
vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))
vi.mock('@/lib/db/sql', async () => (await import('./helpers/fake-sql')).fakeSqlModule(q => {
  sql.push(q as Q)
  const tenant = (q as Q).ctx.tenantId
  if (q.text.startsWith('select role, permissions from public.users')) return profile && profile.tenant_id === tenant ? [profile] : []
  if (q.text.startsWith('select teacher_id from public.groups')) return group && group.tenant_id === tenant ? [group] : []
  if (q.text.startsWith('select teacher_id from public.courses')) return course && course.tenant_id === tenant ? [course] : []
  if (q.text.startsWith('select u.id, u.full_name from public.users u')) {
    if (searchRows instanceof Error) return searchRows
    return searchRows.slice(0, q.values.at(-1) as number).map(r => ({ id: (r as { id: string }).id, full_name: (r as { full_name: string }).full_name }))
  }
  return new Error('unexpected statement: ' + q.text)
}))

import { GET } from '@/app/api/roster/candidates/route'

const get = (qs: string) => GET(new Request(`http://x/api/roster/candidates?${qs}`))
const MANAGER = (permissions: Record<string, unknown>): Profile => ({ role: 'center_manager', tenant_id: 'tenant-a', permissions })
const search = () => sql.find(q => q.text.startsWith('select u.id, u.full_name from public.users u'))

beforeEach(() => {
  authUser = { id: 'me' }
  profile = MANAGER({ manage_groups: true, manage_courses: true })
  group = { id: GROUP, teacher_id: 'teacher-x', tenant_id: 'tenant-a' }
  course = { id: COURSE, teacher_id: 'teacher-x', tenant_id: 'tenant-a' }
  searchRows = []
  sql = []
})

describe('GET /api/roster/candidates — input', () => {
  it('401 without a session, before anything else', async () => {
    authUser = null
    expect((await get(`group_id=${GROUP}&q=sara`)).status).toBe(401)
    expect(sql).toHaveLength(0)
  })

  it('400 unless exactly one well-formed target is given — before any lookup or search', async () => {
    for (const qs of ['q=sara', `group_id=${GROUP}&course_id=${COURSE}&q=sara`, 'group_id=abc&q=sara', `group_id=${GROUP},x&q=sara`]) {
      expect((await get(qs)).status).toBe(400)
    }
    expect(sql).toHaveLength(0)
  })

  it('400 when q is empty, blank or only wildcards — no lookup, no search', async () => {
    for (const q of ['', '%20%20', '%25', '*']) {
      const res = await get(`group_id=${GROUP}&q=${q}`)
      expect(res.status).toBe(400)
      expect((await res.json()).code).toBe('searchQueryRequired')
    }
    expect(sql).toHaveLength(0)
  })
})

type Scenario = { name: string; me?: string; profile: Profile | null; target: 'group' | 'course'; group?: Target; course?: Target; want: number }
const SCENARIOS: Scenario[] = [
  // groups — as /api/group-students
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
  // courses — as /api/course-enrollments
  { name: 'centre manager with manage_courses', profile: MANAGER({ manage_courses: true }), target: 'course', want: 200 },
  { name: 'centre manager without manage_courses', profile: MANAGER({ manage_groups: true }), target: 'course', want: 403 },
  { name: 'teacher of the course', me: 'teacher-x', profile: { role: 'teacher', tenant_id: 'tenant-a', permissions: null }, target: 'course', want: 200 },
  { name: 'another teacher (flags never count for a teacher)', profile: { role: 'teacher', tenant_id: 'tenant-a', permissions: { manage_courses: true } }, target: 'course', want: 403 },
  { name: 'course of another institution', profile: MANAGER({ manage_courses: true }), target: 'course', course: { id: COURSE, teacher_id: 't', tenant_id: 'tenant-b' }, want: 404 },
  { name: 'deleted / unknown course', profile: MANAGER({ manage_courses: true }), target: 'course', course: null, want: 404 },
  { name: 'student on a course', profile: { role: 'student', tenant_id: 'tenant-a', permissions: { manage_courses: true } }, target: 'course', want: 403 },
]

describe('GET /api/roster/candidates — who may search = who may add', () => {
  it.each(SCENARIOS)('$name → $want, and nothing leaks unless allowed', async s => {
    authUser = { id: s.me ?? 'me' }
    profile = s.profile
    if ('group' in s) group = s.group ?? null
    if ('course' in s) course = s.course ?? null
    searchRows = [{ id: 'leak', full_name: 'Must not leak' }]
    const res = await get(`${s.target}_id=${s.target === 'group' ? GROUP : COURSE}&q=sara`)
    expect(res.status).toBe(s.want)
    const body = await res.json()
    if (s.want !== 200) expect(JSON.stringify(body)).not.toContain('Must not leak')
  })
})

describe('GET /api/roster/candidates — results', () => {
  it('a group: students of the caller’s institution by name, the group’s members left out — one unit', async () => {
    await get(`group_id=${GROUP}&q=sara`)
    const q = search()!
    expect(sql.every(x => x.ctx.as === 'service' && x.ctx.tenantId === 'tenant-a')).toBe(true)
    expect(q.text).toContain("u.tenant_id = $ and u.role = 'student' and u.is_active and u.full_name ilike $")
    expect(q.text).toContain('not exists (select 1 from public.group_students m where m.group_id = $')
    expect(q.values).toEqual(['tenant-a', '%sara%', GROUP, 20])
  })

  it('a course: the course’s enrolments left out (not a group’s)', async () => {
    await get(`course_id=${COURSE}&q=sara`)
    const q = search()!
    expect(q.text).toContain('not exists (select 1 from public.course_enrollments m where m.course_id = $')
    expect(q.text).not.toContain('group_students')
  })

  it('returns at most 20, with only id + name (no email)', async () => {
    searchRows = Array.from({ length: 30 }, (_, i) => ({ id: `s${i}`, full_name: `S ${i}`, email: `s${i}@x.test` }))
    const { students } = await (await get(`group_id=${GROUP}&q=s`)).json()
    expect(students).toHaveLength(20)
    for (const s of students) expect(Object.keys(s).sort()).toEqual(['full_name', 'id'])
  })

  it('an injection attempt is one literal name pattern', async () => {
    await get(`group_id=${GROUP}&q=${encodeURIComponent('x"),or(role.eq.teacher')}`)
    expect(search()!.values[1]).toBe('%x ),or(role.eq.teacher%')
    expect(search()!.text).not.toContain('teacher')
  })

  it('500 (no data) when the database refuses', async () => {
    searchRows = new Error('boom')
    const res = await get(`group_id=${GROUP}&q=sara`)
    expect(res.status).toBe(500)
    expect((await res.json()).students).toBeUndefined()
  })
})
