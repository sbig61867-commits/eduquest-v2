import type { ApiErrorCode } from '@/lib/api-error'
import { SECTION_SHIFTS, cleanText, isUuid, type Parsed, type SectionShift } from '@/lib/school-structure'

// School subjects, subject teachers, the bell schedule and section timetables
// (part 2 of the school structure): the shapes and the input rules every
// /api/school/{subjects,periods,timetable} write applies before it reaches the
// database, plus the small pure helpers the timetable grid uses. Pure on
// purpose: the admin page imports it in the browser. The database enforces the
// same rules (neon/migrations/0014_school_subjects_timetable.sql); this is the
// precise, translated refusal in front of it.
// Design: docs/claude/tasks/school-structure-plan.md (part 2)

/** A subject's colour is a NAME from this fixed token palette (design-tokens.css), never a hex value. */
export const SUBJECT_COLOURS = ['neutral', 'accent', 'info', 'success', 'warning', 'danger'] as const
export const PERIOD_KINDS = ['lesson', 'break'] as const
export const CURRICULUM_KINDS = ['subject', 'gradeSubject'] as const

export type SubjectColour = (typeof SUBJECT_COLOURS)[number]
export type PeriodKind = (typeof PERIOD_KINDS)[number]

/** Upper bounds for every list the screens read and every write that adds a row (perf contract P1). */
export const TIMETABLE_LIMITS = {
  subjects: 200,
  gradeSubjects: 3000,
  periods: 60,
  periodsPerShift: 20,
  weeklySessionsMax: 40,
  /** Cells of one section timetable: 7 days × 20 periods. */
  cells: 140,
  /** Other periods of the section's teachers in the same year, for the inline clash hints. */
  busy: 1000,
  /** One teacher's own periods across sections («جدولي»). */
  teacherPeriods: 300,
} as const

export const SUBJECT_NAME_MAX = 120
export const SUBJECT_CODE_MAX = 30
export const PERIOD_NAME_MAX = 60

/** School days shown by default (Sunday–Thursday, 0 = Sunday as in schedule_slots); a day with cells is always shown. */
export const DEFAULT_SCHOOL_DAYS = [0, 1, 2, 3, 4] as const

export interface SchoolSubject { id: string; name: string; code: string; colour: SubjectColour | null; sort_order: number }
export interface GradeSubject { grade_id: string; subject_id: string; weekly_sessions: number }
export interface SchoolPeriod { id: string; shift: SectionShift | null; kind: PeriodKind; name: string | null; starts_at: string; ends_at: string }

/** The catalogue /admin/school reads: subjects, grade links, bell schedule. */
export interface SchoolCurriculum {
  subjects: SchoolSubject[]
  gradeSubjects: GradeSubject[]
  periods: SchoolPeriod[]
}

export interface SubjectTeacher { subject_id: string; teacher_id: string; teacher_name: string | null }
export interface TimetableCell { id: string; day: number; period_id: string; subject_id: string; teacher_id: string | null }
/** Another period of one of the section's teachers, in another (or this) section of the same year. */
export interface BusyPeriod { teacher_id: string; day: number; starts_at: string; ends_at: string; section_id: string; section_name: string }

