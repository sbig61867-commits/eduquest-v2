import { run, maybeOne, type Sql } from '@/lib/db/sql'

// ── Report reads (PERFORMANCE_CONTRACT.md P1, P2, P5, P10) ──────────────────
//
// The reports run behind the super_admin gate in /api/reports, as app_service
// in platform scope, so every read is scoped explicitly by the report's
// subject (institution, teacher, group or student).
//
// Step 9: each report is ONE unit of complete reads. There is no row cap per
// statement on the SQL layer, so the old paging (counted pages, keyset pages,
// and the count-vs-rows check that guarded against a silently cut response)
// is gone; a failed statement fails the whole unit, which is turned into
// ReportReadError, so /api/reports still answers an error — never a report
// built from a partial set (D1).
//
// Exams are read without `questions`. A submission scored before it was
// finalised (a score but no max_score) falls back to its exam's question-point
// total, computed in the statement — and, as before, only for an exam in the
// report's own (live) exam list; anything else keeps no maximum.

/**
 * A report read failed. The report is then not built at all: /api/reports
 * answers an error instead of a report computed from a partial set.
 */
export class ReportReadError extends Error {
  constructor(message: string, readonly detail?: { message: string; code?: string } | null) {
    super(message)
    this.name = 'ReportReadError'
  }
}

/** One report's reads in one unit; any failure becomes ReportReadError. */
async function readUnit(what: string, build: Parameters<typeof run>[1]) {
  try {
    return await run({ as: 'service', platform: true }, build)
  } catch (e) {
    const err = e as { message?: string; code?: string }
    throw new ReportReadError(`${what}: read failed (${err.code ?? "?"}: ${err.message ?? String(e)})`, { message: err.message ?? String(e), code: err.code })
  }
}

// ── Row shapes ──────────────────────────────────────────────────────────────

export interface ReportExam {
  id: string; title: string; type: string; group_id: string; teacher_id: string
  created_at: string; proctoring_enabled: boolean
}
export interface ReportSub {
  id: string; exam_id: string; student_id: string; score: number | null; max_score: number | null
  is_graded: boolean; is_flagged: boolean; submitted_at: string | null
}

interface Person { id: string; full_name: string; email: string }
interface Member { group_id: string; student_id: string; users: { full_name: string; email: string } | null }

/**
 * The submission columns, with the fallback maximum: the stored max_score, or —
 * for a scored, unfinalised submission of a live exam in `listed` — the
 * exam's question-point total (the same rule finalize_exam_submission uses).
 */
const subColumns = (sql: Sql, listed: ReturnType<Sql>) => sql`
  s.id, s.exam_id, s.student_id, s.score, s.is_graded, s.is_flagged, s.submitted_at,
  case when s.max_score is null and s.score is not null and ${listed}
       then (select coalesce(sum(coalesce((q->>'points')::numeric, 0)), 0)
               from jsonb_array_elements(case when jsonb_typeof(e.questions) = 'array' then e.questions else '[]'::jsonb end) q)
       else s.max_score end as max_score`

const memberColumns = (sql: Sql) => sql`
  gs.group_id, gs.student_id,
  case when u.id is null then null else json_build_object('full_name', u.full_name, 'email', u.email) end as users`

// ── University ──────────────────────────────────────────────────────────────

