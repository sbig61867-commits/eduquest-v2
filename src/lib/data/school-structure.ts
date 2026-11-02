import { run, transaction, maybeOne, type Pending, type Row } from '@/lib/db/sql'
import type { ApiErrorCode } from '@/lib/api-error'
import type { SessionCtx } from '@/lib/auth/session'
import { parsePage, sanitizeSearch } from '@/lib/data/people'
import { mapTimetableError } from '@/lib/data/school-timetable'
import {
  SCHOOL_LIMITS, isUuid, sectionDisplayName,
  type GradeInput, type PlacementInput, type SchoolGrade, type SchoolSection, type SchoolStage,
  type SchoolTerm, type SchoolYear, type SectionInput, type StageInput, type StructureKind, type TermInput, type YearInput,
} from '@/lib/school-structure'

// ── School structure on the SQL layer (neon/migrations/0013_school_structure.sql) ──
//
// Reads that reach /admin/school run as the signed-in user (RLS: own tenant,
// live rows; the tenant filter stays as defence in depth), in one unit each,
// every list bounded. Writes run as app_service pinned to the caller's
// institution, AFTER the route checked the caller (loadSchoolCaller): the
// tables have a SELECT policy only for users. Each write is one unit; the
// database triggers refuse anything cross-tenant or non-school on their own.
// Design: docs/claude/tasks/school-structure-plan.md

export const PLACEMENT_PAGE_SIZE = 50

export type WriteResult<T> = { ok: true; value: T } | { ok: false; code: ApiErrorCode; status: number; params?: Record<string, string | number> }
const fail = (code: ApiErrorCode, status: number, params?: Record<string, string | number>) => ({ ok: false as const, code, status, params })

// ── caller ────────────────────────────────────────────────────────────────

export interface SchoolCaller {
  id: string
  role: string
  tenant_id: string
  permissions: Record<string, unknown> | null
  institution_type: string | null
}

/**
 * The caller from their LIVE row (role, capabilities, active) with their
 * institution's type, read as app_service pinned to the session's institution
 * (same rule as getCaller in src/lib/staff-auth.ts). null = no session; 'none' =
 * no live account in this institution.
 */
export async function loadSchoolCaller(ctx: SessionCtx | null): Promise<SchoolCaller | null | 'none'> {
  if (!ctx) return null
  if (!ctx.tenant_id) return 'none'
  const tenantId = ctx.tenant_id
  const [rows] = await run({ as: 'service', tenantId }, sql => [
    sql`select u.role, u.tenant_id, u.permissions, t.institution_type
          from public.users u join public.tenants t on t.id = u.tenant_id
         where u.id = ${ctx.sub} and u.tenant_id = ${tenantId} and u.is_active is not false`,
  ])
  const row = maybeOne<Omit<SchoolCaller, 'id'>>(rows)
  return row ? { id: ctx.sub, ...row } : 'none'
}

// ── page read ─────────────────────────────────────────────────────────────

export interface SchoolStructure {
  profile: { role: string | null; permissions: Record<string, unknown> | null } | null
  institutionType: string | null
  stages: SchoolStage[]
  grades: SchoolGrade[]
  years: SchoolYear[]
  terms: SchoolTerm[]
  /** The year whose sections are listed: the requested one, else the active one, else the latest. */
  yearId: string | null
  sections: SchoolSection[]
}

/** Is this the "table does not exist" error (migration 0013 not applied yet)? */
export function isSchemaMissing(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code
  return code === '42P01' || code === '42703'
}

