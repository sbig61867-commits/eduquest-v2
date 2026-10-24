// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * People directories, one page from the database (PERFORMANCE_CONTRACT.md P1),
 * on the SQL layer (step 9). Each list is ONE statement read as the caller:
 * tenant + role filters always, the search as a bound ILIKE parameter only when
 * there is one, the total / active count and the page clamp in the same
 * statement. Only the variant's own columns leave the loader. The student
 * selector's SQL fragment (studentSearchSql) is checked here too; the routes
 * that use it have their own tests.
 */

type Q = { text: string; values: unknown[]; ctx: { as: string; userId?: string } }
const db = vi.hoisted(() => ({ calls: [] as Q[], answer: (_q: Q): unknown[] | Error => [] }))
vi.mock('@/lib/db/sql', async () => (await import('./helpers/fake-sql')).fakeSqlModule(q => {
  db.calls.push(q as Q)
  return db.answer(q as Q)
}))

import {
  activeTeacherName, listCenterStudents, listCenterTeachers, listStudents, listTeachers, parsePage, sanitizeSearch,
  studentSearchSql, PEOPLE_PAGE_SIZE, STUDENT_SEARCH_LIMIT,
} from '@/lib/data/people'

const FULL = {
  id: 'u1', email: 'a@x.edu', full_name: 'Sara', avatar_url: null, role: 'student', is_active: true, created_at: 't',
  tenant_id: 'tenant-a', can_create_courses: false, is_university_student: true, name_complete: true,
}
const page = (rows: unknown[], total = rows.length, p = 1, active = total) => [{ total, active, page: p, rows }]

beforeEach(() => {
  db.calls = []
  db.answer = () => []
})

describe('sanitizeSearch — a safe bound ILIKE term', () => {
  it('keeps normal text, dots and punctuation (so emails are searchable)', () => {
    expect(sanitizeSearch('  Sara  Ali ')).toBe('Sara Ali')
    expect(sanitizeSearch('gmail.com')).toBe('gmail.com')
    expect(sanitizeSearch("O'Brien (x), a:b")).toBe("O'Brien (x), a:b")
    expect(sanitizeSearch('سارة')).toBe('سارة')
  })

  it('removes the LIKE wildcards (a lone one would match everyone) and quote / escape characters', () => {
    expect(sanitizeSearch('"),or(id.not.is.null')).toBe('),or(id.not.is.null')
    expect(sanitizeSearch('a\\"b')).toBe('a b')
    expect(sanitizeSearch('%')).toBe('')
    expect(sanitizeSearch('*')).toBe('')
    expect(sanitizeSearch('50%')).toBe('50')
  })

  it('ignores non-strings and caps the length', () => {
    expect(sanitizeSearch(undefined)).toBe('')
    expect(sanitizeSearch(['a'])).toBe('')
    expect(sanitizeSearch('x'.repeat(500))).toHaveLength(100)
  })
})

describe('parsePage', () => {
  it('accepts positive integers only', () => {
    expect(parsePage('3')).toBe(3)
    expect(parsePage(undefined)).toBe(1)
    expect(parsePage('0')).toBe(1)
    expect(parsePage('-2')).toBe(1)
    expect(parsePage('abc')).toBe(1)
    expect(parsePage('9999999')).toBe(100_000)
  })
})

