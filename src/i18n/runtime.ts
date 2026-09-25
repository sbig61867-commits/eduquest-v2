/**
 * The body of `getRequestConfig`, kept separate from it on purpose.
 *
 * `next-intl/server` resolves to a build that refuses to load outside the
 * `react-server` condition, so anything importing it is untestable under
 * jsdom. Everything that actually has behaviour worth guarding — C2's
 * precedence and C3's missing-key policy — therefore lives here, with
 * src/i18n/request.ts reduced to the one line that cannot be tested in
 * isolation anyway. See src/__tests__/i18n-request.test.tsx.
 */

import { IntlErrorCode } from 'next-intl'
import { cookies, headers } from 'next/headers'

import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, type Locale } from './config'
import { allMessages, type Messages } from './messages'
import { localeFromCookie } from './resolve'
import { LOCALE_HEADER } from './public-routes'

/**
 * C3 — missing-key policy.
 *
 * Phase 0a proved a missing key renders its own key path (`admin.sentinel`)
 * with no throw and no warning, in every environment. That is the failure mode
 * worth engineering against: it survives review, survives the build, and ships.
 *
 * Graduated rather than clever:
 *   test        → throw. A missing key fails the suite outright.
 *   development → console.error + a visibly bracketed fallback.
 *   production  → console.error (reaches the platform log) + the same bracket.
 *
 * The bracket is the point: `⟦admin.title⟧` cannot be mistaken for copy by
 * anyone looking at the screen, whereas `admin.title` can. Production does not
 * throw, because one missing string must never take a whole page down.
 *
 * The real prevention is upstream and static — the parity test in
 * src/__tests__/i18n-messages.test.ts asserts the `en` and `ar` key sets are
 * identical, so a key can only go missing if someone adds it to neither.
 */
export function onError(error: { code?: string; message?: string }): void {
  if (process.env.NODE_ENV === 'test') {
    throw error
  }
  if (error?.code === IntlErrorCode.MISSING_MESSAGE) {
    console.error('[i18n] missing message:', error.message)
  } else {
    console.error('[i18n]', error)
  }
}

export function getMessageFallback({
  namespace,
  key,
}: {
  namespace?: string
  key: string
}): string {
  return `⟦${[namespace, key].filter(Boolean).join('.')}⟧`
}

/**
 * C2 — an explicitly requested locale must win.
 *
 * Phase 0a proved that ignoring `requestLocale` breaks explicit-locale
 * rendering silently: `getTranslations({ locale: 'en' })` returned Arabic,
 * because the config had pinned the locale from the cookie. That is precisely
 * the path invitation emails and PDF/xlsx reports take — they render in the
 * RECIPIENT's language, not the signed-in sender's — so the bug would have
 * shipped as "the student got an Arabic email" long after this was written.
 *
 * Next comes a locale taken from the URL: a marketing page requested as
 * `/en/pricing` is rewritten by src/proxy.ts to `/pricing` with the locale on
 * LOCALE_HEADER. The URL must beat the cookie, or a shared English link would
 * open in Arabic for anyone whose cookie says `ar`.
 *
 * Steady state (no explicit locale) resolves from the `eq_locale` cookie
 * alone: no database round-trip. The cookie is established once, in
 * src/proxy.ts, from the user → tenant → platform chain.
 */
export async function resolveRequestLocale(requested?: string): Promise<Locale> {
  if (isLocale(requested)) return requested
  try {
    const fromUrl = (await headers()).get(LOCALE_HEADER)
    if (isLocale(fromUrl)) return fromUrl
  } catch {
    // Outside a request scope — fall through to the cookie.
  }
  try {
    const store = await cookies()
    return localeFromCookie(store.get(LOCALE_COOKIE)?.value)
  } catch {
    // Outside a request scope (a report built from a script, a unit test).
    // A missing cookie store is not an error condition.
    return DEFAULT_LOCALE
  }
}

export interface RequestConfig {
  locale: Locale
  messages: Messages
  onError: typeof onError
  getMessageFallback: typeof getMessageFallback
}

export async function buildRequestConfig(requested?: string): Promise<RequestConfig> {
  const locale = await resolveRequestLocale(requested)

  return {
    locale,
    // C1, server half: ALL namespaces, because `getTranslations()` on the
    // server reads from here and nothing else. What reaches the BROWSER is
    // decided separately, by `clientMessages()` at each provider — never here.
    messages: allMessages(locale),
    onError,
    getMessageFallback,
  }
}
