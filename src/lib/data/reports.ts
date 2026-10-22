import type { SupabaseClient } from '@/lib/db'

// ── Report reads (PERFORMANCE_CONTRACT.md P1, P2, P5, P10) ──────────────────
//
// The reports run with the service-role client behind the super_admin gate in
// /api/reports, so RLS does not apply here: every read is scoped explicitly by
// the report's subject (institution, teacher, group or student).
//
// The API answers at most `max_rows` (1000 on this project) rows per request
// and says nothing when it cuts a result short, so a report read whole could
// silently be built from a partial set. A read that fails, or comes back with
// fewer rows than the database counted, throws ReportReadError instead (D1), so
// /api/reports answers an error, never a partial report. Every list read is paged: submissions
// (the large sets) by keyset on their primary key — readAllById(), linear in the
// set's size; an OFFSET page re-sorts the whole filtered set (measured: 72 000
// submissions = 1.7–4.9 s of database time paged by OFFSET, 0.1 s by keyset) —
// and the smaller ordered sets with readAll(), counted pages read a few at a
// time, so their display order (created_at) is kept. Submissions are filtered by
// their exam's teacher / group through a filter-only embed (`exams!inner()`)
// rather than a list of exam ids, so the request stays one URL of fixed size.
//
// Exams are read without `questions`: a submission's own max_score is the sum
// of its exam's points (finalize_exam_submission writes it with the same rule),
// and the questions were ~97% of the bytes. The one case without a max_score (a
// score set before finalisation) reads its exams' questions on demand — see
// withFallbackMax().

/** The API's max_rows: a larger page would be cut to this anyway. */
export const PAGE_SIZE = 1000
/** Pages read at once after the first (which carries the exact count). */
const PAGE_CONCURRENCY = 4

interface ReadError { message: string; code?: string }
type Result = { data: unknown[] | null; count?: number | null; error?: ReadError | null }
type Page = PromiseLike<Result>

/**
 * A report read failed, or came back with fewer (or more) rows than the
 * database counted. The report is then not built at all: /api/reports answers
 * an error instead of a report computed from a partial set. This also catches
 * a max_rows lowered below PAGE_SIZE (pages come back short) and rows changing
 * while the report is read (the counts stop matching) — both fail on purpose.
 */
export class ReportReadError extends Error {
  constructor(message: string, readonly detail?: ReadError | null) {
    super(message)
    this.name = 'ReportReadError'
  }
}

/** The exact count of a head-only (or counted) read; a failed or missing count is an error, never 0. */
function countOf(r: Result, what: string): number {
  if (r.error) throw new ReportReadError(`${what}: count failed`, r.error)
  if (r.count == null) throw new ReportReadError(`${what}: no count returned`)
  return r.count
}

/** A subject row read with .single(): no row (PGRST116) is null — the route's 404 — any other failure is an error. */
function subjectRow<T>(r: { data: T | null; error: ReadError | null }, what: string): T | null {
  if (r.error && r.error.code !== 'PGRST116') throw new ReportReadError(`${what}: read failed`, r.error)
  return r.data
}

/**
 * The rows of one counted page, which must hold exactly what is left of the
 * count from `from` (PAGE_SIZE, or the remainder on the last page) — anything
 * else is an error, including a page cut short by a lower max_rows.
 */
function pageRows(r: Result, from: number, total: number): unknown[] {
  if (r.error) throw new ReportReadError(`page at ${from}: read failed`, r.error)
  const rows = r.data ?? []
  const expected = Math.min(PAGE_SIZE, Math.max(total - from, 0))
  if (rows.length !== expected) throw new ReportReadError(`page at ${from}: ${rows.length} rows, expected ${expected} of ${total}`)
  return rows
}

/**
 * Every row of a read, page by page. `page(from, to, withCount)` must order by a
 * unique key, so the pages neither overlap nor skip; the first page asks for the
 * exact count and the rest are read a few at a time. Every page must be complete
 * against that count; a failed page, a missing count or a short page throws
 * ReportReadError.
 */
