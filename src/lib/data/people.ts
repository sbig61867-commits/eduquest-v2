import type { SupabaseClient } from '@supabase/supabase-js'
import { teacherFootprints, type TeacherFootprint } from '@/lib/account-scope'

/**
 * People directories, one page at a time (PERFORMANCE_CONTRACT.md P1, P2, P10).
 *
 * A directory screen never receives the institution's whole membership: the
 * database returns one page of named columns, the total comes from the same
 * query (count: 'exact'), and search runs in the database. Reads go through
 * the caller's session client, so RLS stays the tenant boundary; the explicit
 * tenant filter is defense in depth.
 */

export const PEOPLE_PAGE_SIZE = 50
const MAX_SEARCH = 100

/**
 * A search term safe to place inside a double-quoted PostgREST filter value
 * (see nameOrEmailFilter). Inside quotes `,` `.` `(` `)` `:` are plain text —
 * so "gmail.com" still finds addresses — while `"` and `\` (which would end or
 * escape the quoting) and the LIKE wildcards `%` `*` (a lone one would match
 * everyone) are removed.
 */
export function sanitizeSearch(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw.replace(/["\\%*]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_SEARCH)
}

/** `or=(…)` value: case-insensitive substring match on name or email. */
export function nameOrEmailFilter(search: string): string {
  return `full_name.ilike."%${search}%",email.ilike."%${search}%"`
}

/** `?page=` as a positive integer (1 when missing or malformed). */
export function parsePage(raw: unknown): number {
  const n = typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 100_000) : 1
}

export interface Page<T> {
  rows: T[]
  total: number
  page: number
  pageCount: number
  pageSize: number
  /** Active members matching the same search — only when asked (countActive). */
  active?: number
}

export interface StudentRow {
  id: string
  email: string
  full_name: string
  avatar_url: string | null
  role: 'student'
  is_active: boolean
  created_at: string
  tenant_id: string
  can_create_courses: boolean | null
  is_university_student: boolean | null
  /** Four-part name on file (student_name_lock_migration.sql). */
  name_complete: boolean | null
}

const STUDENT_COLUMNS =
  'id, email, full_name, avatar_url, role, is_active, created_at, tenant_id, can_create_courses, is_university_student, name_complete'

export interface TeacherRow {
  id: string
  email: string
  full_name: string
  is_active: boolean
  created_at: string
  can_create_courses: boolean | null
}

/** Exactly what /admin/teachers renders — no avatar/role/tenant it never shows. */
const TEACHER_COLUMNS = 'id, email, full_name, is_active, created_at, can_create_courses'

/** /center/students: what the centre people table renders, name flag on the same rows. */
export interface CenterStudentRow {
  id: string
  full_name: string
  email: string
  is_active: boolean
  created_at: string
  is_university_student: boolean | null
  name_complete: boolean | null
}

const CENTER_STUDENT_COLUMNS = 'id, full_name, email, is_active, created_at, is_university_student, name_complete'

/** PostgREST: the requested range starts past the last row. */
const RANGE_NOT_SATISFIABLE = 'PGRST103'

type ListOptions = { search?: string; page?: number; pageSize?: number }

/**
 * One page of an institution's members of one role, newest first, optionally
 * filtered by a name/email search. A page past the end is answered with the
 * last page of the SAME search.
 */
async function listByRole<T>(
  db: SupabaseClient,
  tenantId: string,
  role: 'student' | 'teacher',
  columns: string,
  opts: ListOptions & { countActive?: boolean },
): Promise<{ data: Page<T>; error: { message: string } | null }> {
  const pageSize = opts.pageSize ?? PEOPLE_PAGE_SIZE
  const search = sanitizeSearch(opts.search)

  // One filter for the page and for the past-the-end count, so both agree.
  const filtered = (select: string, head: boolean) => {
    let query = db
      .from('users')
      .select(select, head ? { count: 'exact', head: true } : { count: 'exact' })
      .eq('tenant_id', tenantId)
      .eq('role', role)
    if (search) query = query.or(nameOrEmailFilter(search))
    return query
  }

  const fetchPage = (page: number) => {
    const from = (page - 1) * pageSize
    return filtered(columns, false)
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1)
  }

  let page = opts.page ?? 1
  // The active count (same search) runs beside the page, not after it.
  const [first, activeRes] = await Promise.all([
    fetchPage(page),
    opts.countActive ? filtered('id', true).eq('is_active', true) : null,
  ])
  let res = first
  if (res.error?.code === RANGE_NOT_SATISFIABLE) {
    // Asked for a page past the end (e.g. after deletions): count, then serve the last page.
    const { count } = await filtered('id', true)
    page = Math.max(1, Math.ceil((count ?? 0) / pageSize))
    res = await fetchPage(page)
  }
  const error = res.error ?? activeRes?.error ?? null
  if (error) {
    return { data: { rows: [], total: 0, page: 1, pageCount: 1, pageSize, ...(activeRes ? { active: 0 } : {}) }, error }
  }
  const total = res.count ?? 0
  return {
    data: {
      rows: (res.data ?? []) as unknown as T[],
      total,
      page,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
      pageSize,
      ...(activeRes ? { active: activeRes.count ?? 0 } : {}),
    },
    error: null,
  }
}

