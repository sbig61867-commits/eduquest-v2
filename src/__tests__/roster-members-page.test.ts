// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Batch 2 / C-M — member list one page at a time. readRosterPage (src/lib/data/rosters.ts)
 * asks for one ordered page with an exact total; the membership routes use it ONLY
 * when `page` is sent, so the whole-roster answer /teacher/groups (T1) relies on is
 * unchanged — same query, same body. Authorization runs before either path.
 */

const GROUP = '11111111-1111-4111-8111-111111111111'
const COURSE = '22222222-2222-4222-8222-222222222222'

type Call = [string, ...unknown[]]
let adminCalls: Call[][]
let pageReplies: Array<{ data?: unknown[] | null; count?: number | null; error?: { code?: string; message: string } | null }>
let headCount: number
let profile: Record<string, unknown> | null

function adminClient() {
  return {
    from(table: string) {
      const c: Call[] = [['from', table]]
      adminCalls.push(c)
      const ch: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'order', 'range', 'is']) ch[m] = (...a: unknown[]) => { c.push([m, ...a]); return ch }
      ch.single = async () => ({ data: table === 'groups' ? { id: GROUP, teacher_id: 'x', tenant_id: 'tenant-a' } : null, error: null })
      ch.maybeSingle = async () => ({ data: table === 'courses' ? { id: COURSE, teacher_id: 'x', tenant_id: 'tenant-a' } : null, error: null })
      ch.then = (resolve: (v: unknown) => unknown) => {
        const head = c.some(x => x[0] === 'select' && (x[2] as { head?: boolean } | undefined)?.head)
        const paged = c.some(x => x[0] === 'range')
        const reply = head ? { count: headCount, error: null }
          : paged ? { data: [], count: 0, error: null, ...pageReplies.shift() }
          : { data: [{ student_id: 's1', users: { id: 's1', full_name: 'Whole One', email: 'w@x.test' } }], error: null }
        return Promise.resolve(reply).then(resolve)
      }
      return ch
    },
  }
}

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => adminClient()) }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'me' } } }) },
    from: () => {
      const ch: Record<string, unknown> = {}
      for (const m of ['select', 'eq']) ch[m] = () => ch
      ch.single = async () => ({ data: profile, error: null })
      return ch
    },
  })),
}))
vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))

import { readRosterPage, rosterPageParam, ROSTER_PAGE_SIZE } from '@/lib/data/rosters'
import { GET as groupGET } from '@/app/api/group-students/route'
import { GET as courseGET } from '@/app/api/course-enrollments/route'

const member = (i: number) => ({ student_id: `s${i}`, users: { id: `s${i}`, full_name: `S ${i}`, email: `s${i}@x.test` } })

beforeEach(() => {
  adminCalls = []
  pageReplies = []
  headCount = 0
  profile = { role: 'center_manager', tenant_id: 'tenant-a', permissions: { manage_groups: true, manage_courses: true } }
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
  it('a course: one ordered page of 50 with an exact count, never more', async () => {
    pageReplies = [{ data: Array.from({ length: 50 }, (_, i) => member(i)), count: 3000 }]
    const { data, error } = await readRosterPage(adminClient() as never, 'course', COURSE, 2)
    expect(error).toBeNull()
    const q = adminCalls[0]
    expect(q).toContainEqual(['from', 'course_enrollments'])
    expect(q).toContainEqual(['select', 'student_id, users!course_enrollments_student_id_fkey(id, full_name, email)', { count: 'exact' }])
    expect(q).toContainEqual(['eq', 'course_id', COURSE])
    expect(q).toContainEqual(['order', 'enrolled_at', { ascending: false }])
    expect(q).toContainEqual(['order', 'student_id', { ascending: true }])
    expect(q).toContainEqual(['range', ROSTER_PAGE_SIZE, 2 * ROSTER_PAGE_SIZE - 1])
    expect(data).toMatchObject({ total: 3000, page: 2, pageCount: 60 })
    expect(data.students).toHaveLength(50)
    expect(Object.keys(data.students[0]).sort()).toEqual(['email', 'full_name', 'id'])
  })

  it('a group: ordered by joined_at, keyed on group_id', async () => {
    pageReplies = [{ data: [member(1)], count: 1 }]
    await readRosterPage(adminClient() as never, 'group', GROUP, 1)
    expect(adminCalls[0]).toContainEqual(['eq', 'group_id', GROUP])
    expect(adminCalls[0]).toContainEqual(['order', 'joined_at', { ascending: false }])
    expect(adminCalls[0]).toContainEqual(['range', 0, 49])
  })

  it('a page past the end is answered with the last page', async () => {
    pageReplies = [{ error: { code: 'PGRST103', message: 'Requested range not satisfiable' } }, { data: [member(100)], count: 101 }]
    headCount = 101
    const { data } = await readRosterPage(adminClient() as never, 'course', COURSE, 9)
    expect(data.page).toBe(3)
    expect(adminCalls.at(-1)).toContainEqual(['range', 100, 149])
  })

  it('an error returns an empty page with the error', async () => {
    pageReplies = [{ error: { code: '42501', message: 'denied' } }]
    const { data, error } = await readRosterPage(adminClient() as never, 'group', GROUP, 1)
    expect(error).toMatchObject({ message: 'denied' })
    expect(data).toMatchObject({ students: [], total: 0 })
  })
})

describe('membership routes — ?page= is opt-in; the whole-roster answer is unchanged', () => {
  it.each([
    ['group', () => groupGET(new Request(`http://x/api/group-students?group_id=${GROUP}`)), 'group_students'],
    ['course', () => courseGET(new Request(`http://x/api/course-enrollments?course_id=${COURSE}`)), 'course_enrollments'],
  ] as const)('%s without page: same whole read (no range, no count), same body shape', async (_k, call, table) => {
    const res = (await call())!
    expect(res.status).toBe(200)
    const read = adminCalls.find(c => c[0][1] === table)!
    expect(read.some(x => x[0] === 'range')).toBe(false)
    expect(read.some(x => x[0] === 'select' && x[2] !== undefined)).toBe(false)
    expect(await res.json()).toEqual({ students: [{ id: 's1', full_name: 'Whole One', email: 'w@x.test' }] })
  })

  it.each([
    ['group', () => groupGET(new Request(`http://x/api/group-students?group_id=${GROUP}&page=2`))],
    ['course', () => courseGET(new Request(`http://x/api/course-enrollments?course_id=${COURSE}&page=2`))],
  ] as const)('%s with page: one page + total', async (_k, call) => {
    pageReplies = [{ data: [member(51)], count: 51 }]
    const res = (await call())!
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ students: [{ id: 's51', full_name: 'S 51', email: 's51@x.test' }], total: 51, page: 2, pageCount: 2 })
  })

  it('authorization still comes first: no capability → 403 and no roster read, page or not', async () => {
    profile = { role: 'center_manager', tenant_id: 'tenant-a', permissions: {} }
    expect((await groupGET(new Request(`http://x/api/group-students?group_id=${GROUP}&page=1`)))!.status).toBe(403)
    expect((await courseGET(new Request(`http://x/api/course-enrollments?course_id=${COURSE}&page=1`)))!.status).toBe(403)
    expect(adminCalls.some(c => c[0][1] === 'group_students' || c[0][1] === 'course_enrollments')).toBe(false)
  })
})