export interface SectionTimetable {
  section: { id: string; name: string; grade_id: string; year_id: string; shift: SectionShift | null; is_active: boolean }
  schedule: { id: string; is_published: boolean } | null
  cells: TimetableCell[]
  teachers: SubjectTeacher[]
  busy: BusyPeriod[]
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/

/** 'HH:MM' (seconds dropped) or null. */
export function cleanTime(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const m = TIME_RE.exec(v.trim())
  return m ? `${m[1]}:${m[2]}` : null
}

/** '08:00:00' → '08:00' (the database returns time with seconds). */
export const hhmm = (t: string) => (typeof t === 'string' ? t.slice(0, 5) : '')

function oneOf<T extends string>(list: readonly T[], v: unknown): v is T {
  return typeof v === 'string' && (list as readonly string[]).includes(v)
}

function optionalOneOf<T extends string>(list: readonly T[], v: unknown): T | null | undefined {
  if (v === null || v === '') return null
  return oneOf(list, v) ? v : undefined
}

type Body = Record<string, unknown>
const has = (b: Body, k: string) => b[k] !== undefined
const fail = (code: ApiErrorCode) => ({ ok: false as const, code })

export function isCurriculumKind(v: unknown): v is (typeof CURRICULUM_KINDS)[number] {
  return oneOf(CURRICULUM_KINDS, v)
}

// ── subjects ────────────────────────────────────────────────────────────────

export interface SubjectInput { name?: string; code?: string; colour?: SubjectColour | null }

export function parseSubject(b: Body, mode: 'create' | 'update'): Parsed<SubjectInput> {
  const out: SubjectInput = {}
  if (mode === 'create' || has(b, 'name')) {
    const name = cleanText(b.name, SUBJECT_NAME_MAX)
    if (!name) return fail('nameRequired120')
    out.name = name
  }
  if (mode === 'create' || has(b, 'code')) {
    const code = typeof b.code === 'string' ? b.code.trim() : ''
    if (!code) return fail('subjectCodeRequired')
    if (code.length > SUBJECT_CODE_MAX) return fail('codeTooLong')
    out.code = code
  }
  if (has(b, 'colour')) {
    const colour = optionalOneOf(SUBJECT_COLOURS, b.colour)
    if (colour === undefined) return fail('invalidColour')
    out.colour = colour
  }
  if (mode === 'update' && Object.keys(out).length === 0) return fail('nothingToUpdate')
  return { ok: true, value: out }
}

// ── grade ↔ subject ──────────────────────────────────────────────────────────

export interface GradeSubjectInput { grade_id: string; subject_id: string; weekly_sessions: number }

/** weekly_sessions 0 / null / '' means "not taught in this grade" (unlink) — returned as 0. */
export function parseGradeSubject(b: Body): Parsed<GradeSubjectInput> {
  if (!isUuid(b.grade_id)) return fail('gradeNotFound')
  if (!isUuid(b.subject_id)) return fail('subjectNotFound')
  const raw = b.weekly_sessions === null || b.weekly_sessions === '' ? 0 : b.weekly_sessions
  if (!Number.isInteger(raw) || (raw as number) < 0 || (raw as number) > TIMETABLE_LIMITS.weeklySessionsMax) {
    return fail('weeklySessionsInvalid')
  }
  return { ok: true, value: { grade_id: b.grade_id.toLowerCase(), subject_id: b.subject_id.toLowerCase(), weekly_sessions: raw as number } }
}

// ── bell schedule ────────────────────────────────────────────────────────────

export interface PeriodInput { shift?: SectionShift | null; kind?: PeriodKind; name?: string | null; starts_at?: string; ends_at?: string }

export function parsePeriod(b: Body, mode: 'create' | 'update'): Parsed<PeriodInput> {
  const out: PeriodInput = {}
  if (mode === 'create' || has(b, 'period_kind')) {
    // the body's `kind` is not used here; the period's own type travels as `period_kind`
    const kind = b.period_kind === undefined && mode === 'create' ? 'lesson' : b.period_kind
    if (!oneOf(PERIOD_KINDS, kind)) return fail('periodKindInvalid')
    out.kind = kind
  }
  if (mode === 'create' || has(b, 'shift')) {
    const shift = b.shift === undefined ? null : optionalOneOf(SECTION_SHIFTS, b.shift)
    if (shift === undefined) return fail('invalidShift')
    out.shift = shift
  }
  if (has(b, 'name')) {
    if (b.name === null || b.name === '' || (typeof b.name === 'string' && !b.name.trim())) out.name = null
    else {
      const name = cleanText(b.name, PERIOD_NAME_MAX)
      if (!name) return fail('periodNameInvalid')
      out.name = name
    }
  }
  if (mode === 'create' || has(b, 'starts_at')) {
    const t = cleanTime(b.starts_at)
    if (!t) return fail('invalidStartTime')
    out.starts_at = t
  }
  if (mode === 'create' || has(b, 'ends_at')) {
    const t = cleanTime(b.ends_at)
    if (!t) return fail('invalidEndTime')
    out.ends_at = t
  }
  if (out.starts_at && out.ends_at && out.ends_at <= out.starts_at) return fail('endTimeBeforeStart')
  if (mode === 'update' && Object.keys(out).length === 0) return fail('nothingToUpdate')
  return { ok: true, value: out }
}

/** Do two [start, end) time ranges ('HH:MM' or 'HH:MM:SS') overlap? */
export function overlaps(a: { starts_at: string; ends_at: string }, b: { starts_at: string; ends_at: string }): boolean {
  return hhmm(a.starts_at) < hhmm(b.ends_at) && hhmm(b.starts_at) < hhmm(a.ends_at)
}

/**
 * The bell schedule a section follows: the periods of its shift when the school
 * defined any for that shift, otherwise the general ones (shift NULL). Ordered by time.
 */
export function periodsForShift(periods: SchoolPeriod[], shift: SectionShift | null): SchoolPeriod[] {
  const own = shift ? periods.filter(p => p.shift === shift) : []
  const list = own.length ? own : periods.filter(p => p.shift === null)
  return [...list].sort((a, b) => a.starts_at.localeCompare(b.starts_at) || a.id.localeCompare(b.id))
}

/** Lesson number of each lesson period (breaks are not counted), by id. */
export function lessonNumbers(periods: SchoolPeriod[]): Map<string, number> {
  const out = new Map<string, number>()
  let n = 0
  for (const p of periods) if (p.kind === 'lesson') out.set(p.id, ++n)
  return out
}

// ── timetable cells and subject teachers ────────────────────────────────────

export interface CellInput { section_id: string; day: number; period_id: string; subject_id: string | null }

/** subject_id null = clear the cell (DELETE). */
export function parseCell(b: Body, clearing: boolean): Parsed<CellInput> {
  if (!isUuid(b.section_id)) return fail('sectionNotFound')
  if (!Number.isInteger(b.day) || (b.day as number) < 0 || (b.day as number) > 6) return fail('invalidDay')
  if (!isUuid(b.period_id)) return fail('periodNotFound')
  if (clearing) return { ok: true, value: { section_id: b.section_id.toLowerCase(), day: b.day as number, period_id: b.period_id.toLowerCase(), subject_id: null } }
  if (!isUuid(b.subject_id)) return fail('subjectNotFound')
  return {
    ok: true,
    value: { section_id: b.section_id.toLowerCase(), day: b.day as number, period_id: b.period_id.toLowerCase(), subject_id: b.subject_id.toLowerCase() },
  }
}

export interface SubjectTeacherInput { section_id: string; subject_id: string; teacher_id: string | null }

/** teacher_id null = no teacher for this subject in this section (soft-deletes the assignment). */
export function parseSubjectTeacher(b: Body): Parsed<SubjectTeacherInput> {
  if (!isUuid(b.section_id)) return fail('sectionNotFound')
  if (!isUuid(b.subject_id)) return fail('subjectNotFound')
  if (b.teacher_id === null || b.teacher_id === '') {
    return { ok: true, value: { section_id: b.section_id.toLowerCase(), subject_id: b.subject_id.toLowerCase(), teacher_id: null } }
  }
  if (!isUuid(b.teacher_id)) return fail('teacherNotInTenant')
  return { ok: true, value: { section_id: b.section_id.toLowerCase(), subject_id: b.subject_id.toLowerCase(), teacher_id: b.teacher_id.toLowerCase() } }
}

/** How many cells each subject has in the section's week. */
export function weeklyCounts(cells: Pick<TimetableCell, 'subject_id'>[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const c of cells) out.set(c.subject_id, (out.get(c.subject_id) ?? 0) + 1)
  return out
}

/** 'under' / 'met' / 'over' the grade's weekly sessions (the soft warning in the grid). */
export function weeklyStatus(count: number, target: number): 'under' | 'met' | 'over' {
  return count > target ? 'over' : count === target ? 'met' : 'under'
}

/**
 * Where else this teacher is at that day and time (another cell of the same
 * academic year), or null. `exceptCellId` is the cell being replaced.
 */
export function teacherClash(
  busy: BusyPeriod[],
  teacherId: string | null | undefined,
  day: number,
  period: { starts_at: string; ends_at: string },
  sectionId: string,
): BusyPeriod | null {
  if (!teacherId) return null
  return busy.find(b => b.teacher_id === teacherId && b.day === day && b.section_id !== sectionId && overlaps(b, period)) ?? null
}