export async function readAll<T>(page: (from: number, to: number, withCount: boolean) => Page): Promise<T[]> {
  const first = await page(0, PAGE_SIZE - 1, true)
  if (first.error) throw new ReportReadError('first page: read failed', first.error)
  const total = countOf(first, 'first page')
  const rows = [...pageRows(first, 0, total)] as T[]
  const starts: number[] = []
  for (let from = PAGE_SIZE; from < total; from += PAGE_SIZE) starts.push(from)
  for (let i = 0; i < starts.length; i += PAGE_CONCURRENCY) {
    const slice = starts.slice(i, i + PAGE_CONCURRENCY)
    const batch = await Promise.all(slice.map(from => page(from, from + PAGE_SIZE - 1, false)))
    batch.forEach((r, k) => rows.push(...(pageRows(r, slice[k], total) as T[])))
  }
  return rows
}

/** Every uuid sorts after the nil uuid, so `id > FIRST_ID` is the first keyset page. */
export const FIRST_ID = '00000000-0000-0000-0000-000000000000'

/**
 * Every row of a large read, by keyset on `id`: each page is the next PAGE_SIZE
 * rows after the last id seen (`page(afterId)` filters `id > afterId`, orders by
 * id and limits to PAGE_SIZE; the first call gets FIRST_ID). Pages follow one
 * another; the read ends on a short page. `count()` is the same read as a
 * head-only exact count, run alongside the first page: the rows read must equal
 * it, so a failed page or count, or a short page (e.g. a lower max_rows), throws
 * ReportReadError.
 */
export async function readAllById<T extends { id: string }>(page: (afterId: string) => Page, count: () => Page): Promise<T[]> {
  const [firstPage, counted] = await Promise.all([page(FIRST_ID), count()])
  const expected = countOf(counted, 'keyset count')
  const rows: T[] = []
  let res = firstPage
  for (;;) {
    if (res.error) throw new ReportReadError(`keyset page after ${rows.length} rows: read failed`, res.error)
    const batch = (res.data ?? []) as T[]
    rows.push(...batch)
    if (batch.length < PAGE_SIZE) break
    res = await page(batch[batch.length - 1].id)
  }
  if (rows.length !== expected) throw new ReportReadError(`keyset read: ${rows.length} rows, expected ${expected}`)
  return rows
}

const withCount = (on: boolean) => (on ? { count: 'exact' as const } : undefined)

// ── Row shapes ──────────────────────────────────────────────────────────────

export interface ReportExam {
  id: string; title: string; type: string; group_id: string; teacher_id: string
  created_at: string; proctoring_enabled: boolean
}
export interface ReportSub {
  id: string; exam_id: string; student_id: string; score: number | null; max_score: number | null
  is_graded: boolean; is_flagged: boolean; submitted_at: string | null
}
/** The pre-P-07 fallback maximum of a submission: its exam's question-point total (same expression as the old examMax). */
function questionPointTotal(questions: unknown): number {
  if (!Array.isArray(questions)) return 0
  return (questions as Array<{ points?: number }>).reduce((s, q) => s + (q.points ?? 0), 0)
}

/** Exam ids per fallback read: well under max_rows, and a short URL. */
export const FALLBACK_CHUNK = 100

/**
 * A submission scored before it was finalised (a score but no max_score — e.g. a
 * teacher scoring a homework attempt that was never submitted) has no stored
 * maximum, and the reports used its exam's question-point total instead. Exams are
 * no longer read with their questions, so for exactly those exams — and only when
 * such a submission exists — read the questions in bounded chunks and fill that
 * maximum in. As before, only exams in the report's own exam list count; anything
 * else keeps no maximum (0).
 */