/** Everything /admin/school shows, in ONE unit as the user. */
export async function loadSchoolStructure(userId: string, tenantId: string, rawYear?: unknown): Promise<SchoolStructure> {
  const wanted = isUuid(rawYear) ? rawYear : null
  const L = SCHOOL_LIMITS
  const [profiles, tenants, stages, grades, years, terms, sections] = await run({ as: 'user', userId }, sql => [
    sql`select role, permissions from public.users where id = ${userId}`,
    sql`select institution_type from public.tenants where id = ${tenantId}`,
    sql`select id, kind, name, code, sort_order from public.school_stages
         where tenant_id = ${tenantId} order by sort_order, name, id limit ${L.stages}`,
    sql`select id, stage_id, name, code, track, sort_order from public.school_grades
         where tenant_id = ${tenantId} order by sort_order, name, id limit ${L.grades}`,
    sql`select id, name, starts_on::text as starts_on, ends_on::text as ends_on, is_active from public.school_years
         where tenant_id = ${tenantId} order by starts_on desc, id limit ${L.years}`,
    sql`select id, year_id, term_no, name, starts_on::text as starts_on, ends_on::text as ends_on from public.school_terms
         where tenant_id = ${tenantId} order by year_id, term_no limit ${L.terms}`,
    sql`with y as (
          select coalesce(
            (select id from public.school_years where id = ${wanted}::uuid and tenant_id = ${tenantId}),
            (select id from public.school_years where tenant_id = ${tenantId} and is_active),
            (select id from public.school_years where tenant_id = ${tenantId} order by starts_on desc, id limit 1)) as id)
        select (select id from y) as year_id,
               coalesce((select json_agg(x order by x.section_order nulls last, x.label, x.id) from (
                 select g.id, g.school_grade_id as grade_id, g.section_label as label, g.name, g.shift,
                        g.max_students as capacity, g.is_active, g.section_order, g.teacher_id,
                        u.full_name as teacher_name,
                        (select count(*)::int from public.group_students s where s.group_id = g.id) as members
                   from public.groups g left join public.users u on u.id = g.teacher_id
                  where g.tenant_id = ${tenantId} and g.school_grade_id is not null and g.school_year_id = (select id from y)
                  order by g.section_order nulls last, g.section_label, g.id
                  limit ${L.sections}) x), '[]') as rows`,
  ])
  const s = sections[0] as { year_id: string | null; rows: SchoolSection[] } | undefined
  return {
    profile: (profiles[0] as SchoolStructure['profile']) ?? null,
    institutionType: ((tenants[0] as { institution_type?: string } | undefined)?.institution_type) ?? null,
    stages: stages as unknown as SchoolStage[],
    grades: grades as unknown as SchoolGrade[],
    years: years as unknown as SchoolYear[],
    terms: terms as unknown as SchoolTerm[],
    yearId: s?.year_id ?? null,
    sections: s?.rows ?? [],
  }
}

// ── placement list ────────────────────────────────────────────────────────

export interface PlacementStudent { id: string; full_name: string; section_id: string | null }
export interface PlacementPage { students: PlacementStudent[]; total: number; page: number; pageCount: number }

export interface PlacementQuery { yearId: string; q?: unknown; page?: unknown; unplaced?: boolean; sectionId?: string | null }

/**
 * One page of the institution's active students with each one's section in
 * `yearId` (at most one: unique per student and year), read as the user. One
 * statement: total, clamped page (past the end → last page) and the rows.
 */
/** null when `yearId` is not a live year of the institution (same statement, no extra round trip). */
export async function listPlacementStudents(userId: string, tenantId: string, opts: PlacementQuery): Promise<PlacementPage | null> {
  const size = PLACEMENT_PAGE_SIZE
  const q = sanitizeSearch(opts.q)
  const pattern = `%${q}%`
  const section = isUuid(opts.sectionId) ? opts.sectionId : null
  const [rows] = await run({ as: 'user', userId }, sql => [
    sql`with base as (
          select u.id, u.full_name, gs.group_id as section_id
            from public.users u
            left join public.group_students gs on gs.student_id = u.id and gs.school_year_id = ${opts.yearId}::uuid
           where u.tenant_id = ${tenantId} and u.role = 'student' and u.is_active is not false
             and (${q} = '' or u.full_name ilike ${pattern})
             and (not ${opts.unplaced === true} or gs.group_id is null)
             and (${section}::uuid is null or gs.group_id = ${section}::uuid)),
        t as (select count(*)::int as n from base),
        pg as (select least(${parsePage(opts.page)}, greatest(1, ceil((select n from t) / ${size}::numeric)::int)) as p)
        select exists (select 1 from public.school_years where id = ${opts.yearId}::uuid and tenant_id = ${tenantId}) as year_ok,
               (select n from t) as total, (select p from pg) as page,
               coalesce((select json_agg(x order by x.full_name, x.id) from (
                 select id, full_name, section_id from base order by full_name, id
                  limit ${size} offset ((select p from pg) - 1) * ${size}) x), '[]') as rows`,
  ])
  const r = rows[0] as { year_ok: boolean; total: number; page: number; rows: PlacementStudent[] }
  if (!r.year_ok) return null
  return { students: r.rows, total: r.total, page: r.page, pageCount: Math.max(1, Math.ceil(r.total / size)) }
}

