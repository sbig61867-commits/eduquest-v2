import type { ApiErrorCode } from '@/lib/api-error'

// School structure (stages → grades → sections, academic years with terms,
// placement): the shapes and the input rules every /api/school/* write
// applies before it reaches the database. Pure on purpose: the admin page
// imports the constants in the browser. The database enforces the same rules
// (neon/migrations/0013_school_structure.sql); this is the precise, translated
// refusal in front of it. Design: docs/claude/tasks/school-structure-plan.md

export const STAGE_KINDS = ['kindergarten', 'basic', 'secondary'] as const
export const GRADE_TRACKS = ['general', 'scientific', 'literary'] as const
export const SECTION_SHIFTS = ['morning', 'evening'] as const
export const STRUCTURE_KINDS = ['stage', 'grade', 'section', 'year', 'term'] as const

export type StageKind = (typeof STAGE_KINDS)[number]
export type GradeTrack = (typeof GRADE_TRACKS)[number]
export type SectionShift = (typeof SECTION_SHIFTS)[number]
export type StructureKind = (typeof STRUCTURE_KINDS)[number]

/** Upper bounds for every list the page reads and every write that adds a row (perf contract P1). */
export const SCHOOL_LIMITS = {
  stages: 50,
  grades: 300,
  years: 50,
  terms: 200,
  termsPerYear: 4,
  sections: 1000,
  placementBatch: 100,
} as const

export const NAME_MAX = 120
export const CODE_MAX = 30
export const YEAR_NAME_MAX = 60
export const TERM_NAME_MAX = 60
export const SECTION_LABEL_MAX = 20
export const CAPACITY_MAX = 500

export interface SchoolStage { id: string; kind: StageKind; name: string; code: string | null; sort_order: number }
export interface SchoolGrade { id: string; stage_id: string; name: string; code: string | null; track: GradeTrack | null; sort_order: number }
export interface SchoolYear { id: string; name: string; starts_on: string; ends_on: string; is_active: boolean }
export interface SchoolTerm { id: string; year_id: string; term_no: number; name: string; starts_on: string; ends_on: string }
export interface SchoolSection {
  id: string
  grade_id: string
  label: string
  name: string
  shift: SectionShift | null
  capacity: number | null
  is_active: boolean
  section_order: number | null
  teacher_id: string | null
  teacher_name: string | null
  members: number
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; code: ApiErrorCode }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v)

export function isStructureKind(v: unknown): v is StructureKind {
  return typeof v === 'string' && (STRUCTURE_KINDS as readonly string[]).includes(v)
}

/** A real calendar date in YYYY-MM-DD form (2026-02-30 is refused). */
export function cleanDate(v: unknown): string | null {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return null
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : null
}

/** Trimmed text of 1..max characters, or null. */
export function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim().replace(/\s+/g, ' ')
  return s.length >= 1 && s.length <= max ? s : null
}

/** An optional code: null when cleared, undefined when invalid. */
export function cleanCode(v: unknown): string | null | undefined {
  if (v === null || v === '') return null
  if (typeof v !== 'string') return undefined
  const s = v.trim()
  if (!s) return null
  return s.length <= CODE_MAX ? s : undefined
}

function oneOf<T extends string>(list: readonly T[], v: unknown): v is T {
  return typeof v === 'string' && (list as readonly string[]).includes(v)
}

/** An optional enum value: null when cleared, undefined when invalid. */
function optionalOneOf<T extends string>(list: readonly T[], v: unknown): T | null | undefined {
  if (v === null || v === '') return null
  return oneOf(list, v) ? v : undefined
}

/** The name every existing group surface shows for a section: «الصف السابع أ». */
export function sectionDisplayName(gradeName: string, label: string): string {
  return `${gradeName.trim()} ${label.trim()}`.slice(0, 200)
}

/** Does a term lie inside its year? (dates compare as YYYY-MM-DD strings) */
export function termFitsYear(term: { starts_on: string; ends_on: string }, year: { starts_on: string; ends_on: string }): boolean {
  return term.starts_on >= year.starts_on && term.ends_on <= year.ends_on && term.ends_on > term.starts_on
}

type Body = Record<string, unknown>
const has = (b: Body, k: string) => b[k] !== undefined

// ── stages ──────────────────────────────────────────────────────────────────