/** One page of an institution's students (/admin/students). */
export function listStudents(db: SupabaseClient, tenantId: string, opts: ListOptions = {}) {
  return listByRole<StudentRow>(db, tenantId, 'student', STUDENT_COLUMNS, opts)
}

/**
 * One page of an institution's students for the centre manager (/center/students),
 * with the four-part-name flag on the same rows and the active count for the summary.
 */
export function listCenterStudents(db: SupabaseClient, tenantId: string, opts: ListOptions = {}) {
  return listByRole<CenterStudentRow>(db, tenantId, 'student', CENTER_STUDENT_COLUMNS, { ...opts, countActive: true })
}

export interface CenterTeacherRow {
  id: string
  full_name: string
  email: string
  is_active: boolean
  created_at: string
  /** Live university groups / centre items of this teacher (src/lib/account-scope.ts). */
  footprint: TeacherFootprint
}

const CENTER_TEACHER_COLUMNS = 'id, full_name, email, is_active, created_at'

/**
 * One page of an institution's teachers for the centre manager (/center/teachers),
 * with the active count and each teacher's footprint — which decides whether the
 * centre may (de)activate them. The footprint reads only the groups and courses
 * of THIS page's teachers (P4: one batched `.in()` per table, never one call per
 * row); a teacher's footprint depends on their own rows only, so the result is
 * the same as computing it from the whole institution
 * (supabase/tests/center_teachers_list_check.sql, L1).
 */
export async function listCenterTeachers(db: SupabaseClient, tenantId: string, opts: ListOptions = {}) {
  const res = await listByRole<Omit<CenterTeacherRow, 'footprint'>>(
    db, tenantId, 'teacher', CENTER_TEACHER_COLUMNS, { ...opts, countActive: true },
  )
  const ids = res.data.rows.map(r => r.id)
  // Restricted to this page's teachers (≤ pageSize = 50) and used only here to
  // decide the lock — never sent to the browser. Not hard-row-limited: it returns
  // every live group/course those teachers own (a .limit() could flip a lock).
  const [{ data: groups }, { data: courses }] = ids.length
    ? await Promise.all([
        db.from('groups').select('teacher_id, course_id').eq('tenant_id', tenantId).in('teacher_id', ids).is('deleted_at', null),
        db.from('courses').select('teacher_id').eq('tenant_id', tenantId).in('teacher_id', ids).is('deleted_at', null),
      ])
    : [{ data: [] }, { data: [] }]
  const footprints = teacherFootprints(groups ?? [], courses ?? [])
  const rows: CenterTeacherRow[] = res.data.rows.map(r => ({
    ...r,
    footprint: footprints.get(r.id) ?? { universityGroups: 0, centreItems: 0 },
  }))
  return { data: { ...res.data, rows }, error: res.error }
}

/** Hard server-side cap on a student search (the selector never receives more). */
export const STUDENT_SEARCH_LIMIT = 20

export interface StudentSearchRow {
  id: string
  full_name: string
  email: string
}

/** Whose members a student search leaves out: a group roster or a course's enrolments. */
export type RosterTarget = { group: string } | { course: string }

/** `or=(…)` value: case-insensitive substring match on the name only. */
export function nameFilter(search: string): string {
  return `full_name.ilike."%${search}%"`
}

// The membership table each target is anti-joined on (left embed through the
// student's FK, filtered to the target, then `<table>=is.null`).
const MEMBERSHIP = {
  group: { table: 'group_students', fk: 'group_students_student_id_fkey', column: 'group_id' },
  course: { table: 'course_enrollments', fk: 'course_enrollments_student_id_fkey', column: 'course_id' },
} as const

/**
 * Student selector: at most STUDENT_SEARCH_LIMIT active students of the
 * institution matching `q`, excluding those already in the target — never the
 * institution's whole student body.
 *   - /teacher/groups «إدارة الطلاب» (T1): `target` is the group id; name or
 *     email, and the email comes back (the teacher screen shows it).
 *   - RosterModal on /center/groups and /center/courses (C-S): `{ group }` or
 *     `{ course }` with `nameOnly` — searched by name and returned without the
 *     email, the same data those pages sent before (id + name).
 *
 * The exclusion is a PostgREST anti-join (left-embed the membership table
 * filtered to the target, then `<table>=is.null`), so no member list is read or
 * sent and no id list grows the URL. Runs on the caller's session: RLS decides
 * which students and memberships are visible; the tenant, role and active
 * filters are defence in depth and keep the result to students. An empty `q`
 * returns nothing and touches no table.
 */