// ── writes (app_service, pinned) ──────────────────────────────────────────

/** Postgres refusals the structure writes can meet, as the caller's error. */
export function mapWriteError(e: unknown, kind: StructureKind): WriteResult<never> | null {
  const err = e as { code?: string; constraint_name?: string; message?: string } | null
  const constraint = err?.constraint_name ?? err?.message ?? ''
  // a section's shift change or restore re-checks its timetable cells (0014 trigger on groups)
  if (constraint.startsWith('school_slot_')) return mapTimetableError(e)
  switch (err?.code) {
    case '23505':
      if (constraint.includes('code_uq')) return fail('codeTaken', 409)
      if (constraint.includes('section_label_uq')) return fail('sectionLabelTaken', 409)
      if (constraint.includes('school_years_name_uq')) return fail('yearNameTaken', 409)
      if (constraint.includes('school_terms_no_uq')) return fail('termNumberTaken', 409)
      if (constraint.includes('one_section_per_year')) return fail('placementConflict', 409)
      return fail('invalidData', 409)
    case '23514':
      if (kind === 'term' || kind === 'year') return fail('termOutsideYear', 400)
      return fail('invalidData', 400)
    case '55000':
      return fail('schoolOnly', 409)
    case '42501':
      return fail(kind === 'section' ? 'teacherNotInTenant' : 'notFound', 404)
    default:
      return null
  }
}

const svc = (tenantId: string) => ({ as: 'service', tenantId }) as const
type SqlTag = Parameters<Parameters<typeof run>[1]>[0]

// stage ----------------------------------------------------------------------

const STAGE_COLS = (sql: SqlTag) => sql`id, kind, name, code, sort_order`

export async function createStage(tenantId: string, v: Required<Pick<StageInput, 'kind' | 'name'>> & StageInput): Promise<WriteResult<SchoolStage>> {
  const [rows] = await run(svc(tenantId), sql => [
    sql`insert into public.school_stages (tenant_id, kind, name, code, sort_order)
        select ${tenantId}, ${v.kind}, ${v.name}, ${v.code ?? null},
               coalesce((select max(sort_order) + 1 from public.school_stages where tenant_id = ${tenantId} and deleted_at is null), 0)
         where (select count(*) from public.school_stages where tenant_id = ${tenantId} and deleted_at is null) < ${SCHOOL_LIMITS.stages}
        returning ${STAGE_COLS(sql)}`,
  ])
  const row = maybeOne<SchoolStage>(rows)
  return row ? { ok: true, value: row } : fail('schoolLimitReached', 409)
}

export async function updateStage(tenantId: string, id: string, v: StageInput): Promise<WriteResult<SchoolStage>> {
  const [rows] = await run(svc(tenantId), sql => [
    sql`update public.school_stages set
          kind = coalesce(${v.kind ?? null}::text, kind),
          name = coalesce(${v.name ?? null}::text, name),
          code = case when ${v.code !== undefined} then ${v.code ?? null}::text else code end
        where id = ${id} and tenant_id = ${tenantId} and deleted_at is null
        returning ${STAGE_COLS(sql)}`,
  ])
  const row = maybeOne<SchoolStage>(rows)
  return row ? { ok: true, value: row } : fail('stageNotFound', 404)
}

// grade ----------------------------------------------------------------------

const GRADE_COLS = (sql: SqlTag) => sql`id, stage_id, name, code, track, sort_order`

export async function createGrade(tenantId: string, v: Required<Pick<GradeInput, 'stage_id' | 'name'>> & GradeInput): Promise<WriteResult<SchoolGrade>> {
  const [rows] = await run(svc(tenantId), sql => [
    sql`insert into public.school_grades (tenant_id, stage_id, name, code, track, sort_order)
        select ${tenantId}, s.id, ${v.name}, ${v.code ?? null}, ${v.track ?? null},
               coalesce((select max(sort_order) + 1 from public.school_grades where stage_id = s.id and deleted_at is null), 0)
          from public.school_stages s
         where s.id = ${v.stage_id} and s.tenant_id = ${tenantId} and s.deleted_at is null
           and (select count(*) from public.school_grades where tenant_id = ${tenantId} and deleted_at is null) < ${SCHOOL_LIMITS.grades}
        returning ${GRADE_COLS(sql)}`,
  ])
  const row = maybeOne<SchoolGrade>(rows)
  if (row) return { ok: true, value: row }
  const [stage] = await run(svc(tenantId), sql => [
    sql`select 1 from public.school_stages where id = ${v.stage_id} and tenant_id = ${tenantId} and deleted_at is null`,
  ])
  return stage.length ? fail('schoolLimitReached', 409) : fail('stageNotFound', 404)
}

