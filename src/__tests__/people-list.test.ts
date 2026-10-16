// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { activeTeacherName, listCenterStudents, listCenterTeachers, listStudents, listTeachers, nameOrEmailFilter, parsePage, sanitizeSearch, searchStudents, searchTeachers, PEOPLE_PAGE_SIZE, STUDENT_SEARCH_LIMIT, TEACHER_SEARCH_LIMIT } from '@/lib/data/people'

/**
 * Batch 2 — admin students: one page from the database (PERFORMANCE_CONTRACT.md P1).
 * The fake client records every call so the query shape itself is asserted:
 * tenant + role filters always, a range of one page, an exact count, the
 * search only when there is one.
 */

type Call = [string, ...unknown[]]

function fakeDb(pages: Array<{ data?: unknown[]; count?: number; error?: { code?: string; message: string } }>, headCount = 0) {
  const queries: Call[][] = []
  let n = 0
  const db = {
    from(table: string) {
      const calls: Call[] = [['from', table]]
      queries.push(calls)
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'or', 'order', 'range', 'in', 'is', 'limit', 'ilike']) {
        chain[m] = (...args: unknown[]) => { calls.push([m, ...args]); return chain }
      }
      chain.then = (resolve: (v: unknown) => unknown) => {
        const isHead = calls.some(c => c[0] === 'select' && (c[2] as { head?: boolean } | undefined)?.head)
        const reply = isHead ? { count: headCount, error: null } : { data: [], count: 0, error: null, ...pages[n++] }
        return Promise.resolve(reply).then(resolve)
      }
      return chain
    },
  }
  return { db: db as never, queries }
}

