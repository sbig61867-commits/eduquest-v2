import { run, maybeOne } from '@/lib/db/sql'
import type { ApiErrorCode } from '@/lib/api-error'
import type { ScheduleSlot } from '@/components/schedules/types'
import {
  TIMETABLE_LIMITS,
  type BusyPeriod, type CellInput, type SchoolCurriculum, type GradeSubject, type GradeSubjectInput, type PeriodInput, type SchoolPeriod,
  type SchoolSubject, type SectionTimetable, type SubjectInput, type SubjectTeacher, type SubjectTeacherInput, type TimetableCell,
} from '@/lib/school-timetable'

// ── School subjects, subject teachers, bell schedule, section timetables ──
// on the SQL layer (neon/migrations/0014_school_subjects_timetable.sql).
//
// Same rules as src/lib/data/school-structure.ts: reads that reach a screen run
// as the signed-in user (RLS; the tenant filter stays as defence in depth), one
// unit each, every list bounded; writes run as app_service pinned to the
// caller's institution AFTER the route checked the caller, one unit each. The
// section timetable REUSES public.schedules / public.schedule_slots (one group
// timetable per section, one slot per day × period), so the existing student
// and teacher schedule screens show it. The database triggers copy a cell's
// times, title and teacher, and refuse a subject outside the grade, a break,
// another shift and a teacher clash on their own; here they become precise errors.
// Design: docs/claude/tasks/school-structure-plan.md (part 2)

export type WriteResult<T> = { ok: true; value: T } | { ok: false; code: ApiErrorCode; status: number; params?: Record<string, string | number> }
const fail = (code: ApiErrorCode, status: number, params?: Record<string, string | number>) => ({ ok: false as const, code, status, params })
const svc = (tenantId: string) => ({ as: 'service', tenantId }) as const
type SqlTag = Parameters<Parameters<typeof run>[1]>[0]

/** Postgres refusals of the 0014 writes (and their triggers), as the caller's error. */
export function mapTimetableError(e: unknown): WriteResult<never> | null {
  const err = e as { code?: string; constraint_name?: string; message?: string; detail?: string } | null
  const constraint = err?.constraint_name ?? err?.message ?? ''
  switch (err?.code) {
    case '23505':
      if (constraint.includes('school_subjects_code_uq')) return fail('codeTaken', 409)
      if (constraint.includes('schedule_slots_school_cell_uq')) return fail('timetableCellTaken', 409)
      return fail('invalidData', 409)
    case '23P01':
      if (constraint.includes('school_periods_overlap')) return fail('periodsOverlap', 409)
      if (constraint.includes('school_slot_teacher_busy')) return fail('teacherBusy', 409, { section: err?.detail ?? '' })
      return fail('invalidData', 409)
    case '23514':
      if (constraint.includes('school_slot_subject_grade')) return fail('subjectNotInGrade', 400)
      if (constraint.includes('school_slot_period_break')) return fail('periodIsBreak', 400)
      if (constraint.includes('school_slot_period_shift')) return fail('periodShiftMismatch', 409)
      return fail('invalidData', 400)
    case '55000':
      if (constraint.includes('school_period_in_use')) return fail('periodInUse', 409)
      if (constraint.includes('school_subject_in_use')) return fail('subjectInUse', 409)
      return fail('schoolOnly', 409)
    case '42501':
      if (constraint.includes('school_slot_period')) return fail('periodNotFound', 404)
      if (constraint.includes('teacher')) return fail('teacherNotInTenant', 400)
      if (constraint.includes('section')) return fail('sectionNotFound', 404)
      return fail('notFound', 404)
    default:
      return null
  }
}

async function guarded<T>(work: () => Promise<WriteResult<T>>): Promise<WriteResult<T>> {
  try {
    return await work()
  } catch (e) {
    const mapped = mapTimetableError(e)
    if (mapped) return mapped
    throw e
  }
}

// ── reads (as the user) ───────────────────────────────────────────────────

export type { SchoolCurriculum }

