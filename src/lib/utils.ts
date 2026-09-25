import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { Role } from '@/types'
import { getTerms } from '@/lib/terminology'
import { DEFAULT_LOCALE, type Locale } from '@/i18n/config'
import { roleLabels as arRoles } from '@/content/terminology/ar'
import { roleLabels as enRoles } from '@/content/terminology/en'
import type { RoleLabels } from '@/content/terminology/types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getRoleDashboardPath(role: Role): string {
  const paths: Record<Role, string> = {
    super_admin: '/super-admin/dashboard',
    university_admin: '/admin/dashboard',
    center_manager: '/center/dashboard',
    teacher: '/teacher/dashboard',
    student: '/student/dashboard',
  }
  return paths[role]
}

// Two axes meet here: `institutionType` picks the tenant's word for the
// university_admin role (see src/lib/terminology.ts), `locale` picks the
// language. Both default so unmigrated callers keep today's wording; inside
// MIGRATED_DIRS the locale is mandatory, enforced by the ratchet in
// src/__tests__/i18n-no-hardcoded-strings.test.ts. The labels themselves live
// per language in src/content/terminology/{ar,en}.ts.
const ROLE_LABELS: Record<Locale, RoleLabels> = { ar: arRoles, en: enRoles }

export function getRoleLabel(
  role: Role,
  institutionType?: string | null,
  locale: Locale = DEFAULT_LOCALE,
): string {
  if (role === 'university_admin') return getTerms(institutionType, locale).institutionAdmin
  return ROLE_LABELS[locale][role]
}

// Each locale is pinned to an explicit extension sequence rather than the bare
// tag: a bare 'ar' resolves per environment, and ar-EG / ar-SA render
// Arabic-Indic digits (١٥) — and on some ICU builds the Islamic calendar —
// which would make dates disagree with the Latin numerals used everywhere else
// in the UI. -ca-gregory-nu-latn fixes both regardless of host.
const DATE_LOCALE: Record<Locale, string> = {
  ar: 'ar-u-ca-gregory-nu-latn',
  en: 'en-u-ca-gregory-nu-latn',
}

// The `locale` default exists only for the unmigrated i18n backlog, whose pages
// are still Arabic top to bottom — an Arabic date there is consistent, not
// mixed. Inside MIGRATED_DIRS the argument is mandatory, enforced by the
// ratchet in src/__tests__/i18n-no-hardcoded-strings.test.ts, because there a
// pinned Arabic month is exactly the half-Arabic/half-English leak the
// extraction exists to remove.
export function formatDate(dateString: string, locale: Locale = DEFAULT_LOCALE): string {
  return new Intl.DateTimeFormat(DATE_LOCALE[locale], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(dateString))
}

export function formatDateTime(dateString: string, locale: Locale = DEFAULT_LOCALE): string {
  return new Intl.DateTimeFormat(DATE_LOCALE[locale], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(dateString))
}

/**
 * Stops one failed Supabase query from taking a whole page down.
 *
 * Server components across the app fan out with `Promise.all([...])` and then
 * destructure `{ data }` / `{ count }` straight out of the result. `Promise.all`
 * rejects the moment any one query rejects — a cold start or a network blip
 * against Supabase then throws out of the server component and the user gets the
 * error boundary instead of the page, even when every other query succeeded.
 *
 * Wrapping a query in `settle()` makes it resolve with an empty result and log
 * the reason instead of rejecting, so the existing `?? []` and `?? 0` fallbacks
 * downstream do their job and the page renders with the parts that did load.
 */
export async function settle<T extends { data?: unknown; count?: number | null; error?: unknown }>(
  query: PromiseLike<T>,
  label: string
): Promise<T> {
  try {
    const result = await query
    if (result?.error) console.error(`[settle:${label}]`, result.error)
    return result
  } catch (cause) {
    console.error(`[settle:${label}] threw`, cause)
    return { data: null, count: null, error: cause } as unknown as T
  }
}