// The body's `kind` names the structure item ('stage'), so the stage's own type travels as `stage_kind`.
export interface StageInput { kind?: StageKind; name?: string; code?: string | null }

export function parseStage(b: Body, mode: 'create' | 'update'): Parsed<StageInput> {
  const out: StageInput = {}
  if (mode === 'create' || has(b, 'stage_kind')) {
    if (!oneOf(STAGE_KINDS, b.stage_kind)) return { ok: false, code: 'invalidStageKind' }
    out.kind = b.stage_kind
  }
  if (mode === 'create' || has(b, 'name')) {
    const name = cleanText(b.name, NAME_MAX)
    if (!name) return { ok: false, code: 'nameRequired120' }
    out.name = name
  }
  if (has(b, 'code')) {
    const code = cleanCode(b.code)
    if (code === undefined) return { ok: false, code: 'codeTooLong' }
    out.code = code
  }
  if (mode === 'update' && Object.keys(out).length === 0) return { ok: false, code: 'nothingToUpdate' }
  return { ok: true, value: out }
}

// ── grades ──────────────────────────────────────────────────────────────────

export interface GradeInput { stage_id?: string; name?: string; code?: string | null; track?: GradeTrack | null }

export function parseGrade(b: Body, mode: 'create' | 'update'): Parsed<GradeInput> {
  const out: GradeInput = {}
  if (mode === 'create') {
    if (!isUuid(b.stage_id)) return { ok: false, code: 'stageNotFound' }
    out.stage_id = b.stage_id
  }
  if (mode === 'create' || has(b, 'name')) {
    const name = cleanText(b.name, NAME_MAX)
    if (!name) return { ok: false, code: 'nameRequired120' }
    out.name = name
  }
  if (has(b, 'code')) {
    const code = cleanCode(b.code)
    if (code === undefined) return { ok: false, code: 'codeTooLong' }
    out.code = code
  }
  if (has(b, 'track')) {
    const track = optionalOneOf(GRADE_TRACKS, b.track)
    if (track === undefined) return { ok: false, code: 'invalidTrack' }
    out.track = track
  }
  if (mode === 'update' && Object.keys(out).length === 0) return { ok: false, code: 'nothingToUpdate' }
  return { ok: true, value: out }
}

// ── sections (groups) ─────────────────────────────────────────────────────────

export interface SectionInput {
  grade_id?: string
  year_id?: string
  label?: string
  shift?: SectionShift | null
  capacity?: number | null
  teacher_id?: string | null
  is_active?: boolean
}

export function parseSection(b: Body, mode: 'create' | 'update'): Parsed<SectionInput> {
  const out: SectionInput = {}
  if (mode === 'create') {
    if (!isUuid(b.grade_id)) return { ok: false, code: 'gradeNotFound' }
    if (!isUuid(b.year_id)) return { ok: false, code: 'yearNotFound' }
    out.grade_id = b.grade_id
    out.year_id = b.year_id
  }
  if (mode === 'create' || has(b, 'label')) {
    const label = cleanText(b.label, SECTION_LABEL_MAX)
    if (!label) return { ok: false, code: 'sectionLabelInvalid' }
    out.label = label
  }
  if (has(b, 'shift')) {
    const shift = optionalOneOf(SECTION_SHIFTS, b.shift)
    if (shift === undefined) return { ok: false, code: 'invalidShift' }
    out.shift = shift
  }
  if (has(b, 'capacity')) {
    if (b.capacity === null || b.capacity === '') out.capacity = null
    else if (Number.isInteger(b.capacity) && (b.capacity as number) > 0 && (b.capacity as number) <= CAPACITY_MAX) out.capacity = b.capacity as number
    else return { ok: false, code: 'groupMaxStudentsInvalid' }
  }
  if (has(b, 'teacher_id')) {
    if (b.teacher_id === null || b.teacher_id === '') out.teacher_id = null
    else if (isUuid(b.teacher_id)) out.teacher_id = b.teacher_id
    else return { ok: false, code: 'teacherNotInTenant' }
  }
  if (mode === 'update' && has(b, 'is_active')) {
    if (typeof b.is_active !== 'boolean') return { ok: false, code: 'invalidData' }
    out.is_active = b.is_active
  }
  if (mode === 'update' && Object.keys(out).length === 0) return { ok: false, code: 'nothingToUpdate' }
  return { ok: true, value: out }
}

// ── academic years ────────────────────────────────────────────────────────────