/** The catalogue /admin/school shows (subjects, grade links, bell schedule), in ONE unit as the user. */
export async function loadSchoolCurriculum(userId: string, tenantId: string): Promise<SchoolCurriculum> {
  const L = TIMETABLE_LIMITS
  const [subjects, links, periods] = await run({ as: 'user', userId }, sql => [
    sql`select id, name, code, colour, sort_order from public.school_subjects
         where tenant_id = ${tenantId} order by sort_order, name, id limit ${L.subjects}`,
    sql`select grade_id, subject_id, weekly_sessions from public.school_grade_subjects
         where tenant_id = ${tenantId} order by grade_id, subject_id limit ${L.gradeSubjects}`,
    sql`select id, shift, kind, name, starts_at::text as starts_at, ends_at::text as ends_at from public.school_periods
         where tenant_id = ${tenantId} order by shift nulls first, starts_at, id limit ${L.periods}`,
  ])
  return {
    subjects: subjects as unknown as SchoolSubject[],
    gradeSubjects: links as unknown as GradeSubject[],
    periods: periods as unknown as SchoolPeriod[],
  }
}

/**
 * One section's timetable for the editor, in ONE unit as the user: the
 * section and its group timetable, its cells, its subject teachers, and the
 * other periods those teachers already have in other active sections of the
 * same year (for the inline clash hints). null when the section is not a
 * section of the institution.
 */
export async function loadSectionTimetable(userId: string, tenantId: string, sectionId: string): Promise<SectionTimetable | null> {
  const L = TIMETABLE_LIMITS
  const [sections, cells, teachers, busy] = await run({ as: 'user', userId }, sql => [
    sql`select g.id, g.name, g.school_grade_id as grade_id, g.school_year_id as year_id, g.shift, g.is_active,
               s.id as schedule_id, s.is_published
          from public.groups g left join public.schedules s on s.group_id = g.id
         where g.id = ${sectionId} and g.tenant_id = ${tenantId} and g.school_grade_id is not null`,
    sql`select sl.id, sl.day_of_week as day, sl.school_period_id as period_id, sl.school_subject_id as subject_id, sl.teacher_id
          from public.schedule_slots sl join public.schedules s on s.id = sl.schedule_id
         where s.group_id = ${sectionId} and s.tenant_id = ${tenantId} and sl.school_period_id is not null
         order by sl.day_of_week, sl.start_time, sl.id limit ${L.cells}`,
    sql`select st.subject_id, st.teacher_id, u.full_name as teacher_name
          from public.school_subject_teachers st left join public.users u on u.id = st.teacher_id
         where st.group_id = ${sectionId} and st.tenant_id = ${tenantId}
         order by st.subject_id limit ${L.subjects}`,
    sql`select sl.teacher_id, sl.day_of_week as day, sl.start_time::text as starts_at, sl.end_time::text as ends_at,
               g2.id as section_id, g2.name as section_name
          from public.schedule_slots sl
          join public.schedules s2 on s2.id = sl.schedule_id
          join public.groups g2 on g2.id = s2.group_id
         where sl.school_period_id is not null and g2.id <> ${sectionId} and g2.tenant_id = ${tenantId}
           and g2.is_active and g2.school_year_id = (select school_year_id from public.groups where id = ${sectionId} and tenant_id = ${tenantId})
           and sl.teacher_id in (select teacher_id from public.school_subject_teachers where group_id = ${sectionId} and tenant_id = ${tenantId})
         order by sl.teacher_id, sl.day_of_week, sl.start_time limit ${L.busy}`,
  ])
  const s = maybeOne<{
    id: string; name: string; grade_id: string; year_id: string; shift: SectionTimetable['section']['shift']; is_active: boolean
    schedule_id: string | null; is_published: boolean | null
  }>(sections)
  if (!s) return null
  return {
    section: { id: s.id, name: s.name, grade_id: s.grade_id, year_id: s.year_id, shift: s.shift, is_active: s.is_active },
    schedule: s.schedule_id ? { id: s.schedule_id, is_published: s.is_published === true } : null,
    cells: cells as unknown as TimetableCell[],
    teachers: teachers as unknown as SubjectTeacher[],
    busy: busy as unknown as BusyPeriod[],
  }
}

