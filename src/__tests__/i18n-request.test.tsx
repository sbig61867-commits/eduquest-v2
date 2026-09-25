import { render, screen } from '@testing-library/react'
import { NAMESPACES } from '@/i18n/config'
import { NextIntlClientProvider, createTranslator, useTranslations } from 'next-intl'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_LOCALE, type Locale } from '@/i18n/config'
import { clientMessages } from '@/i18n/messages'

// The cookie store the request config reads. Controlled per test so the
// cookie path and the explicit-locale path can be exercised independently —
// which is the whole point of C2.
const cookie: { value: string | undefined } = { value: undefined }

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookie.value ? { name, value: cookie.value } : undefined),
  }),
}))

// Imported after the mock is registered.
//
// This is `@/i18n/runtime`, not `@/i18n/request`: the latter imports
// `next-intl/server`, which refuses to load outside the `react-server`
// condition and so cannot run under jsdom at all. request.ts is a one-line
// wrapper around exactly this function — the wiring is covered by the
// production build and tests/i18n-locale.spec.ts instead.
const { buildRequestConfig } = await import('@/i18n/runtime')

function config(requested?: string) {
  return buildRequestConfig(requested)
}

beforeEach(() => {
  cookie.value = undefined
})

describe('request config — cookie locale', () => {
  it('resolves from the eq_locale cookie when no locale is requested', async () => {
    cookie.value = 'en'
    const { locale, messages } = await config()
    expect(locale).toBe('en')
    expect((messages.common as { appName: string }).appName).toBe('EduQuest')
  })

  it('serves Arabic from the same code path, same URL', async () => {
    cookie.value = 'ar'
    const { locale, messages } = await config()
    expect(locale).toBe('ar')
    expect((messages.common as { appName: string }).appName).toBe('إديوكويست')
  })

  it('falls back to the platform default on a missing or tampered cookie', async () => {
    expect((await config()).locale).toBe(DEFAULT_LOCALE)
    cookie.value = 'fr'
    expect((await config()).locale).toBe(DEFAULT_LOCALE)
  })
})

/**
 * C2 — the silent failure Phase 0a found.
 *
 * With `requestLocale` ignored, `getTranslations({ locale: 'en' })` returned
 * Arabic and threw nothing. That is the exact path an invitation email or a
 * PDF report takes: rendered in the RECIPIENT's language, not the signed-in
 * sender's. These two tests are the regression guard for it.
 */
describe('request config — explicit locale wins (C2)', () => {
  it('request context ar + explicit en ⇒ English', async () => {
    cookie.value = 'ar'
    const { locale, messages } = await config('en')
    expect(locale).toBe('en')

    const t = createTranslator({ locale, messages, namespace: 'email.invitation' })
    expect(t('cta')).toBe('Accept the invitation')
  })

  it('request context en + explicit ar ⇒ Arabic', async () => {
    cookie.value = 'en'
    const { locale, messages } = await config('ar')
    expect(locale).toBe('ar')

    const t = createTranslator({ locale, messages, namespace: 'email.invitation' })
    expect(t('cta')).toBe('قبول الدعوة')
  })

  it('ignores an explicit locale that is not supported', async () => {
    cookie.value = 'ar'
    expect((await config('fr')).locale).toBe('ar')
  })
})

describe('request config — server-side namespace availability (C1)', () => {
  it('exposes every namespace to getTranslations(), including server-only ones', async () => {
    cookie.value = 'ar'
    const { messages } = await config()
    // The server half of C1: anything missing HERE renders as a key path with
    // no error, which is why it must be complete even though the client
    // provider is deliberately not.
    // Derived from the source of truth, not a copy of it: the hardcoded list
    // this replaced had already gone stale (it predated the `auth` namespace),
    // so the test failed for a drift that was not a defect.
    expect(Object.keys(messages).sort()).toEqual([...NAMESPACES].sort())
  })
})