export async function loadUniversityData(tenantId: string) {
  const rows = await readUnit('institution', sql => [
    sql`select id, name from public.tenants where id = ${tenantId}`,
    sql`select id, full_name, email from public.users where tenant_id = ${tenantId} and role = 'teacher' order by created_at, id`,
    sql`select count(*)::int as n from public.users where tenant_id = ${tenantId} and role = 'student'`,
    sql`select id, name, teacher_id from public.groups where tenant_id = ${tenantId} and deleted_at is null order by created_at, id`,
    sql`select id, title, group_id, teacher_id, created_at from public.exams where tenant_id = ${tenantId} and deleted_at is null order by id`,
    sql`select count(*)::int as n from public.lessons where tenant_id = ${tenantId} and is_published and deleted_at is null`,
    sql`select ${subColumns(sql, sql`e.tenant_id = ${tenantId} and e.deleted_at is null`)}
          from public.exam_submissions s join public.exams e on e.id = s.exam_id
         where s.tenant_id = ${tenantId} order by s.id`,
    // Members of the institution's live groups, counted per group.
    sql`select gs.group_id, gs.student_id from public.group_students gs join public.groups g on g.id = gs.group_id
         where g.tenant_id = ${tenantId} and g.deleted_at is null order by gs.group_id, gs.student_id`,
  ])
  const tenant = maybeOne<{ id: string; name: string }>(rows[0])
  if (!tenant) return null
  return {
    tenant,
    teachers: rows[1] as unknown as Person[],
    studentCount: maybeOne<{ n: number }>(rows[2])!.n,
    groups: rows[3] as unknown as { id: string; name: string; teacher_id: string }[],
    exams: rows[4] as unknown as ReportExam[],
    lessonCount: maybeOne<{ n: number }>(rows[5])!.n,
    subs: rows[6] as unknown as ReportSub[],
    memberships: rows[7] as unknown as { group_id: string; student_id: string }[],
  }
}

// ── Teacher ─────────────────────────────────────────────────────────────────

export async function loadTeacherData(teacherId: string) {
  const rows = await readUnit('teacher', sql => [
    sql`select u.id, u.full_name, u.email, u.tenant_id,
               case when t.id is null then null else json_build_object('name', t.name) end as tenants
          from public.users u left join public.tenants t on t.id = u.tenant_id where u.id = ${teacherId}`,
    sql`select id, name from public.groups where teacher_id = ${teacherId} and deleted_at is null order by created_at, id`,
    sql`select id, title, type, group_id from public.exams where teacher_id = ${teacherId} and deleted_at is null order by created_at, id`,
    sql`select count(*)::int as n from public.lessons where teacher_id = ${teacherId} and is_published and deleted_at is null`,
    // Members of the teacher's live groups.
    sql`select ${memberColumns(sql)} from public.group_students gs
          join public.groups g on g.id = gs.group_id left join public.users u on u.id = gs.student_id
         where g.teacher_id = ${teacherId} and g.deleted_at is null order by gs.group_id, gs.student_id`,
    // Submissions to the teacher's live exams.
    sql`select ${subColumns(sql, sql`true`)} from public.exam_submissions s join public.exams e on e.id = s.exam_id
         where e.teacher_id = ${teacherId} and e.deleted_at is null order by s.id`,
  ])
  const teacher = maybeOne<Person & { tenants: { name: string } | null }>(rows[0])
  if (!teacher) return null
  return {
    teacher,
    groups: rows[1] as unknown as { id: string; name: string }[],
    exams: rows[2] as unknown as ReportExam[],
    lessonCount: maybeOne<{ n: number }>(rows[3])!.n,
    members: rows[4] as unknown as Member[],
    subs: rows[5] as unknown as ReportSub[],
  }
}

// ── Group and pilot (one group) ─────────────────────────────────────────────

interface GroupRow { id: string; name: string; created_at?: string; users: { full_name: string } | null; tenants: { name: string } | null }

const groupSql = (sql: Sql, groupId: string) => [
  sql`select g.id, g.name, g.tenant_id, g.created_at,
             case when u.id is null then null else json_build_object('full_name', u.full_name) end as users,
             case when t.id is null then null else json_build_object('name', t.name) end as tenants
        from public.groups g left join public.users u on u.id = g.teacher_id left join public.tenants t on t.id = g.tenant_id
       where g.id = ${groupId}`,
  sql`select id, title, type, created_at, proctoring_enabled from public.exams
       where group_id = ${groupId} and deleted_at is null order by created_at, id`,
  sql`select ${memberColumns(sql)} from public.group_students gs left join public.users u on u.id = gs.student_id
       where gs.group_id = ${groupId} order by gs.joined_at, gs.student_id`,
  sql`select ${subColumns(sql, sql`true`)} from public.exam_submissions s join public.exams e on e.id = s.exam_id
       where e.group_id = ${groupId} and e.deleted_at is null order by s.id`,
]