/** A rename re-composes the names of the grade's sections, in the same unit. */
export async function updateGrade(tenantId: string, id: string, v: GradeInput): Promise<WriteResult<SchoolGrade>> {
  const [rows] = await run(svc(tenantId), sql => [
    sql`with g as (
          update public.school_grades set
            name = coalesce(${v.name ?? null}::text, name),
            code = case when ${v.code !== undefined} then ${v.code ?? null}::text else code end,
            track = case when ${v.track !== undefined} then ${v.track ?? null}::text else track end
          where id = ${id} and tenant_id = ${tenantId} and deleted_at is null
          returning ${GRADE_COLS(sql)}),
        r as (
          update public.groups gr set name = left(btrim(g.name) || ' ' || btrim(gr.section_label), 200)
            from g where ${v.name !== undefined} and gr.school_grade_id = g.id and gr.tenant_id = ${tenantId}
          returning gr.id)
        select g.id, g.stage_id, g.name, g.code, g.track, g.sort_order, (select count(*) from r)::int as renamed from g`,
  ])
  const row = maybeOne<SchoolGrade & { renamed: number }>(rows)
  if (!row) return fail('gradeNotFound', 404)
  const { renamed: _r, ...grade } = row
  return (void _r, { ok: true, value: grade })
}

// section ----------------------------------------------------------------------

const SECTION_SELECT = (sql: SqlTag, where: Pending) =>
  sql`select g.id, g.school_grade_id as grade_id, g.section_label as label, g.name, g.shift, g.max_students as capacity,
             g.is_active, g.section_order, g.teacher_id, u.full_name as teacher_name,
             (select count(*)::int from public.group_students s where s.group_id = g.id) as members
        from public.groups g left join public.users u on u.id = g.teacher_id
       where ${where}`

/**
 * A section is a group of the grade and year: name «<grade> <label>», capacity
 * in max_students, homeroom teacher in teacher_id (optional). One unit: the
 * checks the refusal needs, then the insert that only happens when they hold.
 */
export async function createSection(tenantId: string, v: Required<Pick<SectionInput, 'grade_id' | 'year_id' | 'label'>> & SectionInput): Promise<WriteResult<SchoolSection>> {
  const teacher = v.teacher_id ?? null
  try {
    const [checks, inserted] = await run(svc(tenantId), sql => [
      sql`select exists (select 1 from public.school_grades where id = ${v.grade_id} and tenant_id = ${tenantId} and deleted_at is null) as grade,
                 exists (select 1 from public.school_years where id = ${v.year_id} and tenant_id = ${tenantId} and deleted_at is null) as year,
                 (${teacher}::uuid is null or exists (select 1 from public.users where id = ${teacher}::uuid and tenant_id = ${tenantId}
                                                       and role = 'teacher' and is_active is not false)) as teacher,
                 (select count(*) from public.groups where tenant_id = ${tenantId} and school_year_id = ${v.year_id}
                     and school_grade_id is not null and deleted_at is null)::int as sections`,
      sql`insert into public.groups (tenant_id, teacher_id, name, school_grade_id, school_year_id, section_label, shift, max_students, section_order)
          select ${tenantId}, ${teacher}::uuid, left(btrim(gr.name) || ' ' || ${v.label}, 200), gr.id, y.id, ${v.label}, ${v.shift ?? null},
                 ${v.capacity ?? null}::int,
                 coalesce((select max(section_order) + 1 from public.groups where school_grade_id = gr.id and school_year_id = y.id), 0)
            from public.school_grades gr, public.school_years y
           where gr.id = ${v.grade_id} and gr.tenant_id = ${tenantId} and gr.deleted_at is null
             and y.id = ${v.year_id} and y.tenant_id = ${tenantId} and y.deleted_at is null
             and (${teacher}::uuid is null or exists (select 1 from public.users where id = ${teacher}::uuid and tenant_id = ${tenantId}
                                                       and role = 'teacher' and is_active is not false))
             and (select count(*) from public.groups where tenant_id = ${tenantId} and school_year_id = y.id
                     and school_grade_id is not null and deleted_at is null) < ${SCHOOL_LIMITS.sections}
          returning id`,
    ])
    const id = (inserted[0] as { id: string } | undefined)?.id
    if (!id) {
      const c = checks[0] as { grade: boolean; year: boolean; teacher: boolean; sections: number }
      if (!c.grade) return fail('gradeNotFound', 404)
      if (!c.year) return fail('yearNotFound', 404)
      if (!c.teacher) return fail('teacherNotInTenant', 400)
      return fail('schoolLimitReached', 409)
    }
    return await readSection(tenantId, id)
  } catch (e) {
    const mapped = mapWriteError(e, 'section')
    if (mapped) return mapped
    throw e
  }
}