/** Is this the "column / table does not exist" error (migration 0014 not applied yet)? */
export function isTimetableSchemaMissing(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code
  return code === '42P01' || code === '42703' || code === '42883'
}

/**
 * «جدولي»: a teacher's own periods across the sections they teach, in the
 * active academic year (RLS: the slots of sections they teach). One unit as
 * the teacher, bounded. Empty for every non-school institution, and before
 * 0014 is applied.
 */
export async function loadTeacherSchoolPeriods(userId: string, tenantId: string): Promise<ScheduleSlot[]> {
  try {
    const [rows] = await run({ as: 'user', userId }, sql => [
      sql`select sl.id, sl.day_of_week, sl.start_time::text as start_time, sl.end_time::text as end_time, sl.title,
                 sl.location, sl.note, g.name as group_name
            from public.schedule_slots sl
            join public.schedules s on s.id = sl.schedule_id
            join public.groups g on g.id = s.group_id
            join public.school_years y on y.id = g.school_year_id
           where sl.teacher_id = ${userId} and sl.school_period_id is not null and s.tenant_id = ${tenantId}
             and g.is_active and y.is_active and y.deleted_at is null
           order by sl.day_of_week, sl.start_time, sl.id limit ${TIMETABLE_LIMITS.teacherPeriods}`,
    ])
    return (rows as unknown as (Omit<ScheduleSlot, 'teacher_id' | 'teacher_name'>)[]).map(r => ({ ...r, teacher_id: userId, teacher_name: null }))
  } catch (e) {
    if (isTimetableSchemaMissing(e)) return []
    throw e
  }
}

// ── writes (app_service, pinned) ──────────────────────────────────────────

const SUBJECT_COLS = (sql: SqlTag) => sql`id, name, code, colour, sort_order`

export async function createSubject(tenantId: string, v: Required<Pick<SubjectInput, 'name' | 'code'>> & SubjectInput): Promise<WriteResult<SchoolSubject>> {
  return guarded(async () => {
    const [rows] = await run(svc(tenantId), sql => [
      sql`insert into public.school_subjects (tenant_id, name, code, colour, sort_order)
          select ${tenantId}, ${v.name}, ${v.code}, ${v.colour ?? null},
                 coalesce((select max(sort_order) + 1 from public.school_subjects where tenant_id = ${tenantId} and deleted_at is null), 0)
           where (select count(*) from public.school_subjects where tenant_id = ${tenantId} and deleted_at is null) < ${TIMETABLE_LIMITS.subjects}
          returning ${SUBJECT_COLS(sql)}`,
    ])
    const row = maybeOne<SchoolSubject>(rows)
    return row ? { ok: true, value: row } : fail('schoolLimitReached', 409)
  })
}

/** A rename is copied into the current timetable cells by the database (trigger). */
export async function updateSubject(tenantId: string, id: string, v: SubjectInput): Promise<WriteResult<SchoolSubject>> {
  return guarded(async () => {
    const [rows] = await run(svc(tenantId), sql => [
      sql`update public.school_subjects set
            name = coalesce(${v.name ?? null}::text, name),
            code = coalesce(${v.code ?? null}::text, code),
            colour = case when ${v.colour !== undefined} then ${v.colour ?? null}::text else colour end
          where id = ${id} and tenant_id = ${tenantId} and deleted_at is null
          returning ${SUBJECT_COLS(sql)}`,
    ])
    const row = maybeOne<SchoolSubject>(rows)
    return row ? { ok: true, value: row } : fail('subjectNotFound', 404)
  })
}

/** Is the subject / period used by a cell of a current timetable (a live section in a live year)? */
const usedByCurrentCell = (sql: SqlTag, by: 'subject' | 'period', id: string) =>
  sql`exists (select 1 from public.schedule_slots sl
                join public.schedules s on s.id = sl.schedule_id
                join public.groups g on g.id = s.group_id and g.deleted_at is null
                join public.school_years y on y.id = g.school_year_id and y.deleted_at is null
               where ${by === 'subject' ? sql`sl.school_subject_id` : sql`sl.school_period_id`} = ${id})`