async function withFallbackMax(admin: SupabaseClient, subs: ReportSub[], reportExamIds: Iterable<string>): Promise<ReportSub[]> {
  const listed = new Set(reportExamIds)
  const ids = [...new Set(subs.filter(s => s.score != null && s.max_score == null && listed.has(s.exam_id)).map(s => s.exam_id))]
  if (!ids.length) return subs
  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += FALLBACK_CHUNK) chunks.push(ids.slice(i, i + FALLBACK_CHUNK))
  const pages = await Promise.all(chunks.map(chunk =>
    admin.from('exams').select('id, questions').in('id', chunk).limit(FALLBACK_CHUNK)))
  const total = new Map<string, number>()
  for (const { data, error } of pages) {
    if (error) throw new ReportReadError('fallback exam questions: read failed', error)
    for (const e of (data ?? []) as { id: string; questions: unknown }[]) total.set(e.id, questionPointTotal(e.questions))
  }
  return subs.map(s => (s.score != null && s.max_score == null && total.has(s.exam_id) ? { ...s, max_score: total.get(s.exam_id)! } : s))
}

interface Person { id: string; full_name: string; email: string }
interface Member { group_id: string; student_id: string; users: { full_name: string; email: string } | null }

// ── University ──────────────────────────────────────────────────────────────

export const UNIVERSITY_EXAM_COLUMNS = 'id, title, group_id, teacher_id, created_at'
export const UNIVERSITY_SUB_COLUMNS = 'id, exam_id, score, max_score, is_flagged, submitted_at'

export async function loadUniversityData(admin: SupabaseClient, tenantId: string) {
  const tenant = subjectRow(await admin.from('tenants').select('id, name').eq('id', tenantId).single(), 'institution')
  if (!tenant) return null
  const [teachers, studentRes, groups, exams, lessonRes, subs, memberships] = await Promise.all([
    readAll<Person>((f, t, c) => admin.from('users').select('id, full_name, email', withCount(c))
      .eq('tenant_id', tenantId).eq('role', 'teacher').order('created_at').order('id').range(f, t)),
    // Students are only counted.
    admin.from('users').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('role', 'student'),
    readAll<{ id: string; name: string; teacher_id: string }>((f, t, c) => admin.from('groups').select('id, name, teacher_id', withCount(c))
      .eq('tenant_id', tenantId).is('deleted_at', null).order('created_at').order('id').range(f, t)),
    readAll<ReportExam>((f, t, c) => admin.from('exams').select(UNIVERSITY_EXAM_COLUMNS, withCount(c))
      .eq('tenant_id', tenantId).is('deleted_at', null).order('id').range(f, t)),
    admin.from('lessons').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('is_published', true).is('deleted_at', null),
    readAllById<ReportSub>(after => admin.from('exam_submissions').select(UNIVERSITY_SUB_COLUMNS)
      .eq('tenant_id', tenantId).gt('id', after).order('id').limit(PAGE_SIZE),
    () => admin.from('exam_submissions').select(UNIVERSITY_SUB_COLUMNS, { count: 'exact', head: true })
      .eq('tenant_id', tenantId)),
    // Members of the institution's live groups, counted per group.
    readAll<{ group_id: string; student_id: string }>((f, t, c) => admin.from('group_students').select('group_id, student_id, groups!inner()', withCount(c))
      .eq('groups.tenant_id', tenantId).is('groups.deleted_at', null).order('group_id').order('student_id').range(f, t)),
  ])
  const studentCount = countOf(studentRes, 'students')
  const lessonCount = countOf(lessonRes, 'lessons')
  return {
    tenant: tenant as { id: string; name: string }, teachers, studentCount, groups, exams, lessonCount,
    subs: await withFallbackMax(admin, subs, exams.map(e => e.id)), memberships,
  }
}

// ── Teacher ─────────────────────────────────────────────────────────────────

export const TEACHER_EXAM_COLUMNS = 'id, title, type, group_id'
export const TEACHER_SUB_COLUMNS = 'id, exam_id, student_id, score, max_score, is_graded, exams!inner()'