export async function loadGroupReportData(groupId: string) {
  const rows = await readUnit('group', sql => groupSql(sql, groupId))
  const group = maybeOne<GroupRow>(rows[0])
  if (!group) return null
  return { group, exams: rows[1] as unknown as ReportExam[], members: rows[2] as unknown as Member[], subs: rows[3] as unknown as ReportSub[] }
}

export interface SurveyResponse {
  ease_rating: number; prefer_platform: boolean; recommend: boolean
  best_feature: string | null; problem_faced: string | null; comment: string | null
}

export async function loadPilotData(groupId: string) {
  const rows = await readUnit('group', sql => [
    ...groupSql(sql, groupId),
    sql`select count(*)::int as n from public.lessons where group_id = ${groupId} and is_published and deleted_at is null`,
    // The group's survey answers (a group has at most one survey; none = no answers).
    sql`select r.ease_rating, r.prefer_platform, r.recommend, r.best_feature, r.problem_faced, r.comment
          from public.survey_responses r join public.surveys sv on sv.id = r.survey_id
         where sv.group_id = ${groupId} order by r.id`,
  ])
  const group = maybeOne<GroupRow & { created_at: string }>(rows[0])
  if (!group) return null
  return {
    group, exams: rows[1] as unknown as ReportExam[], members: rows[2] as unknown as Member[],
    lessonCount: maybeOne<{ n: number }>(rows[4])!.n, subs: rows[3] as unknown as ReportSub[],
    responses: rows[5] as unknown as SurveyResponse[],
  }
}

// ── Student ─────────────────────────────────────────────────────────────────

interface Membership { group_id: string; groups: { id: string; name: string; deleted_at: string | null; users: { full_name: string } | null } | null }

export async function loadStudentData(studentId: string) {
  // The student's live groups decide the exam set; every statement below
  // filters through the same membership, so the whole report is one unit.
  const liveGroups = (sql: Sql) => sql`(select gs.group_id from public.group_students gs
      join public.groups g on g.id = gs.group_id where gs.student_id = ${studentId} and g.deleted_at is null)`
  const rows = await readUnit('student', sql => [
    sql`select u.id, u.full_name, u.email, u.created_at, u.tenant_id,
               case when t.id is null then null else json_build_object('name', t.name) end as tenants
          from public.users u left join public.tenants t on t.id = u.tenant_id where u.id = ${studentId}`,
    sql`select gs.group_id,
               case when g.id is null then null else json_build_object('id', g.id, 'name', g.name, 'deleted_at', g.deleted_at,
                 'users', case when t.id is null then null else json_build_object('full_name', t.full_name) end) end as groups
          from public.group_students gs
          left join public.groups g on g.id = gs.group_id left join public.users t on t.id = g.teacher_id
         where gs.student_id = ${studentId} order by gs.joined_at, gs.group_id`,
    sql`select id, title, type, group_id, created_at from public.exams
         where group_id in ${liveGroups(sql)} and is_published and deleted_at is null order by created_at, id`,
    // Every submission to those exams: the student's own are among them (read once).
    sql`select ${subColumns(sql, sql`true`)} from public.exam_submissions s join public.exams e on e.id = s.exam_id
         where e.group_id in ${liveGroups(sql)} and e.is_published and e.deleted_at is null order by s.id`,
  ])
  const student = maybeOne<Person & { created_at: string; tenants: { name: string } | null }>(rows[0])
  if (!student) return null
  const memberships = rows[1] as unknown as Membership[]
  const activeGroups = memberships.filter(m => m.groups && !m.groups.deleted_at) as (Membership & { groups: NonNullable<Membership['groups']> })[]
  const peerSubs = rows[3] as unknown as ReportSub[]
  return { student, activeGroups, exams: rows[2] as unknown as ReportExam[], peerSubs, ownSubs: peerSubs.filter(s => s.student_id === studentId) }
}