/**
 * Archive a subject (soft): refused while a current timetable uses it; its
 * grade links and subject-teacher assignments are archived with it, in the
 * same statement.
 */
export async function archiveSubject(tenantId: string, id: string): Promise<WriteResult<{ id: string }>> {
  return guarded(async () => {
    const [check, done] = await run(svc(tenantId), sql => [
      sql`select ${usedByCurrentCell(sql, 'subject', id)} as in_use
            from public.school_subjects where id = ${id} and tenant_id = ${tenantId} and deleted_at is null`,
      sql`with s as (
            update public.school_subjects set deleted_at = now()
             where id = ${id} and tenant_id = ${tenantId} and deleted_at is null
               and not ${usedByCurrentCell(sql, 'subject', id)}
            returning id),
          l as (update public.school_grade_subjects set deleted_at = now(), updated_at = now()
                 where subject_id in (select id from s) and deleted_at is null returning id),
          t as (update public.school_subject_teachers set deleted_at = now(), updated_at = now()
                 where subject_id in (select id from s) and deleted_at is null returning id)
          select id, (select count(*) from l)::int as links, (select count(*) from t)::int as teachers from s`,
    ])
    if (done.length) return { ok: true, value: { id } }
    return check.length ? fail('subjectInUse', 409) : fail('subjectNotFound', 404)
  })
}

/**
 * Teach a subject in a grade with a weekly sessions target (upsert), or stop
 * teaching it there (weekly_sessions 0: soft unlink, refused while a current
 * timetable of that grade uses it; the subject's teachers in that grade's
 * sections are archived with it).
 */
export async function setGradeSubject(tenantId: string, v: GradeSubjectInput): Promise<WriteResult<GradeSubject | { removed: number }>> {
  return guarded<GradeSubject | { removed: number }>(async () => {
    if (v.weekly_sessions === 0) {
      const [check, done] = await run(svc(tenantId), sql => [
        sql`select exists (select 1 from public.schedule_slots sl
                             join public.schedules s on s.id = sl.schedule_id
                             join public.groups g on g.id = s.group_id and g.deleted_at is null
                             join public.school_years y on y.id = g.school_year_id and y.deleted_at is null
                            where sl.school_subject_id = ${v.subject_id} and g.school_grade_id = ${v.grade_id}) as in_use,
                   exists (select 1 from public.school_grades where id = ${v.grade_id} and tenant_id = ${tenantId} and deleted_at is null) as grade`,
        sql`with l as (
              update public.school_grade_subjects set deleted_at = now(), updated_at = now()
               where grade_id = ${v.grade_id} and subject_id = ${v.subject_id} and tenant_id = ${tenantId} and deleted_at is null
                 and not exists (select 1 from public.schedule_slots sl
                                   join public.schedules s on s.id = sl.schedule_id
                                   join public.groups g on g.id = s.group_id and g.deleted_at is null
                                   join public.school_years y on y.id = g.school_year_id and y.deleted_at is null
                                  where sl.school_subject_id = ${v.subject_id} and g.school_grade_id = ${v.grade_id})
              returning grade_id, subject_id),
            t as (update public.school_subject_teachers st set deleted_at = now(), updated_at = now()
                   from l, public.groups g
                  where st.subject_id = l.subject_id and st.deleted_at is null and g.id = st.group_id and g.school_grade_id = l.grade_id
                  returning st.id)
            select (select count(*) from l)::int as removed, (select count(*) from t)::int as teachers`,
      ])
      const c = check[0] as { in_use: boolean; grade: boolean }
      if (!c.grade) return fail('gradeNotFound', 404)
      if (c.in_use) return fail('subjectInUse', 409)
      return { ok: true, value: { removed: (done[0] as { removed: number }).removed } }
    }
    const [check, rows] = await run(svc(tenantId), sql => [
      sql`select exists (select 1 from public.school_grades where id = ${v.grade_id} and tenant_id = ${tenantId} and deleted_at is null) as grade,
                 exists (select 1 from public.school_subjects where id = ${v.subject_id} and tenant_id = ${tenantId} and deleted_at is null) as subject`,
      sql`insert into public.school_grade_subjects (tenant_id, grade_id, subject_id, weekly_sessions)
          select ${tenantId}, gr.id, su.id, ${v.weekly_sessions}
            from public.school_grades gr, public.school_subjects su
           where gr.id = ${v.grade_id} and gr.tenant_id = ${tenantId} and gr.deleted_at is null
             and su.id = ${v.subject_id} and su.tenant_id = ${tenantId} and su.deleted_at is null
             and (select count(*) from public.school_grade_subjects where tenant_id = ${tenantId} and deleted_at is null) < ${TIMETABLE_LIMITS.gradeSubjects}
          on conflict (grade_id, subject_id) where deleted_at is null
          do update set weekly_sessions = excluded.weekly_sessions, updated_at = now()
          returning grade_id, subject_id, weekly_sessions`,
    ])
    const row = maybeOne<GradeSubject>(rows)
    if (row) return { ok: true, value: row }
    const c = check[0] as { grade: boolean; subject: boolean }
    if (!c.grade) return fail('gradeNotFound', 404)
    if (!c.subject) return fail('subjectNotFound', 404)
    return fail('schoolLimitReached', 409)
  })
}

