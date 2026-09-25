import { getTranslations } from 'next-intl/server'
import type en from '@/messages/en/errors.json'

export type ApiErrorCode = keyof typeof en

/**
 * The error body every API route returns: `{ error, code }`.
 *
 * `error` is the message in the caller's language — resolved from the same
 * `eq_locale` cookie the pages render from — so the UI can keep showing
 * `data.error` as it always has and an English user no longer gets an Arabic
 * toast. `code` is the stable, language-free identifier for anything that has
 * to branch on the failure (tests, retries, analytics) instead of matching
 * message text, which changes with the language.
 *
 * Used as a spread so the rest of the response is untouched:
 *   NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
 */
export async function apiErr(
  code: ApiErrorCode,
  params?: Record<string, string | number>,
): Promise<{ error: string; code: ApiErrorCode }> {
  const t = await getTranslations('errors')
  return { error: t(code, params), code }
}
