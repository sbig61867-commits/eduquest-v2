// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Batch 2 / C-T + C-S — /center/groups and /center/courses no longer read the
 * institution's teaching staff. Each row carries its teacher's name (or null ⇒
 * «—», exactly as the old active-teacher list produced), and "is there any
 * active teacher" is a head-only count.
 */

type Call = [string, ...unknown[]]
let calls: Call[][]
let activeTeacherCount: number | null
let groupRows: unknown[]
let courseRows: unknown[]

function fakeClient() {
  return {
    from(table: string) {
      const c: Call[] = [['from', table]]
      calls.push(c)
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'order', 'is', 'in', 'limit', 'range']) {
        chain[m] = (...args: unknown[]) => { c.push([m, ...args]); return chain }
      }
      chain.then = (resolve: (v: unknown) => unknown) => {
        const head = c.some(x => x[0] === 'select' && (x[2] as { head?: boolean } | undefined)?.head)
        const reply = head ? { count: activeTeacherCount, data: null, error: null }
          : table === 'groups' ? { data: groupRows, error: null }
          : table === 'courses' ? { data: courseRows, error: null }
          : { data: [], error: null }
        return Promise.resolve(reply).then(resolve)
      }
      return chain
    },
  }
}

vi.mock('@/lib/center-access', () => ({
  loadCenterAccess: vi.fn(async () => ({ supabase: fakeClient(), tenantId: 'tenant-a', has: () => true })),
}))
vi.mock('@/components/center/groups-client', () => ({ CenterGroupsClient: () => null }))
vi.mock('@/components/center/courses-client', () => ({ CenterCoursesClient: () => null }))
vi.mock('@/components/shared/no-permission', () => ({ NoPermission: () => null }))

import GroupsPage from '@/app/(center)/center/groups/page'
import CoursesPage from '@/app/(center)/center/courses/page'

const ACTIVE = { full_name: 'Sara Idris', role: 'teacher', is_active: true }
const DISABLED = { full_name: 'Old Teacher', role: 'teacher', is_active: false }

beforeEach(() => {
  calls = []
  activeTeacherCount = 3
  groupRows = [
    { id: 'g1', name: 'A', description: null, is_active: true, teacher_id: 't1', group_students: [{ count: 2 }], teacher: ACTIVE },
    { id: 'g2', name: 'B', description: null, is_active: true, teacher_id: 't9', group_students: [{ count: 0 }], teacher: DISABLED },
    { id: 'g3', name: 'C', description: null, is_active: true, teacher_id: 't8', group_students: [], teacher: null },
  ]
  courseRows = [
    { id: 'c1', title: 'X', description: null, is_published: true, teacher_id: 't1', course_units: [{ count: 1 }], course_enrollments: [{ count: 4 }], teacher: ACTIVE },
    { id: 'c2', title: 'Y', description: null, is_published: false, teacher_id: 't9', course_units: [], course_enrollments: [], teacher: DISABLED },
  ]
})

// A read of the teaching staff = a users read filtered to role=teacher that is not head-only.
const teacherListReads = () => calls.filter(c =>
  c[0][1] === 'users' &&
  c.some(x => x[0] === 'eq' && x[1] === 'role' && x[2] === 'teacher') &&
  !c.some(x => x[0] === 'select' && (x[2] as { head?: boolean } | undefined)?.head))
const teacherCounts = () => calls.filter(c =>
  c[0][1] === 'users' && c.some(x => x[0] === 'select' && (x[2] as { head?: boolean } | undefined)?.head))

describe.each([
  ['/center/groups', GroupsPage, 'groups', 'groups_teacher_id_fkey', 'initialGroups'],
  ['/center/courses', CoursesPage, 'courses', 'courses_teacher_id_fkey', 'initialCourses'],
] as const)('%s', (_path, Page, table, fk, rowsProp) => {
  it('C-S: does not read the student body — students are searched on demand in RosterModal', async () => {
    const el = await Page() as { props: Record<string, unknown> }
    const studentReads = calls.filter(c => c[0][1] === 'users' && c.some(x => x[0] === 'eq' && x[1] === 'role' && x[2] === 'student'))
    expect(studentReads).toHaveLength(0)
    expect(el.props).not.toHaveProperty('students')
  })

  it('does not read the teaching staff — only a head count of active teachers', async () => {
    await Page()
    expect(teacherListReads()).toHaveLength(0)
    const count = teacherCounts()
    expect(count).toHaveLength(1)
    expect(count[0]).toContainEqual(['eq', 'tenant_id', 'tenant-a'])
    expect(count[0]).toContainEqual(['eq', 'role', 'teacher'])
    expect(count[0]).toContainEqual(['eq', 'is_active', true])
  })

  it('embeds each row’s teacher (name, role, active) through the teacher foreign key', async () => {
    await Page()
    const rowsQuery = calls.find(c => c[0][1] === table)!
    const select = String(rowsQuery.find(x => x[0] === 'select')![1])
    expect(select).toContain(`teacher:users!${fk}(full_name, role, is_active)`)
  })

  it('an active teacher’s name; null («—») for a disabled or missing teacher — as the old list did', async () => {
    const el = await Page() as { props: Record<string, unknown> }
    const rows = el.props[rowsProp] as { teacher_name: string | null }[]
    expect(rows.map(r => r.teacher_name)).toEqual(table === 'groups' ? ['Sara Idris', null, null] : ['Sara Idris', null])
    expect(el.props.hasTeachers).toBe(true)
    expect(el.props).not.toHaveProperty('teachers')
  })

  it('no active teacher (count 0 or unknown) → hasTeachers false', async () => {
    activeTeacherCount = 0
    expect(((await Page()) as { props: Record<string, unknown> }).props.hasTeachers).toBe(false)
    activeTeacherCount = null
    expect(((await Page()) as { props: Record<string, unknown> }).props.hasTeachers).toBe(false)
  })
})
