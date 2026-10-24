import { run, type Sql } from '@/lib/db/sql'
import { teacherFootprints, type TeacherFootprint } from '@/lib/account-scope'

/**
 * People directories, one page at a time (PERFORMANCE_CONTRACT.md P1, P2, P10).
 *
 * A directory screen never receives the institution's whole membership: the
 * database returns one page of named columns, the total comes from the same
 * statement, and search runs in the database. Reads run as the caller, so RLS
 * stays the tenant boundary; the explicit tenant filter is defense in depth.
 */

export const PEOPLE_PAGE_SIZE = 50
const MAX_SEARCH = 100

/**
 * A search term for a bound ILIKE pattern: `,` `.` `(` `)` `:` are plain text —
 * so "gmail.com" still finds addresses — while the LIKE wildcards `%` `*` (a
 * lone one would match everyone) and `"` `\` are removed.
 */
export function sanitizeSearch(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw.replace(/["\\%*]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_SEARCH)
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

const STUDENT_COLUMNS = ['id', 'email', 'full_name', 'avatar_url', 'role', 'is_active', 'created_at', 'tenant_id', 'can_create_courses', 'is_university_student', 'name_complete']

export interface TeacherRow {
  id: string
  email: string
  full_name: string
  is_active: boolean
  created_at: string
  can_create_courses: boolean | null
}

/** Exactly what /admin/teachers renders — no avatar/role/tenant it never shows. */
const TEACHER_COLUMNS = ['id', 'email', 'full_name', 'is_active', 'created_at', 'can_create_courses']

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

const CENTER_STUDENT_COLUMNS = ['id', 'full_name', 'email', 'is_active', 'created_at', 'is_university_student', 'name_complete']

type ListOptions = { search?: string; page?: number; pageSize?: number }

/**
 * One page of an institution's members of one role, newest first, optionally
 * filtered by a name/email search — ONE statement read as the caller: the
 * total (and active count) of the same search, the page clamped to the last
 * one, and its rows. The statement reads one superset of columns; only
 * `columns` leave this function.
 */
async function listByRole<T>(
  userId: string,
  tenantId: string,
  role: 'student' | 'teacher',
  columns: readonly string[],
  opts: ListOptions & { countActive?: boolean },
): Promise<{ data: Page<T>; error: { message: string } | null }> {
  const pageSize = opts.pageSize ?? PEOPLE_PAGE_SIZE
  const search = sanitizeSearch(opts.search)
  const pattern = search ? `%${search}%` : null
  const empty = { rows: [], total: 0, page: 1, pageCount: 1, pageSize, ...(opts.countActive ? { active: 0 } : {}) }
  try {
    const [rows] = await run({ as: 'user', userId }, sql => [
      sql`with m as (
             select u.id, u.email, u.full_name, u.avatar_url, u.role, u.is_active, u.created_at, u.tenant_id,
                    u.can_create_courses, u.is_university_student, u.name_complete
               from public.users u
              where u.tenant_id = ${tenantId} and u.role = ${role}
                and (${pattern}::text is null or u.full_name ilike ${pattern} or u.email ilike ${pattern})),
           t as (select count(*)::int as total, count(*) filter (where is_active)::int as active from m),
           pg as (select least(${opts.page ?? 1}, greatest(1, ceil(total / ${pageSize}::numeric)::int)) as p from t)
      select (select total from t) as total, (select active from t) as active, (select p from pg) as page,
             coalesce((select json_agg(row_to_json(x) order by x.created_at desc, x.id)
                         from (select * from m order by created_at desc, id
                                limit ${pageSize} offset ((select p from pg) - 1) * ${pageSize}) x), '[]') as rows`,
    ])
    const r = rows[0] as { total: number; active: number; page: number; rows: Record<string, unknown>[] } | undefined
    if (!r) return { data: empty, error: null }
    return {
      data: {
        rows: r.rows.map(row => Object.fromEntries(columns.map(c => [c, row[c] ?? null]))) as unknown as T[],
        total: r.total,
        page: r.page,
        pageCount: Math.max(1, Math.ceil(r.total / pageSize)),
        pageSize,
        ...(opts.countActive ? { active: r.active } : {}),
      },
      error: null,
    }
  } catch (e) {
    return { data: empty, error: { message: e instanceof Error ? e.message : String(e) } }
  }
}

/** One page of an institution's students (/admin/students). */
export function listStudents(userId: string, tenantId: string, opts: ListOptions = {}) {
  return listByRole<StudentRow>(userId, tenantId, 'student', STUDENT_COLUMNS, opts)
}

/**
 * One page of an institution's students for the centre manager (/center/students),
 * with the four-part-name flag on the same rows and the active count for the summary.
 */
export function listCenterStudents(userId: string, tenantId: string, opts: ListOptions = {}) {
  return listByRole<CenterStudentRow>(userId, tenantId, 'student', CENTER_STUDENT_COLUMNS, { ...opts, countActive: true })
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

const CENTER_TEACHER_COLUMNS = ['id', 'full_name', 'email', 'is_active', 'created_at']

/**
 * One page of an institution's teachers for the centre manager (/center/teachers),
 * with the active count and each teacher's footprint — which decides whether the
 * centre may (de)activate them. The footprint reads only the groups and courses
 * of THIS page's teachers (P4: one statement per table, never one call per
 * row); a teacher's footprint depends on their own rows only, so the result is
 * the same as computing it from the whole institution
 * (supabase/tests/center_teachers_list_check.sql, L1).
 */
export async function listCenterTeachers(userId: string, tenantId: string, opts: ListOptions = {}) {
  const res = await listByRole<Omit<CenterTeacherRow, 'footprint'>>(
    userId, tenantId, 'teacher', CENTER_TEACHER_COLUMNS, { ...opts, countActive: true },
  )
  const ids = res.data.rows.map(r => r.id)
  // Restricted to this page's teachers (≤ pageSize = 50) and used only here to
  // decide the lock — never sent to the browser. Not hard-row-limited: it returns
  // every live group/course those teachers own (a .limit() could flip a lock).
  const [groups, courses] = ids.length
    ? await run({ as: 'user', userId }, sql => [
        sql`select teacher_id, course_id from public.groups
             where tenant_id = ${tenantId} and teacher_id in (select jsonb_array_elements_text(${sql.json(ids)})::uuid) and deleted_at is null`,
        sql`select teacher_id from public.courses
             where tenant_id = ${tenantId} and teacher_id in (select jsonb_array_elements_text(${sql.json(ids)})::uuid) and deleted_at is null`,
      ])
    : [[], []]
  const footprints = teacherFootprints(
    groups as unknown as { teacher_id: string; course_id: string | null }[],
    courses as unknown as { teacher_id: string }[],
  )
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

/**
 * The same search as a SQL fragment (step 9), for a route to send in the same
 * unit as its authorization reads: at most STUDENT_SEARCH_LIMIT active
 * students of the institution matching `search` (by name, or name/email),
 * minus the target's current members. The term is a bound parameter;
 * sanitizeSearch already removed the LIKE wildcards.
 */
export function studentSearchSql(
  sql: Sql,
  tenantId: string,
  search: string,
  target: { kind: 'group' | 'course'; id: string },
  opts: { nameOnly?: boolean } = {},
) {
  const pattern = `%${search}%`
  const notMember = target.kind === 'group'
    ? sql`not exists (select 1 from public.group_students m where m.group_id = ${target.id} and m.student_id = u.id)`
    : sql`not exists (select 1 from public.course_enrollments m where m.course_id = ${target.id} and m.student_id = u.id)`
  const matches = opts.nameOnly
    ? sql`u.full_name ilike ${pattern}`
    : sql`(u.full_name ilike ${pattern} or u.email ilike ${pattern})`
  return opts.nameOnly
    ? sql`select u.id, u.full_name from public.users u
           where u.tenant_id = ${tenantId} and u.role = 'student' and u.is_active and ${matches} and ${notMember}
           order by u.full_name, u.id limit ${STUDENT_SEARCH_LIMIT}`
    : sql`select u.id, u.full_name, u.email from public.users u
           where u.tenant_id = ${tenantId} and u.role = 'student' and u.is_active and ${matches} and ${notMember}
           order by u.full_name, u.id limit ${STUDENT_SEARCH_LIMIT}`
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

/** One page of an institution's teachers (/admin/teachers). */
export function listTeachers(userId: string, tenantId: string, opts: ListOptions = {}) {
  return listByRole<TeacherRow>(userId, tenantId, 'teacher', TEACHER_COLUMNS, opts)
}