export async function loadTeacherData(admin: SupabaseClient, teacherId: string) {
  const teacher = subjectRow(await admin.from('users').select('id, full_name, email, tenant_id, tenants(name)').eq('id', teacherId).single(), 'teacher')
  if (!teacher) return null
  const [groups, exams, lessonRes, members, subs] = await Promise.all([
    readAll<{ id: string; name: string }>((f, t, c) => admin.from('groups').select('id, name', withCount(c))
      .eq('teacher_id', teacherId).is('deleted_at', null).order('created_at', { ascending: true }).order('id').range(f, t)),
    readAll<ReportExam>((f, t, c) => admin.from('exams').select(TEACHER_EXAM_COLUMNS, withCount(c))
      .eq('teacher_id', teacherId).is('deleted_at', null).order('created_at', { ascending: true }).order('id').range(f, t)),
    admin.from('lessons').select('id', { count: 'exact', head: true }).eq('teacher_id', teacherId).eq('is_published', true).is('deleted_at', null),
    // Members of the teacher's live groups.
    readAll<Member>((f, t, c) => admin.from('group_students').select('group_id, student_id, users(full_name, email), groups!inner()', withCount(c))
      .eq('groups.teacher_id', teacherId).is('groups.deleted_at', null).order('group_id').order('student_id').range(f, t)),
    // Submissions to the teacher's live exams.
    readAllById<ReportSub>(after => admin.from('exam_submissions').select(TEACHER_SUB_COLUMNS)
      .eq('exams.teacher_id', teacherId).is('exams.deleted_at', null).gt('id', after).order('id').limit(PAGE_SIZE),
    () => admin.from('exam_submissions').select(TEACHER_SUB_COLUMNS, { count: 'exact', head: true })
      .eq('exams.teacher_id', teacherId).is('exams.deleted_at', null)),
  ])
  return {
    teacher: teacher as unknown as Person & { tenants: { name: string } | null }, groups, exams, lessonCount: countOf(lessonRes, 'lessons'), members,
    subs: await withFallbackMax(admin, subs, exams.map(e => e.id)),
  }
}

// ── Group and pilot (one group) ─────────────────────────────────────────────

export const GROUP_EXAM_COLUMNS = 'id, title, type, created_at, proctoring_enabled'
export const GROUP_SUB_COLUMNS = 'id, exam_id, student_id, score, max_score, is_graded, is_flagged, submitted_at, exams!inner()'

const groupExams = (admin: SupabaseClient, groupId: string) =>
  readAll<ReportExam>((f, t, c) => admin.from('exams').select(GROUP_EXAM_COLUMNS, withCount(c))
    .eq('group_id', groupId).is('deleted_at', null).order('created_at', { ascending: true }).order('id').range(f, t))
const groupMembers = (admin: SupabaseClient, groupId: string) =>
  readAll<Member>((f, t, c) => admin.from('group_students').select('group_id, student_id, users(full_name, email)', withCount(c))
    .eq('group_id', groupId).order('joined_at').order('student_id').range(f, t))
const groupSubs = (admin: SupabaseClient, groupId: string) =>
  readAllById<ReportSub>(after => admin.from('exam_submissions').select(GROUP_SUB_COLUMNS)
    .eq('exams.group_id', groupId).is('exams.deleted_at', null).gt('id', after).order('id').limit(PAGE_SIZE),
  () => admin.from('exam_submissions').select(GROUP_SUB_COLUMNS, { count: 'exact', head: true })
    .eq('exams.group_id', groupId).is('exams.deleted_at', null))

export async function loadGroupReportData(admin: SupabaseClient, groupId: string) {
  const group = subjectRow(await admin.from('groups').select('id, name, tenant_id, users:teacher_id(full_name), tenants(name)').eq('id', groupId).single(), 'group')
  if (!group) return null
  const [exams, members, subs] = await Promise.all([groupExams(admin, groupId), groupMembers(admin, groupId), groupSubs(admin, groupId)])
  return { group: group as unknown as GroupRow, exams, members, subs: await withFallbackMax(admin, subs, exams.map(e => e.id)) }
}