async function readSection(tenantId: string, id: string): Promise<WriteResult<SchoolSection>> {
  const [rows] = await run(svc(tenantId), sql => [
    SECTION_SELECT(sql, sql`g.id = ${id} and g.tenant_id = ${tenantId} and g.school_grade_id is not null and g.deleted_at is null`),
  ])
  const row = maybeOne<SchoolSection>(rows)
  return row ? { ok: true, value: row } : fail('sectionNotFound', 404)
}

export async function updateSection(tenantId: string, id: string, v: SectionInput): Promise<WriteResult<SchoolSection>> {
  const teacherSet = v.teacher_id !== undefined
  const teacher = v.teacher_id ?? null
  try {
    const [checks, updated] = await run(svc(tenantId), sql => [
      sql`select (${teacher}::uuid is null or exists (select 1 from public.users where id = ${teacher}::uuid and tenant_id = ${tenantId}
                                                         and role = 'teacher' and is_active is not false)) as teacher`,
      sql`update public.groups g set
            section_label = coalesce(${v.label ?? null}::text, g.section_label),
            name = case when ${v.label !== undefined}
                        then left(btrim((select gr.name from public.school_grades gr where gr.id = g.school_grade_id)) || ' ' || ${v.label ?? ''}, 200)
                        else g.name end,
            shift = case when ${v.shift !== undefined} then ${v.shift ?? null}::text else g.shift end,
            max_students = case when ${v.capacity !== undefined} then ${v.capacity ?? null}::int else g.max_students end,
            teacher_id = case when ${teacherSet} then ${teacher}::uuid else g.teacher_id end,
            is_active = coalesce(${v.is_active ?? null}::boolean, g.is_active)
          where g.id = ${id} and g.tenant_id = ${tenantId} and g.school_grade_id is not null and g.deleted_at is null
            and (not ${teacherSet} or ${teacher}::uuid is null
                 or exists (select 1 from public.users where id = ${teacher}::uuid and tenant_id = ${tenantId}
                              and role = 'teacher' and is_active is not false))
          returning g.id`,
    ])
    if (!updated.length) {
      return (checks[0] as { teacher: boolean }).teacher ? fail('sectionNotFound', 404) : fail('teacherNotInTenant', 400)
    }
    return await readSection(tenantId, id)
  } catch (e) {
    const mapped = mapWriteError(e, 'section')
    if (mapped) return mapped
    throw e
  }
}

// year / term --------------------------------------------------------------------

const YEAR_COLS = (sql: SqlTag) => sql`id, name, starts_on::text as starts_on, ends_on::text as ends_on, is_active`

/** One active year per tenant: activating one clears the others in the same unit. */
export async function createYear(tenantId: string, v: Required<Pick<YearInput, 'name' | 'starts_on' | 'ends_on'>> & YearInput): Promise<WriteResult<SchoolYear>> {
  const active = v.is_active === true
  try {
    const rows = await run(svc(tenantId), sql => [
      ...(active ? [sql`update public.school_years set is_active = false where tenant_id = ${tenantId} and is_active`] : []),
      sql`insert into public.school_years (tenant_id, name, starts_on, ends_on, is_active)
          select ${tenantId}, ${v.name}, ${v.starts_on}::date, ${v.ends_on}::date, ${active}
           where (select count(*) from public.school_years where tenant_id = ${tenantId} and deleted_at is null) < ${SCHOOL_LIMITS.years}
          returning ${YEAR_COLS(sql)}`,
    ])
    const row = maybeOne<SchoolYear>(rows[rows.length - 1])
    return row ? { ok: true, value: row } : fail('schoolLimitReached', 409)
  } catch (e) {
    const mapped = mapWriteError(e, 'year')
    if (mapped) return mapped
    throw e
  }
}

