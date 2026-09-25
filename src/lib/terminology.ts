import type { InstitutionType } from '@/types'
import { DEFAULT_LOCALE, type Locale } from '@/i18n/config'
import { institutionTerms as arTerms } from '@/content/terminology/ar'
import { institutionTerms as enTerms } from '@/content/terminology/en'

// UI vocabulary per institution type. The database keeps its original names
// (university_admin, groups, …) because they are baked into RLS policies and
// JWT claims — only what the user reads changes. A missing/unknown type falls
// back to 'university', which reproduces the app's pre-existing wording.
//
// ── Boundary with i18n (established in Phase 0b, not yet implemented) ──
//
// Terminology and translation are different axes and must not be merged:
//
//   translation  — the same concept, said in another language.
//                  Lives in src/messages/<locale>/*.json, keyed by meaning.
//                  Varies by LOCALE.
//   terminology  — a different concept word for the same underlying entity,
//                  chosen per institution: a `group` is a فصل in a school, a
//                  دفعة in a training centre, a فريق in a company.
//                  Varies by TENANT (tenants.institution_type).
//
// Collapsing them would multiply the message files by five institution types
// and make every tenant-wording change a translation change. So the target
// shape is a locale-keyed overlay — `Record<Locale, Record<InstitutionType,
// Terms>>` — resolved ON TOP of the `terms` message namespace
// (src/messages/<locale>/terms.json), which holds the neutral defaults.
//
// ── Converted (i18n Phase 0) ──
//
// The table below IS that locale-keyed overlay. Before this, the interface
// carried a single set of fields plus `*Ar` duplicates, and an earlier
// Arabic pass had rewritten the base fields to Arabic too — so both halves
// said the same thing and the English wording was gone, not merely unused.
// Switching the locale could not have changed tenant vocabulary at all.
//
// `getTerms(type, locale)` now takes the locale explicitly. It defaults to
// DEFAULT_LOCALE so the 45 existing call sites keep rendering exactly what
// they render today; each one starts passing a real locale as its screen is
// migrated.

export const INSTITUTION_TYPES: InstitutionType[] = [
  'university', 'school', 'institute', 'training_center', 'company',
]

export interface Terms {
  institutionTypeLabel: string
  institution: string        // e.g. "University" (see src/content/terminology)
  institutionAdmin: string   // role label for university_admin
  group: string
  groups: string
  unitL1: string             // top level of the academic structure
  unitsL1: string
  unitL2: string             // second level
  unitsL2: string
  term: string               // academic period
  terms: string
  institutionStudent: string  // singular
  institutionStudents: string // plural
}

// The per-language tables live in src/content/terminology/{ar,en}.ts.
const TERMS: Record<Locale, Record<InstitutionType, Terms>> = { ar: arTerms, en: enTerms }

export function isInstitutionType(value: unknown): value is InstitutionType {
  return typeof value === 'string' && (INSTITUTION_TYPES as string[]).includes(value)
}

/**
 * Tenant vocabulary for a locale.
 *
 * `locale` defaults to the platform default so pre-migration call sites keep
 * their current output; pass the real locale (`useLocale()` on the client,
 * `getLocale()` on the server) when migrating a screen.
 */
export function getTerms(type?: string | null, locale: Locale = DEFAULT_LOCALE): Terms {
  return TERMS[locale][isInstitutionType(type) ? type : 'university']
}