export async function searchStudents(
  db: SupabaseClient,
  tenantId: string,
  q: string,
  target: string | RosterTarget,
  opts: { nameOnly?: boolean } = {},
): Promise<{ rows: Array<Pick<StudentSearchRow, 'id' | 'full_name'> & { email?: string }>; error: { message: string } | null }> {
  const search = sanitizeSearch(q)
  if (!search) return { rows: [], error: null }
  const kind: keyof typeof MEMBERSHIP = typeof target === 'string' || 'group' in target ? 'group' : 'course'
  const targetId = typeof target === 'string' ? target : 'group' in target ? target.group : target.course
  const m = MEMBERSHIP[kind]
  const nameOnly = opts.nameOnly === true
  const { data, error } = await db
    .from('users')
    .select(`${nameOnly ? 'id, full_name' : 'id, full_name, email'}, ${m.table}!${m.fk}(${m.column})`)
    .eq('tenant_id', tenantId)
    .eq('role', 'student')
    .eq('is_active', true)
    .or(nameOnly ? nameFilter(search) : nameOrEmailFilter(search))
    .eq(`${m.table}.${m.column}`, targetId)
    .is(m.table, null)
    .order('full_name', { ascending: true })
    .order('id', { ascending: true })
    .limit(STUDENT_SEARCH_LIMIT)
  if (error) return { rows: [], error }
  // Only the fields the selector shows; the (empty) embed is dropped.
  const rows = ((data ?? []) as unknown as StudentSearchRow[])
    .slice(0, STUDENT_SEARCH_LIMIT)
    .map(({ id, full_name, email }) => (nameOnly ? { id, full_name } : { id, full_name, email }))
  return { rows, error: null }
}

/**
 * Recipient search of /center/mail: at most STUDENT_SEARCH_LIMIT active students
 * of the institution whose name or email matches `q` — the same set and fields
 * (id, name, email) the page used to send for EVERY active student. Runs on the
 * caller's session (RLS); tenant / role / active are defence in depth. An empty
 * `q` touches no table.
 */
export async function searchActiveStudents(
  db: SupabaseClient,
  tenantId: string,
  q: string,
): Promise<{ rows: StudentSearchRow[]; error: { message: string } | null }> {
  const search = sanitizeSearch(q)
  if (!search) return { rows: [], error: null }
  const { data, error } = await db
    .from('users')
    .select('id, full_name, email')
    .eq('tenant_id', tenantId)
    .eq('role', 'student')
    .eq('is_active', true)
    .or(nameOrEmailFilter(search))
    .order('full_name', { ascending: true })
    .order('id', { ascending: true })
    .limit(STUDENT_SEARCH_LIMIT)
  if (error) return { rows: [], error }
  const rows = ((data ?? []) as unknown as StudentSearchRow[])
    .slice(0, STUDENT_SEARCH_LIMIT)
    .map(({ id, full_name, email }) => ({ id, full_name, email }))
  return { rows, error: null }
}

/** A teacher embedded on a group/course row: teacher:users!…_teacher_id_fkey(full_name, role, is_active). */
export interface EmbeddedTeacher {
  full_name: string | null
  role: string | null
  is_active: boolean | null
}

/**
 * The teacher name a centre group/course row shows — exactly what the old
 * full list of ACTIVE teachers produced: the name of an active teacher of the
 * institution, otherwise null, which the row shows as «—» (a disabled or
 * removed teacher, or one RLS does not let the caller see). No new display.
 */
export function activeTeacherName(t: EmbeddedTeacher | EmbeddedTeacher[] | null | undefined): string | null {
  const one = Array.isArray(t) ? t[0] : t
  if (!one || one.role !== 'teacher' || one.is_active !== true) return null
  return one.full_name || null
}

/** Hard server-side cap on a teacher search (the selector never receives more). */
export const TEACHER_SEARCH_LIMIT = 20

export interface TeacherSearchRow {
  id: string
  full_name: string
}

/**
 * Teacher selector (/center/groups and /center/courses — create, «تغيير المعلم»):
 * at most TEACHER_SEARCH_LIMIT active teachers of the institution whose name
 * matches `q` — never the institution's whole teaching staff.
 *
 * Same set and fields the pages used to send (active teachers, id + name), so
 * no new data is exposed: the search is by name only and returns no email.
 * Runs on the caller's session, so RLS stays the tenant boundary; the tenant,
 * role and active filters are defence in depth. An empty `q` touches no table.
 */
export async function searchTeachers(
  db: SupabaseClient,
  tenantId: string,
  q: string,
): Promise<{ rows: TeacherSearchRow[]; error: { message: string } | null }> {
  const search = sanitizeSearch(q)
  if (!search) return { rows: [], error: null }
  const { data, error } = await db
    .from('users')
    .select('id, full_name')
    .eq('tenant_id', tenantId)
    .eq('role', 'teacher')
    .eq('is_active', true)
    .ilike('full_name', `%${search}%`)
    .order('full_name', { ascending: true })
    .order('id', { ascending: true })
    .limit(TEACHER_SEARCH_LIMIT)
  if (error) return { rows: [], error }
  const rows = ((data ?? []) as unknown as TeacherSearchRow[])
    .slice(0, TEACHER_SEARCH_LIMIT)
    .map(({ id, full_name }) => ({ id, full_name }))
  return { rows, error: null }
}

/** One page of an institution's teachers (/admin/teachers). */
export function listTeachers(db: SupabaseClient, tenantId: string, opts: ListOptions = {}) {
  return listByRole<TeacherRow>(db, tenantId, 'teacher', TEACHER_COLUMNS, opts)
}