export interface SurveyResponse {
  ease_rating: number; prefer_platform: boolean; recommend: boolean
  best_feature: string | null; problem_faced: string | null; comment: string | null
}
interface GroupRow { id: string; name: string; created_at?: string; users: { full_name: string } | null; tenants: { name: string } | null }

export async function loadPilotData(admin: SupabaseClient, groupId: string) {
  const group = subjectRow(await admin.from('groups').select('id, name, tenant_id, created_at, users:teacher_id(full_name), tenants(name)').eq('id', groupId).single(), 'group')
  if (!group) return null
  const [exams, members, lessonRes, subs, responses] = await Promise.all([
    groupExams(admin, groupId),
    groupMembers(admin, groupId),
    admin.from('lessons').select('id', { count: 'exact', head: true }).eq('group_id', groupId).eq('is_published', true).is('deleted_at', null),
    groupSubs(admin, groupId),
    // The group's survey answers (a group has at most one survey; none = no answers).
    readAll<SurveyResponse>((f, t, c) => admin.from('survey_responses')
      .select('ease_rating, prefer_platform, recommend, best_feature, problem_faced, comment, surveys!inner()', withCount(c))
      .eq('surveys.group_id', groupId).order('id').range(f, t)),
  ])
  return {
    group: group as unknown as GroupRow & { created_at: string }, exams, members, lessonCount: countOf(lessonRes, 'lessons'),
    subs: await withFallbackMax(admin, subs, exams.map(e => e.id)), responses,
  }
}

// ── Student ─────────────────────────────────────────────────────────────────

export const STUDENT_EXAM_COLUMNS = 'id, title, type, group_id, created_at'
export const STUDENT_SUB_COLUMNS = 'id, exam_id, student_id, score, max_score, is_flagged, submitted_at, exams!inner()'

interface Membership { group_id: string; groups: { id: string; name: string; deleted_at: string | null; users: { full_name: string } | null } | null }

export async function loadStudentData(admin: SupabaseClient, studentId: string) {
  const [studentRes, memberships] = await Promise.all([
    admin.from('users').select('id, full_name, email, created_at, tenant_id, tenants(name)').eq('id', studentId).single(),
    readAll<Membership>((f, t, c) => admin.from('group_students')
      .select('group_id, joined_at, groups(id, name, deleted_at, users:teacher_id(full_name))', withCount(c))
      .eq('student_id', studentId).order('joined_at').order('group_id').range(f, t)),
  ])
  const student = subjectRow(studentRes, 'student')
  if (!student) return null
  const activeGroups = memberships.filter(m => m.groups && !m.groups.deleted_at)
  const groupIds = activeGroups.map(m => m.group_id)
  const [exams, readSubs] = groupIds.length
    ? await Promise.all([
        readAll<ReportExam>((f, t, c) => admin.from('exams').select(STUDENT_EXAM_COLUMNS, withCount(c))
          .in('group_id', groupIds).eq('is_published', true).is('deleted_at', null).order('created_at', { ascending: true }).order('id').range(f, t)),
        // Every submission to those exams: the student's own are among them (read once).
        readAllById<ReportSub>(after => admin.from('exam_submissions').select(STUDENT_SUB_COLUMNS)
          .in('exams.group_id', groupIds).eq('exams.is_published', true).is('exams.deleted_at', null).gt('id', after).order('id').limit(PAGE_SIZE),
        () => admin.from('exam_submissions').select(STUDENT_SUB_COLUMNS, { count: 'exact', head: true })
          .in('exams.group_id', groupIds).eq('exams.is_published', true).is('exams.deleted_at', null)),
      ])
    : [[] as ReportExam[], [] as ReportSub[]]
  const peerSubs = await withFallbackMax(admin, readSubs, exams.map(e => e.id))
  return {
    student: student as unknown as Person & { created_at: string; tenants: { name: string } | null },
    activeGroups: activeGroups as (Membership & { groups: NonNullable<Membership['groups']> })[],
    exams, peerSubs, ownSubs: peerSubs.filter(s => s.student_id === studentId),
  }
}