// bell schedule ---------------------------------------------------------------

const PERIOD_COLS = (sql: SqlTag) => sql`id, shift, kind, name, starts_at::text as starts_at, ends_at::text as ends_at`

export async function createPeriod(tenantId: string, v: Required<Pick<PeriodInput, 'kind' | 'starts_at' | 'ends_at'>> & PeriodInput): Promise<WriteResult<SchoolPeriod>> {
  return guarded(async () => {
    const shift = v.shift ?? null
    const [rows] = await run(svc(tenantId), sql => [
      sql`insert into public.school_periods (tenant_id, shift, kind, name, starts_at, ends_at)
          select ${tenantId}, ${shift}::text, ${v.kind}, ${v.name ?? null}, ${v.starts_at}::time, ${v.ends_at}::time
           where (select count(*) from public.school_periods
                   where tenant_id = ${tenantId} and shift is not distinct from ${shift}::text and deleted_at is null) < ${TIMETABLE_LIMITS.periodsPerShift}
          returning ${PERIOD_COLS(sql)}`,
    ])
    const row = maybeOne<SchoolPeriod>(rows)
    return row ? { ok: true, value: row } : fail('schoolLimitReached', 409)
  })
}

/** New times / type / shift are re-checked against every current cell of the period by the database. */
export async function updatePeriod(tenantId: string, id: string, v: PeriodInput): Promise<WriteResult<SchoolPeriod>> {
  return guarded(async () => {
    const [existing, rows] = await run(svc(tenantId), sql => [
      sql`select 1 from public.school_periods where id = ${id} and tenant_id = ${tenantId} and deleted_at is null`,
      sql`update public.school_periods set
            kind = coalesce(${v.kind ?? null}::text, kind),
            shift = case when ${v.shift !== undefined} then ${v.shift ?? null}::text else shift end,
            name = case when ${v.name !== undefined} then ${v.name ?? null}::text else name end,
            starts_at = coalesce(${v.starts_at ?? null}::time, starts_at),
            ends_at = coalesce(${v.ends_at ?? null}::time, ends_at)
          where id = ${id} and tenant_id = ${tenantId} and deleted_at is null
            and coalesce(${v.ends_at ?? null}::time, ends_at) > coalesce(${v.starts_at ?? null}::time, starts_at)
          returning ${PERIOD_COLS(sql)}`,
    ])
    const row = maybeOne<SchoolPeriod>(rows)
    if (row) return { ok: true, value: row }
    return existing.length ? fail('endTimeBeforeStart', 400) : fail('periodNotFound', 404)
  })
}

/** Archive a period (soft): refused while a current timetable uses it. */
export async function archivePeriod(tenantId: string, id: string): Promise<WriteResult<{ id: string }>> {
  return guarded(async () => {
    const [check, done] = await run(svc(tenantId), sql => [
      sql`select 1 from public.school_periods where id = ${id} and tenant_id = ${tenantId} and deleted_at is null`,
      sql`update public.school_periods set deleted_at = now()
           where id = ${id} and tenant_id = ${tenantId} and deleted_at is null
             and not ${usedByCurrentCell(sql, 'period', id)}
          returning id`,
    ])
    if (done.length) return { ok: true, value: { id } }
    return check.length ? fail('periodInUse', 409) : fail('periodNotFound', 404)
  })
}

