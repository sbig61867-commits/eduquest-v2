/**
 * A student's four-part name: first · father · grandfather · family.
 *
 * Students register with their real name in four separate parts. Only the
 * student sees all four: the parts live in `student_names` (readable by that
 * student alone), while `users.full_name` (the column every other page, report
 * and export reads) carries just the first and family name, so teachers and
 * staff never receive the middle names (src/lib/student-names.ts).
 *
 * This is the single rule set: the forms use it for live feedback, and every
 * route that writes a student's name re-checks it, because the server never
 * trusts the browser's check. Only the SHAPE can be enforced (four parts,
 * letters only, one script, sane lengths); a registered student can no longer
 * change it, only the institution can (supabase/student_name_lock_migration.sql,
 * /api/admin/student-name).
 */

export const NAME_PARTS = ['first', 'father', 'grandfather', 'family'] as const
export type NamePart = (typeof NAME_PARTS)[number]
export type NameParts = Record<NamePart, string>

export const EMPTY_NAME_PARTS: NameParts = { first: '', father: '', grandfather: '', family: '' }

export const NAME_PART_MIN_LETTERS = 2
export const NAME_PART_MAX_LENGTH = 30

export type NameError = 'required' | 'tooShort' | 'tooLong' | 'invalidChars' | 'repeated' | 'mixedScripts'
export type NameErrors = Partial<Record<NamePart, NameError>>

/**
 * Carries the four parts across the Google OAuth round trip of a student
 * invitation (join form → Google → /auth/callback), scoped to the callback
 * path and short-lived. The callback validates it like any other input.
 */
export const JOIN_NAME_COOKIE = 'eq_join_name'

// Invisible characters that ride along with pasted text: zero-width, bidi
// controls, word joiners, BOM, plus the Arabic tatweel (a stretch, not a letter).
const INVISIBLE = /[​-‏‪-‮⁠-⁩﻿ـ]/g
// Letters (with combining marks such as harakat), several words allowed inside
// one part when joined by a single space, hyphen or apostrophe: a compound
// first name, "Al-Hassan", "O'Neil".
const PART_RE = /^[\p{L}\p{M}]+(?:[ '’-][\p{L}\p{M}]+)*$/u
const LETTER = /\p{L}/gu
const ARABIC_LETTER = /\p{Script=Arabic}/u
const LATIN_LETTER = /\p{Script=Latin}/u

type Script = 'arabic' | 'latin'

export function normalizeNamePart(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw.normalize('NFC').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim()
}

/** Arabic or Latin; null when the part mixes them or uses any other script. */
function scriptOf(letters: string[]): Script | null {
  if (letters.length === 0) return null
  if (letters.every(c => ARABIC_LETTER.test(c))) return 'arabic'
  if (letters.every(c => LATIN_LETTER.test(c))) return 'latin'
  return null
}

/** The problem with one part on its own, or null when it is acceptable. */
export function namePartError(raw: unknown): NameError | null {
  const part = normalizeNamePart(raw)
  if (!part) return 'required'
  if (part.length > NAME_PART_MAX_LENGTH) return 'tooLong'
  if (!PART_RE.test(part)) return 'invalidChars'
  const letters = part.match(LETTER) ?? []
  if (!scriptOf(letters)) return 'invalidChars'
  if (letters.length < NAME_PART_MIN_LETTERS) return 'tooShort'
  // "ااا", "xx": one letter repeated is never a name.
  if (new Set(letters.map(c => c.toLowerCase())).size === 1) return 'repeated'
  return null
}

export type NameCheck =
  | { ok: true; parts: NameParts; fullName: string; shortName: string }
  | { ok: false; errors: NameErrors }

/** All four parts: what the student themself sees. */
export function fourPartName(parts: NameParts): string {
  return NAME_PARTS.map(k => parts[k]).join(' ')
}

/** First and family name: what everyone else sees (`users.full_name`). */
export function shortStudentName(parts: NameParts): string {
  return `${parts.first} ${parts.family}`
}

/**
 * Validate `{ first, father, grandfather, family }` from any source. On success
 * returns the normalized parts, the four-part name and the short name.
 */
export function checkNameParts(input: unknown): NameCheck {
  const source = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const parts = { ...EMPTY_NAME_PARTS }
  const errors: NameErrors = {}
  let script: Script | null = null

  for (const key of NAME_PARTS) {
    parts[key] = normalizeNamePart(source[key])
    const error = namePartError(parts[key])
    if (error) { errors[key] = error; continue }
    // All four parts in one language, so a list sorts and reads consistently.
    const own = scriptOf(parts[key].match(LETTER) ?? [])
    if (script === null) script = own
    else if (own !== script) errors[key] = 'mixedScripts'
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return { ok: true, parts, fullName: fourPartName(parts), shortName: shortStudentName(parts) }
}