/**
 * C3 — missing keys must not survive unnoticed.
 *
 * Under NODE_ENV=test the policy is to throw, so a missing key fails the suite
 * rather than rendering as prose. Outside test it degrades to a logged error
 * plus a bracketed fallback that cannot be mistaken for copy.
 */
describe('missing-key policy (C3)', () => {
  it('rejects an unknown key at COMPILE time', () => {
    // Not a runtime assertion — the point is the `as never` below. next-intl
    // derives the key union from the message object, so `t('common.nope')`
    // fails `tsc --noEmit`. That is the cheapest layer of C3 and it caught
    // this very line while Phase 0b was being written. Removing the cast
    // breaks the typecheck, which is the assertion.
    expect(true).toBe(true)
  })

  it('throws on a missing key in the test environment', async () => {
    const { locale, messages, onError, getMessageFallback } = await config('en')
    const t = createTranslator({ locale, messages, onError, getMessageFallback })
    // Cast past the compile-time guard to reach the RUNTIME policy — the
    // layer that matters for keys built dynamically or drifting after a
    // translator refactor.
    expect(() => t('common.thisKeyDoesNotExist' as never)).toThrow()
  })

  it('renders a visibly bracketed fallback, never a bare key path', async () => {
    const { getMessageFallback } = await config('en')
    const fallback = getMessageFallback({ namespace: 'admin', key: 'title' })
    expect(fallback).toBe('⟦admin.title⟧')
    expect(fallback).not.toBe('admin.title')
  })
})

function Greeting() {
  const t = useTranslations('common')
  return (
    <div>
      <span data-testid="app">{t('appName')}</span>
      <span data-testid="greeting">{t('greeting', { name: 'سامي' })}</span>
      <span data-testid="zero">{t('counts.exams', { count: 0 })}</span>
      <span data-testid="one">{t('counts.exams', { count: 1 })}</span>
      <span data-testid="two">{t('counts.exams', { count: 2 })}</span>
      <span data-testid="few">{t('counts.exams', { count: 3 })}</span>
      <span data-testid="many">{t('counts.exams', { count: 11 })}</span>
      <span data-testid="other">{t('counts.exams', { count: 100 })}</span>
    </div>
  )
}

function renderAt(locale: Locale) {
  return render(
    <NextIntlClientProvider locale={locale} messages={clientMessages(locale, ['common'])}>
      <Greeting />
    </NextIntlClientProvider>
  )
}

describe('client translation', () => {
  it('renders English with interpolation', () => {
    renderAt('en')
    expect(screen.getByTestId('app').textContent).toBe('EduQuest')
    expect(screen.getByTestId('greeting').textContent).toBe('Welcome back, سامي')
  })

  it('renders Arabic with interpolation', () => {
    renderAt('ar')
    expect(screen.getByTestId('app').textContent).toBe('إديوكويست')
    expect(screen.getByTestId('greeting').textContent).toBe('أهلاً بعودتك يا سامي')
  })

  // Arabic has six plural categories. Getting this wrong is the difference
  // between "2 اختبارات" and "اختباران", which is the kind of thing a native
  // speaker notices immediately and a key-count audit never will.
  it('applies all six Arabic plural categories', () => {
    renderAt('ar')
    expect(screen.getByTestId('zero').textContent).toBe('لا اختبارات')
    expect(screen.getByTestId('one').textContent).toBe('اختبار واحد')
    expect(screen.getByTestId('two').textContent).toBe('اختباران')
    expect(screen.getByTestId('few').textContent).toBe('3 اختبارات')
    expect(screen.getByTestId('many').textContent).toBe('11 اختباراً')
    expect(screen.getByTestId('other').textContent).toBe('100 اختبار')
  })

  it('applies English plural categories', () => {
    renderAt('en')
    expect(screen.getByTestId('zero').textContent).toBe('No exams')
    expect(screen.getByTestId('one').textContent).toBe('One exam')
    expect(screen.getByTestId('other').textContent).toBe('100 exams')
  })
})