export async function updateYear(tenantId: string, id: string, v: YearInput): Promise<WriteResult<SchoolYear>> {
  try {
    const rows = await run(svc(tenantId), sql => [
      sql`select starts_on::text as starts_on, ends_on::text as ends_on from public.school_years
           where id = ${id} and tenant_id = ${tenantId} and deleted_at is null`,
      ...(v.is_active === true ? [sql`update public.school_years set is_active = false
                                       where tenant_id = ${tenantId} and is_active and id <> ${id}`] : []),
      sql`update public.school_years set
            name = coalesce(${v.name ?? null}::text, name),
            starts_on = coalesce(${v.starts_on ?? null}::date, starts_on),
            ends_on = coalesce(${v.ends_on ?? null}::date, ends_on),
            is_active = coalesce(${v.is_active ?? null}::boolean, is_active)
          where id = ${id} and tenant_id = ${tenantId} and deleted_at is null
            and coalesce(${v.ends_on ?? null}::date, ends_on) > coalesce(${v.starts_on ?? null}::date, starts_on)
          returning ${YEAR_COLS(sql)}`,
    ])
    const row = maybeOne<SchoolYear>(rows[rows.length - 1])
    if (row) return { ok: true, value: row }
    return rows[0].length ? fail('endBeforeStart', 400) : fail('yearNotFound', 404)
  } catch (e) {
    const mapped = mapWriteError(e, 'year')
    if (mapped) return mapped
    throw e
  }
}

const TERM_COLS = (sql: SqlTag) => sql`id, year_id, term_no, name, starts_on::text as starts_on, ends_on::text as ends_on`

export async function createTerm(tenantId: string, v: Required<Pick<TermInput, 'year_id' | 'term_no' | 'name' | 'starts_on' | 'ends_on'>>): Promise<WriteResult<SchoolTerm>> {
  try {
    const [rows] = await run(svc(tenantId), sql => [
      sql`insert into public.school_terms (tenant_id, year_id, term_no, name, starts_on, ends_on)
          select ${tenantId}, y.id, ${v.term_no}, ${v.name}, ${v.starts_on}::date, ${v.ends_on}::date
            from public.school_years y where y.id = ${v.year_id} and y.tenant_id = ${tenantId} and y.deleted_at is null
          returning ${TERM_COLS(sql)}`,
    ])
    const row = maybeOne<SchoolTerm>(rows)
    return row ? { ok: true, value: row } : fail('yearNotFound', 404)
  } catch (e) {
    const mapped = mapWriteError(e, 'term')
    if (mapped) return mapped
    throw e
  }
}

export async function updateTerm(tenantId: string, id: string, v: TermInput): Promise<WriteResult<SchoolTerm>> {
  try {
    const [rows] = await run(svc(tenantId), sql => [
      sql`update public.school_terms set
            term_no = coalesce(${v.term_no ?? null}::smallint, term_no),
            name = coalesce(${v.name ?? null}::text, name),
            starts_on = coalesce(${v.starts_on ?? null}::date, starts_on),
            ends_on = coalesce(${v.ends_on ?? null}::date, ends_on)
          where id = ${id} and tenant_id = ${tenantId} and deleted_at is null
            and coalesce(${v.ends_on ?? null}::date, ends_on) > coalesce(${v.starts_on ?? null}::date, starts_on)
          returning ${TERM_COLS(sql)}`,
    ])
    const row = maybeOne<SchoolTerm>(rows)
    return row ? { ok: true, value: row } : fail('termNotFound', 404)
  } catch (e) {
    const mapped = mapWriteError(e, 'term')
    if (mapped) return mapped
    throw e
  }
}

// archive ----------------------------------------------------------------------

/**
 * Soft delete (deleted_at; a section uses the group archive flag is_active =
 * false). A stage or grade with active sections, or the active year, is
 * refused: the diagnostic read and the guarded update run in the same unit.
 */
