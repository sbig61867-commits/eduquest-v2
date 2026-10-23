// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Batch 2 / C-M — member list one page at a time. readRosterPage
 * (src/lib/data/rosters.ts) reads one ordered page with the exact total in ONE
 * statement (a page past the end becomes the last page); the membership routes
 * use it ONLY when `page` is sent, so the whole-roster answer /teacher/groups
 * (T1) relies on is unchanged. Authorization runs before either path.
 */

const GROUP = '11111111-1111-4111-8111-111111111111'
const COURSE = '22222222-2222-4222-8222-222222222222'

type Q = { text: string; values: unknown[]; ctx: { as: string; tenantId?: string } }
let sql: Q[]
let profile: Record<string, unknown> | null
let pageReply: unknown[] | Error

vi.mock('@/lib/auth/current', () => ({ currentCtx: async () => ({ sub: 'me', role: 'center_manager', tenant_id: 'tenant-a' }) }))
vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))
vi.mock('@/lib/db/sql', async () => (await import('./helpers/fake-sql')).fakeSqlModule(q => {
  sql.push(q as Q)
  if (q.text.startsWith('select role, permissions from public.users')) return profile ? [profile] : []
  if (q.text.startsWith('select id, teacher_id, tenant_id, max_students, course_id from public.groups')) return [{ id: GROUP, teacher_id: 'x', tenant_id: 'tenant-a', max_students: null, course_id: null }]
  if (q.text.startsWith('select teacher_id from public.courses')) return [{ teacher_id: 'x' }]
  if (q.text.startsWith('with total as')) return pageReply
  if (q.text.startsWith('select u.id, u.full_name, u.email')) return [{ id: 's1', full_name: 'Whole One', email: 'w@x.test' }]
  return new Error('unexpected statement: ' + q.text)
}))

import { readRosterPage, rosterPageParam, ROSTER_PAGE_SIZE } from '@/lib/data/rosters'
import { GET as groupGET } from '@/app/api/group-students/route'
import { GET as courseGET } from '@/app/api/course-enrollments/route'

const member = (i: number) => ({ id: `s${i}`, full_name: `S ${i}`, email: `s${i}@x.test` })
const pageReads = () => sql.filter(q => q.text.startsWith('with total as'))

beforeEach(() => {
  sql = []
  pageReply = []
  profile = { role: 'center_manager', permissions: { manage_groups: true, manage_courses: true } }
})

describe('rosterPageParam', () => {
  it('null without ?page= (whole roster, as before); a positive integer otherwise', () => {
    expect(rosterPageParam(new URLSearchParams('group_id=x'))).toBeNull()
    expect(rosterPageParam(new URLSearchParams('page=3'))).toBe(3)
    expect(rosterPageParam(new URLSearchParams('page=abc'))).toBe(1)
    expect(rosterPageParam(new URLSearchParams('page=-2'))).toBe(1)
  })
})

describe('readRosterPage', () => {
  it('a course: one ordered page of 50 with an exact total, in one statement scoped to the institution', async () => {
    pageReply = [{ total: 120, page: 2, students: Array.from({ length: 50 }, (_, i) => member(i)) }]
    const data = await readRosterPage('tenant-a', 'course', COURSE, 2)
    expect(data).toMatchObject({ total: 120, page: 2, pageCount: 3 })
    expect(data.students).toHaveLength(50)
    const [q] = pageReads()
    expect(q.ctx).toEqual({ as: 'service', tenantId: 'tenant-a' })
    expect(q.text).toContain('from public.course_enrollments x join public.users u')
    expect(q.text).toContain('order by x.enrolled_at desc, x.student_id')
    expect(q.values).toContain(ROSTER_PAGE_SIZE)
  })

  it('a group: ordered by joined_at, keyed on group_id', async () => {
    pageReply = [{ total: 0, page: 1, students: [] }]
    await readRosterPage('tenant-a', 'group', GROUP, 1)
    const [q] = pageReads()
    expect(q.text).toContain('where x.group_id = $')
    expect(q.text).toContain('order by x.joined_at desc, x.student_id')
  })

  it('a page past the end is clamped to the last page by the statement itself', async () => {
    pageReply = [{ total: 60, page: 2, students: [member(1)] }]
    const data = await readRosterPage('tenant-a', 'course', COURSE, 9)
    expect(data).toMatchObject({ page: 2, pageCount: 2 })
    expect(pageReads()[0].text).toContain('least($, greatest(1, ceil(n / $::numeric)::int))')
  })

  it('a failed read is an error, never an empty page passed off as real', async () => {
    pageReply = new Error('boom')
    await expect(readRosterPage('tenant-a', 'group', GROUP, 1)).rejects.toThrow('boom')
  })
})

describe('membership routes — ?page= is opt-in; the whole-roster answer is unchanged', () => {
  it.each([
    ['group', () => groupGET(new Request(`http://x/api/group-students?group_id=${GROUP}&page=2`))],
    ['course', () => courseGET(new Request(`http://x/api/course-enrollments?course_id=${COURSE}&page=2`))],
  ] as const)('%s with ?page= → one page with its total', async (_k, call) => {
    pageReply = [{ total: 3, page: 1, students: [member(1), member(2), member(3)] }]
    const body = await (await call())!.json()
    expect(body).toMatchObject({ total: 3, page: 1, pageCount: 1 })
    expect(pageReads()).toHaveLength(1)
  })

  it.each([
    ['group', () => groupGET(new Request(`http://x/api/group-students?group_id=${GROUP}`))],
    ['course', () => courseGET(new Request(`http://x/api/course-enrollments?course_id=${COURSE}`))],
  ] as const)('%s without ?page= → the whole roster, as before', async (_k, call) => {
    const body = await (await call())!.json()
    expect(body).toEqual({ students: [{ id: 's1', full_name: 'Whole One', email: 'w@x.test' }] })
    expect(pageReads()).toHaveLength(0)
  })

  it('authorization still comes first: no capability → 403 and no roster read, page or not', async () => {
    profile = { role: 'center_manager', permissions: {} }
    for (const call of [
      () => groupGET(new Request(`http://x/api/group-students?group_id=${GROUP}&page=1`)),
      () => groupGET(new Request(`http://x/api/group-students?group_id=${GROUP}`)),
      () => courseGET(new Request(`http://x/api/course-enrollments?course_id=${COURSE}&page=1`)),
    ]) expect((await call())!.status).toBe(403)
    expect(sql.some(q => q.text.startsWith('with total as') || q.text.startsWith('select u.id, u.full_name, u.email'))).toBe(false)
  })
})
