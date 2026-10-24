// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Batch 2 / C-T + C-S — /center/groups and /center/courses no longer read the
 * institution's teaching staff. Each row carries its teacher's name (or null ⇒
 * «—», exactly as the old active-teacher list produced), and "is there any
 * active teacher" is a count. Step 9: the pages read on the SQL layer as the
 * centre manager.
 */

type Q = { text: string; values: unknown[]; ctx: { as: string; userId?: string } }
const db = vi.hoisted(() => ({
  calls: [] as Q[],
  activeTeacherCount: 3 as number | null,
  groupRows: [] as unknown[],
  courseRows: [] as unknown[],
}))

vi.mock('@/lib/db/sql', async () => (await import('./helpers/fake-sql')).fakeSqlModule(q => {
  db.calls.push(q as Q)
  const t = q.text
  if (t.startsWith('select count(*)::int as n from public.users')) return db.activeTeacherCount == null ? [] : [{ n: db.activeTeacherCount }]
  if (t.startsWith('with t as (select count(*) filter (where is_active)')) {
    return [{ active: db.groupRows.length, archived: 0, page: 1, rows: db.groupRows }]
  }
  if (t.startsWith('select g.id, g.name, g.course_id, g.max_students')) return []
  if (t.startsWith('select id, title from public.courses')) return []
  if (t.startsWith('select c.id, c.title, c.description')) return db.courseRows
  return new Error('unexpected statement: ' + t)
}))
vi.mock('@/lib/center-access', () => ({
  loadCenterAccess: vi.fn(async () => ({ userId: 'mgr-1', tenantId: 'tenant-a', has: () => true })),
}))
vi.mock('@/components/center/groups-client', () => ({ CenterGroupsClient: () => null }))
vi.mock('@/components/center/courses-client', () => ({ CenterCoursesClient: () => null }))
vi.mock('@/components/shared/no-permission', () => ({ NoPermission: () => null }))

import GroupsPage from '@/app/(center)/center/groups/page'
import CoursesPage from '@/app/(center)/center/courses/page'
/** Both pages take an optional searchParams (the groups list is paged). */
const open = (Page: unknown) => (Page as (p: { searchParams: Promise<object> }) => Promise<unknown>)({ searchParams: Promise.resolve({}) })

const ACTIVE = { full_name: 'Sara Idris', role: 'teacher', is_active: true }
const DISABLED = { full_name: 'Old Teacher', role: 'teacher', is_active: false }

beforeEach(() => {
  db.calls = []
  db.activeTeacherCount = 3
  db.groupRows = [
    { id: 'g1', name: 'A', description: null, is_active: true, teacher_id: 't1', group_students: [{ count: 2 }], teacher: ACTIVE },
    { id: 'g2', name: 'B', description: null, is_active: true, teacher_id: 't9', group_students: [{ count: 0 }], teacher: DISABLED },
    { id: 'g3', name: 'C', description: null, is_active: true, teacher_id: 't8', group_students: [], teacher: null },
  ]
  db.courseRows = [
    { id: 'c1', title: 'X', description: null, is_published: true, teacher_id: 't1', course_units: [{ count: 1 }], course_enrollments: [{ count: 4 }], teacher: ACTIVE },
    { id: 'c2', title: 'Y', description: null, is_published: false, teacher_id: 't9', course_units: [], course_enrollments: [], teacher: DISABLED },
  ]
})

const userReads = () => db.calls.filter(q => /from public\.users\b(?! u on)/.test(q.text))

describe.each([
  ['/center/groups', GroupsPage, 'initialGroups', 'with t as'],
  ['/center/courses', CoursesPage, 'initialCourses', 'select c.id, c.title, c.description'],
] as const)('%s', (_path, Page, rowsProp, rowsPrefix) => {
  it('every read runs as the centre manager', async () => {
    await open(Page)
    expect(db.calls.length).toBeGreaterThan(0)
    expect(db.calls.every(q => q.ctx.as === 'user' && q.ctx.userId === 'mgr-1')).toBe(true)
  })

  it('C-S: does not read the student body — students are searched on demand in RosterModal', async () => {
    const el = await open(Page) as { props: Record<string, unknown> }
    expect(db.calls.some(q => q.values.includes('student') || /role\s*=\s*'student'/.test(q.text))).toBe(false)
    expect(el.props).not.toHaveProperty('students')
  })

  it('does not read the teaching staff — only a count of active teachers of the institution', async () => {
    await open(Page)
    const reads = userReads()
    expect(reads).toHaveLength(1)
    expect(reads[0].text).toBe("select count(*)::int as n from public.users where tenant_id = $ and role = 'teacher' and is_active")
    expect(reads[0].values).toEqual(['tenant-a'])
  })

  it('embeds each row’s teacher (name, role, active) through the teacher id', async () => {
    await open(Page)
    const rows = db.calls.find(q => q.text.startsWith(rowsPrefix))!
    expect(rows.text).toContain("json_build_object('full_name', u.full_name, 'role', u.role, 'is_active', u.is_active) end as teacher")
    expect(rows.text).toMatch(/left join public\.users u on u\.id = [gc]\.teacher_id/)
  })

  it('an active teacher’s name; null («—») for a disabled or missing teacher — as the old list did', async () => {
    const el = await open(Page) as { props: Record<string, unknown> }
    const rows = el.props[rowsProp] as { teacher_name: string | null }[]
    expect(rows.map(r => r.teacher_name)).toEqual(rowsProp === 'initialGroups' ? ['Sara Idris', null, null] : ['Sara Idris', null])
    expect(el.props.hasTeachers).toBe(true)
    expect(el.props).not.toHaveProperty('teachers')
  })

  it('no active teacher (count 0 or no row) → hasTeachers false', async () => {
    db.activeTeacherCount = 0
    expect(((await open(Page)) as { props: Record<string, unknown> }).props.hasTeachers).toBe(false)
    db.activeTeacherCount = null
    expect(((await open(Page)) as { props: Record<string, unknown> }).props.hasTeachers).toBe(false)
  })
})