export async function archiveItem(tenantId: string, kind: StructureKind, id: string): Promise<WriteResult<{ id: string }>> {
  const activeUnder = (sql: SqlTag, gradeFilter: Pending) =>
    sql`exists (select 1 from public.groups g join public.school_grades gr on gr.id = g.school_grade_id
                 where ${gradeFilter} and g.tenant_id = ${tenantId} and g.deleted_at is null and g.is_active)`
  const statements = (sql: SqlTag): [Pending, Pending] => {
    switch (kind) {
      case 'stage':
        return [
          sql`select ${activeUnder(sql, sql`gr.stage_id = ${id}`)} as blocked
                from public.school_stages where id = ${id} and tenant_id = ${tenantId} and deleted_at is null`,
          sql`with s as (
                update public.school_stages set deleted_at = now()
                 where id = ${id} and tenant_id = ${tenantId} and deleted_at is null
                   and not ${activeUnder(sql, sql`gr.stage_id = ${id}`)}
                returning id),
              g as (update public.school_grades set deleted_at = now()
                     where stage_id in (select id from s) and deleted_at is null returning id)
              select id, (select count(*) from g)::int as grades from s`,
        ]
      case 'grade':
        return [
          sql`select ${activeUnder(sql, sql`gr.id = ${id}`)} as blocked
                from public.school_grades where id = ${id} and tenant_id = ${tenantId} and deleted_at is null`,
          sql`update public.school_grades set deleted_at = now()
               where id = ${id} and tenant_id = ${tenantId} and deleted_at is null
                 and not ${activeUnder(sql, sql`gr.id = ${id}`)}
              returning id`,
        ]
      case 'year':
        return [
          sql`select is_active as blocked from public.school_years where id = ${id} and tenant_id = ${tenantId} and deleted_at is null`,
          sql`with y as (update public.school_years set deleted_at = now()
                          where id = ${id} and tenant_id = ${tenantId} and deleted_at is null and not is_active returning id),
              t as (update public.school_terms set deleted_at = now()
                     where year_id in (select id from y) and deleted_at is null returning id)
              select id, (select count(*) from t)::int as terms from y`,
        ]
      case 'term':
        return [
          sql`select false as blocked from public.school_terms where id = ${id} and tenant_id = ${tenantId} and deleted_at is null`,
          sql`update public.school_terms set deleted_at = now()
               where id = ${id} and tenant_id = ${tenantId} and deleted_at is null returning id`,
        ]
      case 'section':
        return [
          sql`select false as blocked from public.groups
               where id = ${id} and tenant_id = ${tenantId} and school_grade_id is not null and deleted_at is null`,
          sql`update public.groups set is_active = false
               where id = ${id} and tenant_id = ${tenantId} and school_grade_id is not null and deleted_at is null
              returning id`,
        ]
    }
  }
  const [check, done] = await run(svc(tenantId), sql => statements(sql))
  if (done.length) return { ok: true, value: { id } }
  const found = check[0] as { blocked: boolean } | undefined
  if (!found) return fail(NOT_FOUND[kind], 404)
  return fail(kind === 'year' ? 'yearIsActive' : 'hasActiveSections', 409)
}

const NOT_FOUND: Record<StructureKind, ApiErrorCode> = {
  stage: 'stageNotFound', grade: 'gradeNotFound', section: 'sectionNotFound', year: 'yearNotFound', term: 'termNotFound',
}

// reorder ----------------------------------------------------------------------

/**
 * New order of stages (all of the school's), the grades of one stage, or the
 * sections of one grade in one year: position = index in `ids`. Ids outside
 * that scope are simply not touched; the count tells the caller.
 */
export async function reorder(tenantId: string, kind: 'stage' | 'grade' | 'section', ids: string[]): Promise<WriteResult<{ updated: number }>> {
  const csv = ids.join(',')
  const [rows] = await run(svc(tenantId), sql => {
    const order = sql`(select o.id, o.ord::int - 1 as ord from unnest(string_to_array(${csv}, ',')::uuid[]) with ordinality as o(id, ord))`
    if (kind === 'stage') {
      return [sql`update public.school_stages s set sort_order = o.ord from ${order} o
                   where s.id = o.id and s.tenant_id = ${tenantId} and s.deleted_at is null returning s.id`]
    }
    if (kind === 'grade') {
      return [sql`update public.school_grades g set sort_order = o.ord from ${order} o
                   where g.id = o.id and g.tenant_id = ${tenantId} and g.deleted_at is null
                     and g.stage_id = (select stage_id from public.school_grades where id = ${ids[0]} and tenant_id = ${tenantId})
                  returning g.id`]
    }
    return [sql`update public.groups g set section_order = o.ord from ${order} o
                 where g.id = o.id and g.tenant_id = ${tenantId} and g.school_grade_id is not null and g.deleted_at is null
                   and (g.school_grade_id, g.school_year_id) = (select school_grade_id, school_year_id from public.groups
                                                                 where id = ${ids[0]} and tenant_id = ${tenantId})
                returning g.id`]
  })
  return rows.length ? { ok: true, value: { updated: rows.length } } : fail('invalidOrder', 400)
}