describe('listStudents', () => {
  it('one statement as the caller, scoped to the tenant and to students; page size and requested page are parameters', async () => {
    db.answer = () => page([FULL], 120, 2)
    const { data, error } = await listStudents('admin-1', 'tenant-a', { page: 2 })
    expect(error).toBeNull()
    expect(db.calls).toHaveLength(1)
    const [q] = db.calls
    expect(q.ctx).toEqual({ as: 'user', userId: 'admin-1' })
    expect(q.text).toContain('where u.tenant_id = $ and u.role = $')
    expect(q.values.slice(0, 2)).toEqual(['tenant-a', 'student'])
    expect(q.values).toContain(2)
    expect(q.values).toContain(PEOPLE_PAGE_SIZE)
    expect(data).toMatchObject({ total: 120, page: 2, pageCount: 3, pageSize: PEOPLE_PAGE_SIZE })
    expect(data.active).toBeUndefined()
  })

  it('returns exactly the student columns', async () => {
    db.answer = () => page([{ ...FULL, extra: 'never' }])
    const { data } = await listStudents('admin-1', 'tenant-a')
    expect(Object.keys(data.rows[0]).sort()).toEqual(Object.keys(FULL).sort())
  })

  it('searches in the database with the sanitized term as one bound pattern — never spliced into the SQL', async () => {
    db.answer = () => page([])
    await listStudents('admin-1', 'tenant-a', { search: 'gmail.com%' })
    const [q] = db.calls
    expect(q.values).toContain('%gmail.com%')
    expect(q.text).not.toContain('gmail')
    expect(q.text).toContain('u.full_name ilike $ or u.email ilike $')
  })

  it('no search → the pattern is null (no filter), not an empty match-all', async () => {
    db.answer = () => page([])
    await listStudents('admin-1', 'tenant-a')
    expect(db.calls[0].values.slice(2, 5)).toEqual([null, null, null])
  })

  it('a page past the end is clamped in the statement — the answer names the last page', async () => {
    db.answer = () => page([FULL], 120, 3)
    const { data } = await listStudents('admin-1', 'tenant-a', { page: 9 })
    expect(db.calls[0].text).toContain('least($, greatest(1, ceil(total / $::numeric)::int))')
    expect(data.page).toBe(3)
  })

  it('an error returns an empty page with the error, never a partial one', async () => {
    db.answer = () => new Error('denied')
    const { data, error } = await listStudents('admin-1', 'tenant-a')
    expect(error).toMatchObject({ message: 'denied' })
    expect(data).toEqual({ rows: [], total: 0, page: 1, pageCount: 1, pageSize: PEOPLE_PAGE_SIZE })
  })

  it('an empty institution is one empty page', async () => {
    db.answer = () => page([], 0)
    const { data } = await listStudents('admin-1', 'tenant-a')
    expect(data).toEqual({ rows: [], total: 0, page: 1, pageCount: 1, pageSize: PEOPLE_PAGE_SIZE })
  })
})

describe('listCenterStudents', () => {
  it('one page with name_complete on the rows, plus the active count of the same search', async () => {
    db.answer = () => page([FULL], 10, 1, 7)
    const { data, error } = await listCenterStudents('mgr-1', 'tenant-a', { search: 'sara' })
    expect(error).toBeNull()
    expect(db.calls).toHaveLength(1)
    expect(data.active).toBe(7)
    expect(Object.keys(data.rows[0]).sort()).toEqual(['created_at', 'email', 'full_name', 'id', 'is_active', 'is_university_student', 'name_complete'])
  })
})

describe('listCenterTeachers', () => {
  it('footprints read only the page’s teachers (one statement per table), live rows, tenant-scoped', async () => {
    db.answer = q => {
      if (q.text.includes('from public.users u')) return page([{ ...FULL, id: 't1', role: 'teacher' }, { ...FULL, id: 't2', role: 'teacher' }])
      if (q.text.startsWith('select teacher_id, course_id from public.groups')) return [{ teacher_id: 't1', course_id: null }]
      if (q.text.startsWith('select teacher_id from public.courses')) return [{ teacher_id: 't2' }]
      return new Error('unexpected ' + q.text)
    }
    const { data, error } = await listCenterTeachers('mgr-1', 'tenant-a')
    expect(error).toBeNull()
    const [groups, courses] = db.calls.slice(1)
    for (const q of [groups, courses]) {
      expect(q.text).toContain('tenant_id = $')
      expect(q.text).toContain('deleted_at is null')
      expect(q.values).toEqual(['tenant-a', ['t1', 't2']])
    }
    expect(data.rows.map(r => r.id)).toEqual(['t1', 't2'])
    expect(data.rows[0].footprint).toEqual({ universityGroups: 1, centreItems: 0 })
    expect(data.rows[1].footprint).toEqual({ universityGroups: 0, centreItems: 1 })
    expect(Object.keys(data.rows[0]).sort()).toEqual(['created_at', 'email', 'footprint', 'full_name', 'id', 'is_active'])
  })

  it('an empty page reads no groups or courses', async () => {
    db.answer = () => page([], 0)
    await listCenterTeachers('mgr-1', 'tenant-a')
    expect(db.calls).toHaveLength(1)
  })
})