// subject teachers ---------------------------------------------------------------

/**
 * The teacher of a subject in a section (upsert), or none (teacher_id null:
 * soft-deletes the assignment). The database copies the teacher into the
 * section's cells of that subject and refuses the change if the teacher would
 * be in two places at once.
 */
export async function setSubjectTeacher(tenantId: string, v: SubjectTeacherInput): Promise<WriteResult<SubjectTeacher | { removed: number }>> {
  return guarded<SubjectTeacher | { removed: number }>(async () => {
    const sectionOk = (sql: SqlTag) =>
      sql`exists (select 1 from public.groups where id = ${v.section_id} and tenant_id = ${tenantId}
                    and school_grade_id is not null and deleted_at is null and is_active)`
    if (v.teacher_id === null) {
      const [check, rows] = await run(svc(tenantId), sql => [
        sql`select ${sectionOk(sql)} as section`,
        sql`update public.school_subject_teachers set deleted_at = now(), updated_at = now()
             where group_id = ${v.section_id} and subject_id = ${v.subject_id} and tenant_id = ${tenantId} and deleted_at is null
            returning id`,
      ])
      if (!(check[0] as { section: boolean }).section) return fail('sectionNotFound', 404)
      return { ok: true, value: { removed: rows.length } }
    }
    const teacher = v.teacher_id
    const [check, rows] = await run(svc(tenantId), sql => [
      sql`select ${sectionOk(sql)} as section,
                 exists (select 1 from public.school_subjects su
                           join public.school_grade_subjects gs on gs.subject_id = su.id and gs.deleted_at is null
                           join public.groups g on g.id = ${v.section_id} and g.school_grade_id = gs.grade_id
                          where su.id = ${v.subject_id} and su.tenant_id = ${tenantId} and su.deleted_at is null) as subject,
                 exists (select 1 from public.users where id = ${teacher} and tenant_id = ${tenantId}
                           and role = 'teacher' and is_active is not false) as teacher`,
      sql`insert into public.school_subject_teachers (tenant_id, group_id, subject_id, teacher_id)
          select ${tenantId}, g.id, ${v.subject_id}, u.id
            from public.groups g, public.users u
           where g.id = ${v.section_id} and g.tenant_id = ${tenantId} and g.school_grade_id is not null
             and g.deleted_at is null and g.is_active
             and u.id = ${teacher} and u.tenant_id = ${tenantId} and u.role = 'teacher' and u.is_active is not false
          on conflict (group_id, subject_id) where deleted_at is null
          do update set teacher_id = excluded.teacher_id, updated_at = now()
          returning subject_id, teacher_id, (select full_name from public.users where id = ${teacher}) as teacher_name`,
    ])
    const row = maybeOne<SubjectTeacher>(rows)
    if (row) return { ok: true, value: row }
    const c = check[0] as { section: boolean; subject: boolean; teacher: boolean }
    if (!c.section) return fail('sectionNotFound', 404)
    if (!c.subject) return fail('subjectNotInGrade', 400)
    return fail('teacherNotInTenant', 400)
  })
}

// timetable cells ----------------------------------------------------------------

/** The section's group timetable, created on first use (one per group: uq_schedules_group). */
const ENSURE_SCHEDULE = (sql: SqlTag, tenantId: string, callerId: string, sectionId: string) =>
  sql`insert into public.schedules (tenant_id, created_by, kind, group_id, title, is_published)
      select ${tenantId}, ${callerId}, 'group', g.id, left(g.name, 200), false
        from public.groups g
       where g.id = ${sectionId} and g.tenant_id = ${tenantId} and g.school_grade_id is not null
         and g.deleted_at is null and g.is_active
      on conflict (group_id) where group_id is not null do nothing`