// placement ----------------------------------------------------------------------

/**
 * Places students in a section (التسكين), in one transaction:
 *  1. the section, locked (FOR UPDATE) so two placements cannot both pass the
 *     capacity check; it must be a live, active section of a live year;
 *  2. every id must be an active student of the institution;
 *  3. capacity: members not in this batch + the batch ≤ max_students;
 *  4. a student already in another section of the same year is moved: that
 *     placement is removed first (one section per student per year — the
 *     database refuses a second one anyway);
 *  5. the memberships (already in this section = unchanged).
 */
export async function placeStudents(tenantId: string, v: PlacementInput): Promise<WriteResult<{ placed: number; moved: number }>> {
  const csv = v.student_ids.join(',')
  try {
    return await transaction(svc(tenantId), async tx => {
      const [sec] = (await tx`select g.id, g.max_students, g.school_year_id from public.groups g
            where g.id = ${v.section_id} and g.tenant_id = ${tenantId} and g.school_grade_id is not null
              and g.deleted_at is null and g.is_active
              and exists (select 1 from public.school_years y where y.id = g.school_year_id and y.deleted_at is null)
            for update`) as unknown as { id: string; max_students: number | null; school_year_id: string }[]
      if (!sec) return fail('sectionNotFound', 404)
      const [students] = (await tx`select count(*)::int as n from public.users u
            where u.tenant_id = ${tenantId} and u.role = 'student' and u.is_active is not false
              and u.id = any(string_to_array(${csv}, ',')::uuid[])`) as unknown as { n: number }[]
      if (students.n !== v.student_ids.length) return fail('studentNotInTenant', 404)
      if (sec.max_students !== null) {
        const [others] = (await tx`select count(*)::int as n from public.group_students
              where group_id = ${sec.id} and not (student_id = any(string_to_array(${csv}, ',')::uuid[]))`) as unknown as { n: number }[]
        if (others.n + v.student_ids.length > sec.max_students) return fail('sectionFull', 409, { max: sec.max_students })
      }
      const moved = (await tx`delete from public.group_students
            where school_year_id = ${sec.school_year_id} and group_id <> ${sec.id}
              and student_id = any(string_to_array(${csv}, ',')::uuid[])
            returning student_id`) as unknown as Row[]
      await tx`insert into public.group_students (group_id, student_id)
               select ${sec.id}, x from unnest(string_to_array(${csv}, ',')::uuid[]) as x
               on conflict (group_id, student_id) do nothing`
      return { ok: true as const, value: { placed: v.student_ids.length, moved: moved.length } }
    })
  } catch (e) {
    // a concurrent placement of the same student won the unique index
    const mapped = mapWriteError(e, 'section')
    if (mapped) return mapped
    throw e
  }
}

/** Removes students from a section (not from the school): one statement. */
export async function unplaceStudents(tenantId: string, v: PlacementInput): Promise<WriteResult<{ removed: number }>> {
  const csv = v.student_ids.join(',')
  const [check, rows] = await run(svc(tenantId), sql => [
    sql`select 1 from public.groups where id = ${v.section_id} and tenant_id = ${tenantId}
           and school_grade_id is not null and deleted_at is null`,
    sql`delete from public.group_students gs
         where gs.group_id = ${v.section_id}
           and gs.student_id = any(string_to_array(${csv}, ',')::uuid[])
           and exists (select 1 from public.groups g where g.id = gs.group_id and g.tenant_id = ${tenantId}
                         and g.school_grade_id is not null and g.deleted_at is null)
        returning gs.student_id`,
  ])
  if (!check.length) return fail('sectionNotFound', 404)
  return { ok: true, value: { removed: rows.length } }
}

/** Section name for a grade and label, the same rule as the SQL above (exported for tests). */
export const composeSectionName = sectionDisplayName