describe('listTeachers', () => {
  it('one page of TEACHERS only, tenant-scoped, the teacher columns only', async () => {
    db.answer = () => page([{ ...FULL, role: 'teacher' }])
    const { data, error } = await listTeachers('admin-1', 'tenant-a', { search: 'ahmad"' })
    expect(error).toBeNull()
    expect(db.calls[0].values.slice(0, 3)).toEqual(['tenant-a', 'teacher', '%ahmad%'])
    expect(Object.keys(data.rows[0]).sort()).toEqual(['can_create_courses', 'created_at', 'email', 'full_name', 'id', 'is_active'])
  })
})

describe('studentSearchSql (student selector fragment)', () => {
  const capture = async (build: Parameters<typeof import('@/lib/db/sql').run>[1]) => {
    const { run } = await import('@/lib/db/sql')
    await run({ as: 'user', userId: 'x' }, build)
    return db.calls.at(-1)!
  }

  it('a group target: active students of the tenant, name OR email, minus the group members, hard limit', async () => {
    const q = await capture(sql => [studentSearchSql(sql, 'tenant-a', 'sara', { kind: 'group', id: 'g1' })])
    expect(q.text).toContain("u.role = 'student' and u.is_active")
    expect(q.text).toContain('(u.full_name ilike $ or u.email ilike $)')
    expect(q.text).toContain('not exists (select 1 from public.group_students m where m.group_id = $')
    expect(q.text).toContain('u.email')
    expect(q.values).toEqual(['tenant-a', '%sara%', '%sara%', 'g1', STUDENT_SEARCH_LIMIT])
  })

  it('a course target with nameOnly: by name only, no email selected, anti-join on course_enrollments', async () => {
    const q = await capture(sql => [studentSearchSql(sql, 'tenant-a', 'sara', { kind: 'course', id: 'c1' }, { nameOnly: true })])
    expect(q.text).toContain('select u.id, u.full_name from public.users u')
    expect(q.text).not.toContain('email')
    expect(q.text).toContain('public.course_enrollments m where m.course_id = $')
  })

  it('an injection attempt is a bound parameter, never part of the SQL text', async () => {
    const evil = sanitizeSearch('x"),or(role.eq.teacher')
    const q = await capture(sql => [studentSearchSql(sql, 'tenant-a', evil, { kind: 'group', id: 'g1' })])
    expect(q.text).not.toContain('role.eq')
    expect(q.values).toContain(`%${evil}%`)
  })
})

describe('activeTeacherName — the row shows exactly what the old active-teacher list showed', () => {
  it('an active teacher → their name', () => {
    expect(activeTeacherName({ full_name: 'Sara', role: 'teacher', is_active: true })).toBe('Sara')
    expect(activeTeacherName([{ full_name: 'Sara', role: 'teacher', is_active: true }])).toBe('Sara')
  })

  it('a disabled teacher, a non-teacher, no row (another institution / not visible) or an empty name → null («—»)', () => {
    expect(activeTeacherName({ full_name: 'Sara', role: 'teacher', is_active: false })).toBeNull()
    expect(activeTeacherName({ full_name: 'Sara', role: 'student', is_active: true })).toBeNull()
    expect(activeTeacherName(null)).toBeNull()
    expect(activeTeacherName([])).toBeNull()
    expect(activeTeacherName({ full_name: '', role: 'teacher', is_active: true })).toBeNull()
  })
})