/**
 * Put a subject in a cell (day × period) of a section's timetable, replacing
 * what was there. One unit: the checks a precise refusal needs, the section's
 * timetable (created on first use), then the cell. The database fills in the
 * period's times, the subject's name and teacher, and refuses a subject outside
 * the grade, a break, another shift's period, or a teacher clash.
 */
export async function setCell(tenantId: string, callerId: string, v: CellInput & { subject_id: string }): Promise<WriteResult<TimetableCell>> {
  return guarded(async () => {
    const [check, , rows] = await run(svc(tenantId), sql => [
      sql`select exists (select 1 from public.groups where id = ${v.section_id} and tenant_id = ${tenantId}
                           and school_grade_id is not null and deleted_at is null and is_active) as section,
                 exists (select 1 from public.school_periods where id = ${v.period_id} and tenant_id = ${tenantId} and deleted_at is null) as period,
                 exists (select 1 from public.school_subjects where id = ${v.subject_id} and tenant_id = ${tenantId} and deleted_at is null) as subject`,
      ENSURE_SCHEDULE(sql, tenantId, callerId, v.section_id),
      sql`insert into public.schedule_slots (schedule_id, tenant_id, day_of_week, start_time, end_time, title, school_period_id, school_subject_id)
          select s.id, ${tenantId}, ${v.day}, p.starts_at, p.ends_at, su.name, p.id, su.id
            from public.schedules s, public.school_periods p, public.school_subjects su
           where s.group_id = ${v.section_id} and s.tenant_id = ${tenantId}
             and exists (select 1 from public.groups g where g.id = s.group_id and g.school_grade_id is not null
                           and g.deleted_at is null and g.is_active)
             and p.id = ${v.period_id} and p.tenant_id = ${tenantId} and p.deleted_at is null
             and su.id = ${v.subject_id} and su.tenant_id = ${tenantId} and su.deleted_at is null
          on conflict (schedule_id, day_of_week, school_period_id) where school_period_id is not null
          do update set school_subject_id = excluded.school_subject_id
          returning id, day_of_week as day, school_period_id as period_id, school_subject_id as subject_id, teacher_id`,
    ])
    const row = maybeOne<TimetableCell>(rows)
    if (row) return { ok: true, value: row }
    const c = check[0] as { section: boolean; period: boolean; subject: boolean }
    if (!c.section) return fail('sectionNotFound', 404)
    if (!c.period) return fail('periodNotFound', 404)
    return fail('subjectNotFound', 404)
  })
}

/** Empty a cell (its schedule_slots row is deleted, as any timetable slot is). */
export async function clearCell(tenantId: string, v: CellInput): Promise<WriteResult<{ removed: number }>> {
  const [check, rows] = await run(svc(tenantId), sql => [
    sql`select 1 from public.groups where id = ${v.section_id} and tenant_id = ${tenantId}
           and school_grade_id is not null and deleted_at is null and is_active`,
    sql`delete from public.schedule_slots sl using public.schedules s
         where s.id = sl.schedule_id and s.group_id = ${v.section_id} and s.tenant_id = ${tenantId}
           and sl.day_of_week = ${v.day} and sl.school_period_id = ${v.period_id}
           and exists (select 1 from public.groups g where g.id = s.group_id and g.deleted_at is null and g.is_active)
        returning sl.id`,
  ])
  if (!check.length) return fail('sectionNotFound', 404)
  return { ok: true, value: { removed: rows.length } }
}

/** Publish the section's timetable to its students (or take it back); the timetable is created if needed. */
export async function publishTimetable(tenantId: string, callerId: string, sectionId: string, published: boolean): Promise<WriteResult<{ is_published: boolean }>> {
  const [, rows] = await run(svc(tenantId), sql => [
    ENSURE_SCHEDULE(sql, tenantId, callerId, sectionId),
    sql`update public.schedules s set is_published = ${published}, updated_at = now()
          from public.groups g
         where s.group_id = ${sectionId} and s.tenant_id = ${tenantId} and g.id = s.group_id
           and g.school_grade_id is not null and g.deleted_at is null and g.is_active
        returning s.is_published`,
  ])
  const row = maybeOne<{ is_published: boolean }>(rows)
  return row ? { ok: true, value: row } : fail('sectionNotFound', 404)
}