describe('sanitizeSearch — safe inside a quoted PostgREST value', () => {
  it('keeps normal text, dots and punctuation (so emails are searchable)', () => {
    expect(sanitizeSearch('  Sara  Ali ')).toBe('Sara Ali')
    expect(sanitizeSearch('gmail.com')).toBe('gmail.com')
    expect(sanitizeSearch("O'Brien (x), a:b")).toBe("O'Brien (x), a:b")
    expect(sanitizeSearch('سارة')).toBe('سارة')
  })

  it('removes what could end the quoting or match everyone', () => {
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

  it('the filter quotes the term for both columns', () => {
    expect(nameOrEmailFilter('a.b')).toBe('full_name.ilike."%a.b%",email.ilike."%a.b%"')
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
  it('asks for exactly one page, scoped to the tenant and to students, with an exact count', async () => {
    const { db, queries } = fakeDb([{ data: [{ id: 's1' }], count: 120 }])
    const { data, error } = await listStudents(db, 'tenant-a', { page: 2 })
    expect(error).toBeNull()
    const q = queries[0]
    expect(q).toContainEqual(['from', 'users'])
    expect(q).toContainEqual(['eq', 'tenant_id', 'tenant-a'])
    expect(q).toContainEqual(['eq', 'role', 'student'])
    expect(q).toContainEqual(['range', PEOPLE_PAGE_SIZE, 2 * PEOPLE_PAGE_SIZE - 1])
    const select = q.find(c => c[0] === 'select')!
    expect(select[1]).not.toContain('*')
    expect(select[1]).toContain('name_complete')
    expect(select[2]).toEqual({ count: 'exact' })
    expect(q.some(c => c[0] === 'or')).toBe(false)
    expect(data).toMatchObject({ total: 120, page: 2, pageCount: 3, pageSize: PEOPLE_PAGE_SIZE })
  })

  it('searches in the database with the sanitized, quoted term', async () => {
    const { db, queries } = fakeDb([{ data: [], count: 0 }])
    await listStudents(db, 'tenant-a', { search: 'gmail.com%' })
    expect(queries[0]).toContainEqual(['or', 'full_name.ilike."%gmail.com%",email.ilike."%gmail.com%"'])
  })

  it('a page past the end is answered with the last page', async () => {
    const { db, queries } = fakeDb([
      { error: { code: 'PGRST103', message: 'Requested range not satisfiable' } },
      { data: [{ id: 'last' }], count: 101 },
    ], 101)
    const { data, error } = await listStudents(db, 'tenant-a', { page: 9 })
    expect(error).toBeNull()
    expect(data.page).toBe(3)
    expect(queries.at(-1)).toContainEqual(['range', 100, 149])
  })

  it('past the end WITH a search, the fallback count uses the same search (not the whole role)', async () => {
    // 12 matches: ?q=…&page=5 must land on page 1 of the 12, not on page 3 of everyone.
    const { db, queries } = fakeDb([
      { error: { code: 'PGRST103', message: 'Requested range not satisfiable' } },
      { data: [{ id: 'm1' }], count: 12 },
    ], 12)
    const { data, error } = await listStudents(db, 'tenant-a', { search: 'Test Student', page: 5 })
    expect(error).toBeNull()
    const countQuery = queries[1]
    expect(countQuery.find(c => c[0] === 'select')?.[2]).toEqual({ count: 'exact', head: true })
    expect(countQuery).toContainEqual(['eq', 'tenant_id', 'tenant-a'])
    expect(countQuery).toContainEqual(['eq', 'role', 'student'])
    expect(countQuery).toContainEqual(['or', nameOrEmailFilter('Test Student')])
    expect(data.page).toBe(1)
    expect(queries.at(-1)).toContainEqual(['range', 0, PEOPLE_PAGE_SIZE - 1])
  })

  it('an error returns an empty page with the error', async () => {
    const { db } = fakeDb([{ error: { code: '42501', message: 'denied' } }])
    const { data, error } = await listStudents(db, 'tenant-a')
    expect(error).toMatchObject({ message: 'denied' })
    expect(data).toMatchObject({ rows: [], total: 0 })
  })

  it('an empty institution is one empty page', async () => {
    const { db } = fakeDb([{ data: [], count: 0 }])
    const { data } = await listStudents(db, 'tenant-a')
    expect(data).toMatchObject({ rows: [], total: 0, page: 1, pageCount: 1 })
  })
})

describe('listCenterStudents', () => {
  it('one page with name_complete on the rows, plus an active count with the same filters', async () => {
    const { db, queries } = fakeDb([{ data: [{ id: 's1' }], count: 20000 }], 17143)
    const { data, error } = await listCenterStudents(db, 'tenant-a', { search: 'sara', page: 1 })
    expect(error).toBeNull()
    const pageQ = queries.find(q => q.some(c => c[0] === 'range'))!
    expect(pageQ.find(c => c[0] === 'select')?.[1]).toBe('id, full_name, email, is_active, created_at, is_university_student, name_complete')
    expect(pageQ).toContainEqual(['eq', 'role', 'student'])
    // Isolation: the rows themselves are scoped to the caller's tenant, not only the count.
    expect(pageQ).toContainEqual(['eq', 'tenant_id', 'tenant-a'])
    const activeQ = queries.find(q => q.some(c => c[0] === 'eq' && c[1] === 'is_active'))!
    expect(activeQ.find(c => c[0] === 'select')?.[2]).toEqual({ count: 'exact', head: true })
    expect(activeQ).toContainEqual(['eq', 'tenant_id', 'tenant-a'])
    expect(activeQ).toContainEqual(['eq', 'role', 'student'])
    expect(activeQ).toContainEqual(['or', nameOrEmailFilter('sara')])
    expect(activeQ).toContainEqual(['eq', 'is_active', true])
    expect(queries).toHaveLength(2)
    expect(data).toMatchObject({ total: 20000, active: 17143, pageCount: 400 })
  })

  it('the plain students list asks for no active count', async () => {
    const { db, queries } = fakeDb([{ data: [], count: 0 }])
    const { data } = await listStudents(db, 'tenant-a')
    expect(queries).toHaveLength(1)
    expect(data.active).toBeUndefined()
  })
})

describe('listCenterTeachers', () => {
  it('footprints read only the page’s teachers, batched (.in), live rows, tenant-scoped', async () => {
    const { db, queries } = fakeDb([
      { data: [{ id: 't1' }, { id: 't2' }, { id: 't3' }], count: 2000 },
      // groups of the page's teachers: t1 a university group, t2 a course-linked group
      { data: [{ teacher_id: 't1', course_id: null }, { teacher_id: 't2', course_id: 'c9' }] },
      // courses of the page's teachers: t2 owns one
      { data: [{ teacher_id: 't2' }] },
    ], 1715)
    const { data, error } = await listCenterTeachers(db, 'tenant-a', { page: 1 })
    expect(error).toBeNull()
    expect(data).toMatchObject({ total: 2000, active: 1715, pageCount: 40 })

    const pageQ = queries.find(q => q.some(c => c[0] === 'range'))!
    expect(pageQ.find(c => c[0] === 'select')?.[1]).toBe('id, full_name, email, is_active, created_at')
    expect(pageQ).toContainEqual(['eq', 'role', 'teacher'])

    for (const table of ['groups', 'courses']) {
      const q = queries.find(x => x[0][1] === table)!
      expect(q).toContainEqual(['eq', 'tenant_id', 'tenant-a'])
      expect(q).toContainEqual(['in', 'teacher_id', ['t1', 't2', 't3']])
      expect(q).toContainEqual(['is', 'deleted_at', null])
    }
    expect(queries).toHaveLength(4) // page, active count, groups, courses — not one per teacher

    const fp = Object.fromEntries(data.rows.map(r => [r.id, r.footprint]))
    expect(fp).toEqual({
      t1: { universityGroups: 1, centreItems: 0 },
      t2: { universityGroups: 0, centreItems: 2 },
      t3: { universityGroups: 0, centreItems: 0 },
    })
  })

  it('an empty page reads no groups or courses', async () => {
    const { db, queries } = fakeDb([{ data: [], count: 0 }])
    const { data } = await listCenterTeachers(db, 'tenant-a')
    expect(data.rows).toEqual([])
    expect(queries.some(q => q[0][1] === 'groups' || q[0][1] === 'courses')).toBe(false)
  })
})

describe('listTeachers', () => {
  it('one page of TEACHERS only, tenant-scoped, named columns, exact count', async () => {
    const { db, queries } = fakeDb([{ data: [{ id: 't1' }], count: 2000 }])
    const { data, error } = await listTeachers(db, 'tenant-a', { page: 40 })
    expect(error).toBeNull()
    const q = queries[0]
    expect(q).toContainEqual(['eq', 'tenant_id', 'tenant-a'])
    expect(q).toContainEqual(['eq', 'role', 'teacher'])
    expect(q).not.toContainEqual(['eq', 'role', 'student'])
    expect(q).toContainEqual(['range', 39 * PEOPLE_PAGE_SIZE, 40 * PEOPLE_PAGE_SIZE - 1])
    const select = q.find(c => c[0] === 'select')!
    expect(select[1]).toBe('id, email, full_name, is_active, created_at, can_create_courses')
    expect(select[2]).toEqual({ count: 'exact' })
    expect(data).toMatchObject({ total: 2000, page: 40, pageCount: 40 })
  })

  it('searches in the database and counts past the end with the same search', async () => {
    const { db, queries } = fakeDb([
      { error: { code: 'PGRST103', message: 'Requested range not satisfiable' } },
      { data: [], count: 3 },
    ], 3)
    const { data } = await listTeachers(db, 'tenant-a', { search: 'ahmad"', page: 7 })
    expect(queries[0]).toContainEqual(['or', nameOrEmailFilter('ahmad')])
    expect(queries[1]).toContainEqual(['or', nameOrEmailFilter('ahmad')])
    expect(queries[1]).toContainEqual(['eq', 'role', 'teacher'])
    expect(data.page).toBe(1)
  })
})

describe('searchStudents (T1 student selector)', () => {
  const GROUP = '11111111-1111-4111-8111-111111111111'

  it('an empty or wildcard-only search touches no table and returns nothing', async () => {
    for (const q of ['', '   ', '%', '*', '"\\', ' % * ']) {
      const { db, queries } = fakeDb([])
      const { rows, error } = await searchStudents(db, 'tenant-a', q, GROUP)
      expect(error).toBeNull()
      expect(rows).toEqual([])
      expect(queries).toHaveLength(0)
    }
  })

  it('active students of the tenant only, sanitized name/email search, anti-join on the group, hard limit 20', async () => {
    const { db, queries } = fakeDb([{ data: [] }])
    await searchStudents(db, 'tenant-a', 'gmail.com%', GROUP)
    expect(queries).toHaveLength(1)
    const q = queries[0]
    expect(q).toContainEqual(['from', 'users'])
    expect(q.find(c => c[0] === 'select')?.[1]).toBe('id, full_name, email, group_students!group_students_student_id_fkey(group_id)')
    expect(q).toContainEqual(['eq', 'tenant_id', 'tenant-a'])
    expect(q).toContainEqual(['eq', 'role', 'student'])
    expect(q).toContainEqual(['eq', 'is_active', true])
    expect(q).toContainEqual(['or', 'full_name.ilike."%gmail.com%",email.ilike."%gmail.com%"'])
    expect(q).toContainEqual(['eq', 'group_students.group_id', GROUP])
    expect(q).toContainEqual(['is', 'group_students', null])
    expect(q).toContainEqual(['limit', STUDENT_SEARCH_LIMIT])
    expect(STUDENT_SEARCH_LIMIT).toBe(20)
    expect(q.some(c => c[0] === 'range')).toBe(false)
  })

  it('an injection attempt stays inside one quoted value and cannot add a filter', async () => {
    const { db, queries } = fakeDb([{ data: [] }])
    await searchStudents(db, 'tenant-a', 'x"),or(role.eq.teacher,tenant_id.neq.0', GROUP)
    const or = queries[0].filter(c => c[0] === 'or')
    expect(or).toHaveLength(1)
    // The `"` that would close the quoting is removed, so everything stays one literal value.
    expect(or[0][1]).toBe('full_name.ilike."%x ),or(role.eq.teacher,tenant_id.neq.0%",email.ilike."%x ),or(role.eq.teacher,tenant_id.neq.0%"')
    // The role/tenant filters are separate conditions the search cannot widen.
    expect(queries[0]).toContainEqual(['eq', 'role', 'student'])
    expect(queries[0]).toContainEqual(['eq', 'tenant_id', 'tenant-a'])
  })

  it('never returns more than 20 rows, and only id / full_name / email', async () => {
    const many = Array.from({ length: 35 }, (_, i) => ({
      id: `s${i}`, full_name: `S ${i}`, email: `s${i}@x.test`, group_students: [], role: 'student', permissions: { x: 1 },
    }))
    const { db } = fakeDb([{ data: many }])
    const { rows } = await searchStudents(db, 'tenant-a', 's', GROUP)
    expect(rows).toHaveLength(20)
    for (const r of rows) expect(Object.keys(r).sort()).toEqual(['email', 'full_name', 'id'])
  })

  it('a database error returns no rows and the error', async () => {
    const { db } = fakeDb([{ error: { message: 'denied' } }])
    const { rows, error } = await searchStudents(db, 'tenant-a', 'sara', GROUP)
    expect(rows).toEqual([])
    expect(error).toMatchObject({ message: 'denied' })
  })
})

describe('searchTeachers (C-T teacher selector)', () => {
  it('an empty or wildcard-only search touches no table and returns nothing', async () => {
    for (const q of ['', '   ', '%', '*', '"\\', ' % * ']) {
      const { db, queries } = fakeDb([])
      const { rows, error } = await searchTeachers(db, 'tenant-a', q)
      expect(error).toBeNull()
      expect(rows).toEqual([])
      expect(queries).toHaveLength(0)
    }
  })

  it('active teachers of the tenant only, by NAME (no email), hard limit 20, two fields', async () => {
    const { db, queries } = fakeDb([{ data: [] }])
    await searchTeachers(db, 'tenant-a', 'sara%')
    expect(queries).toHaveLength(1)
    const q = queries[0]
    expect(q).toContainEqual(['from', 'users'])
    expect(q.find(c => c[0] === 'select')?.[1]).toBe('id, full_name')
    expect(q).toContainEqual(['eq', 'tenant_id', 'tenant-a'])
    expect(q).toContainEqual(['eq', 'role', 'teacher'])
    expect(q).toContainEqual(['eq', 'is_active', true])
    expect(q).toContainEqual(['ilike', 'full_name', '%sara%'])
    expect(q.some(c => c[0] === 'or')).toBe(false) // never searches or reveals the email
    expect(q).toContainEqual(['limit', TEACHER_SEARCH_LIMIT])
    expect(TEACHER_SEARCH_LIMIT).toBe(20)
  })

  it('an injection attempt stays one literal ilike value; role/tenant/active stay separate conditions', async () => {
    const { db, queries } = fakeDb([{ data: [] }])
    await searchTeachers(db, 'tenant-a', 'x"),or(role.eq.student,tenant_id.neq.0')
    const q = queries[0]
    expect(q.filter(c => c[0] === 'ilike')).toEqual([['ilike', 'full_name', '%x ),or(role.eq.student,tenant_id.neq.0%']])
    expect(q.some(c => c[0] === 'or')).toBe(false)
    expect(q).toContainEqual(['eq', 'role', 'teacher'])
    expect(q).toContainEqual(['eq', 'tenant_id', 'tenant-a'])
  })

  it('never returns more than 20 rows, and only id / full_name', async () => {
    const many = Array.from({ length: 35 }, (_, i) => ({ id: `t${i}`, full_name: `T ${i}`, email: `t${i}@x.test`, role: 'teacher' }))
    const { db } = fakeDb([{ data: many }])
    const { rows } = await searchTeachers(db, 'tenant-a', 't')
    expect(rows).toHaveLength(20)
    for (const r of rows) expect(Object.keys(r).sort()).toEqual(['full_name', 'id'])
  })

  it('a database error returns no rows and the error', async () => {
    const { db } = fakeDb([{ error: { message: 'denied' } }])
    const { rows, error } = await searchTeachers(db, 'tenant-a', 'sara')
    expect(rows).toEqual([])
    expect(error).toMatchObject({ message: 'denied' })
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

describe('searchStudents with a roster target (C-S: RosterModal, name only)', () => {
  const COURSE = '22222222-2222-4222-8222-222222222222'
  const GROUP = '11111111-1111-4111-8111-111111111111'

  it('a course target: anti-join on course_enrollments, by NAME only, no email selected', async () => {
    const { db, queries } = fakeDb([{ data: [] }])
    await searchStudents(db, 'tenant-a', 'sara', { course: COURSE }, { nameOnly: true })
    const q = queries[0]
    expect(q.find(c => c[0] === 'select')?.[1]).toBe('id, full_name, course_enrollments!course_enrollments_student_id_fkey(course_id)')
    expect(q).toContainEqual(['eq', 'course_enrollments.course_id', COURSE])
    expect(q).toContainEqual(['is', 'course_enrollments', null])
    expect(q).not.toContainEqual(['is', 'group_students', null])
    expect(q).toContainEqual(['or', 'full_name.ilike."%sara%"'])
    expect(q).toContainEqual(['eq', 'tenant_id', 'tenant-a'])
    expect(q).toContainEqual(['eq', 'role', 'student'])
    expect(q).toContainEqual(['eq', 'is_active', true])
    expect(q).toContainEqual(['limit', 20])
  })

  it('a group target object: anti-join on group_students for THAT group', async () => {
    const { db, queries } = fakeDb([{ data: [] }])
    await searchStudents(db, 'tenant-a', 'sara', { group: GROUP }, { nameOnly: true })
    const q = queries[0]
    expect(q.find(c => c[0] === 'select')?.[1]).toBe('id, full_name, group_students!group_students_student_id_fkey(group_id)')
    expect(q).toContainEqual(['eq', 'group_students.group_id', GROUP])
    expect(q).toContainEqual(['is', 'group_students', null])
  })

  it('T1 is unchanged: a plain group id still searches name OR email and returns the email', async () => {
    const { db, queries } = fakeDb([{ data: [{ id: 's1', full_name: 'S', email: 's@x.test', group_students: [] }] }])
    const { rows } = await searchStudents(db, 'tenant-a', 'sara', GROUP)
    expect(queries[0].find(c => c[0] === 'select')?.[1]).toBe('id, full_name, email, group_students!group_students_student_id_fkey(group_id)')
    expect(queries[0]).toContainEqual(['or', nameOrEmailFilter('sara')])
    expect(rows).toEqual([{ id: 's1', full_name: 'S', email: 's@x.test' }])
  })

  it('name only never returns an email, even if one came back; at most 20 rows', async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `s${i}`, full_name: `S ${i}`, email: `s${i}@x.test`, course_enrollments: [] }))
    const { db } = fakeDb([{ data: many }])
    const { rows } = await searchStudents(db, 'tenant-a', 's', { course: COURSE }, { nameOnly: true })
    expect(rows).toHaveLength(20)
    for (const r of rows) expect(Object.keys(r).sort()).toEqual(['full_name', 'id'])
  })

  it('an injection attempt stays one quoted literal in the name filter', async () => {
    const { db, queries } = fakeDb([{ data: [] }])
    await searchStudents(db, 'tenant-a', 'x"),or(role.eq.teacher', { course: COURSE }, { nameOnly: true })
    const or = queries[0].filter(c => c[0] === 'or')
    expect(or).toEqual([['or', 'full_name.ilike."%x ),or(role.eq.teacher%"']])
  })

  it('an empty or wildcard-only search touches no table', async () => {
    const { db, queries } = fakeDb([])
    const { rows } = await searchStudents(db, 'tenant-a', ' % ', { course: COURSE }, { nameOnly: true })
    expect(rows).toEqual([])
    expect(queries).toHaveLength(0)
  })
})