export interface YearInput { name?: string; starts_on?: string; ends_on?: string; is_active?: boolean }

export function parseYear(b: Body, mode: 'create' | 'update'): Parsed<YearInput> {
  const out: YearInput = {}
  if (mode === 'create' || has(b, 'name')) {
    const name = cleanText(b.name, YEAR_NAME_MAX)
    if (!name) return { ok: false, code: 'yearNameInvalid' }
    out.name = name
  }
  for (const k of ['starts_on', 'ends_on'] as const) {
    if (mode === 'create' || has(b, k)) {
      const d = cleanDate(b[k])
      if (!d) return { ok: false, code: 'invalidDate' }
      out[k] = d
    }
  }
  if (out.starts_on && out.ends_on && out.ends_on <= out.starts_on) return { ok: false, code: 'endBeforeStart' }
  if (has(b, 'is_active')) {
    if (typeof b.is_active !== 'boolean') return { ok: false, code: 'invalidData' }
    out.is_active = b.is_active
  }
  if (mode === 'update' && Object.keys(out).length === 0) return { ok: false, code: 'nothingToUpdate' }
  return { ok: true, value: out }
}

// ── terms ─────────────────────────────────────────────────────────────────────

export interface TermInput { year_id?: string; term_no?: number; name?: string; starts_on?: string; ends_on?: string }

export function parseTerm(b: Body, mode: 'create' | 'update'): Parsed<TermInput> {
  const out: TermInput = {}
  if (mode === 'create') {
    if (!isUuid(b.year_id)) return { ok: false, code: 'yearNotFound' }
    out.year_id = b.year_id
  }
  if (mode === 'create' || has(b, 'term_no')) {
    if (!Number.isInteger(b.term_no) || (b.term_no as number) < 1 || (b.term_no as number) > SCHOOL_LIMITS.termsPerYear) {
      return { ok: false, code: 'termNumberInvalid' }
    }
    out.term_no = b.term_no as number
  }
  if (mode === 'create' || has(b, 'name')) {
    const name = cleanText(b.name, TERM_NAME_MAX)
    if (!name) return { ok: false, code: 'termNameInvalid' }
    out.name = name
  }
  for (const k of ['starts_on', 'ends_on'] as const) {
    if (mode === 'create' || has(b, k)) {
      const d = cleanDate(b[k])
      if (!d) return { ok: false, code: 'invalidDate' }
      out[k] = d
    }
  }
  if (out.starts_on && out.ends_on && out.ends_on <= out.starts_on) return { ok: false, code: 'endBeforeStart' }
  if (mode === 'update' && Object.keys(out).length === 0) return { ok: false, code: 'nothingToUpdate' }
  return { ok: true, value: out }
}

// ── order / placement ────────────────────────────────────────────────────────

/** The ids in their new order after moving `id` one step (-1 up, +1 down); null at an edge or when absent. */
export function moveInOrder(ids: string[], id: string, step: -1 | 1): string[] | null {
  const i = ids.indexOf(id)
  const j = i + step
  if (i < 0 || j < 0 || j >= ids.length) return null
  const next = [...ids]
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}

/** A full new order: distinct ids, at most `max`. */
export function parseOrder(v: unknown, max: number): Parsed<string[]> {
  if (!Array.isArray(v) || v.length === 0 || v.length > max) return { ok: false, code: 'invalidOrder' }
  if (!v.every(isUuid)) return { ok: false, code: 'invalidOrder' }
  const ids = v.map(x => (x as string).toLowerCase())
  if (new Set(ids).size !== ids.length) return { ok: false, code: 'invalidOrder' }
  return { ok: true, value: ids }
}

export interface PlacementInput { section_id: string; student_ids: string[] }

export function parsePlacement(b: Body): Parsed<PlacementInput> {
  if (!isUuid(b.section_id)) return { ok: false, code: 'sectionNotFound' }
  const raw = b.student_ids
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, code: 'invalidData' }
  if (raw.length > SCHOOL_LIMITS.placementBatch) return { ok: false, code: 'tooManyStudentsSelected' }
  if (!raw.every(isUuid)) return { ok: false, code: 'studentNotInTenant' }
  const ids = [...new Set(raw.map(x => (x as string).toLowerCase()))]
  return { ok: true, value: { section_id: b.section_id.toLowerCase(), student_ids: ids } }
}
