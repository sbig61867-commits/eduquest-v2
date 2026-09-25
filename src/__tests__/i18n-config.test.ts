import { describe, expect, it } from 'vitest'

import {
  CLIENT_NAMESPACES,
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_COOKIE,
  LOCALE_COOKIE_OPTIONS,
  NAMESPACES,
  SERVER_NAMESPACES,
  dirFor,
  isLocale,
  toLocale,
} from '@/i18n/config'
import { localeFromCookie, resolveLocale, resolveLocaleWithSource } from '@/i18n/resolve'

describe('supported locales', () => {
  it('supports exactly ar and en', () => {
    expect([...LOCALES].sort()).toEqual(['ar', 'en'])
  })

  it('has a default that is itself a supported locale', () => {
    expect(isLocale(DEFAULT_LOCALE)).toBe(true)
  })

  it('maps every locale to a direction', () => {
    for (const locale of LOCALES) {
      expect(['ltr', 'rtl']).toContain(dirFor(locale))
    }
  })
})

describe('locale validation', () => {
  it.each(['ar', 'en'])('accepts %s', (value) => {
    expect(isLocale(value)).toBe(true)
  })

  it.each([undefined, null, '', 'fr', 'AR', 'ar-SA', 42, {}, []])(
    'rejects %o',
    (value) => {
      expect(isLocale(value)).toBe(false)
    }
  )

  it('narrows anything unsupported to the platform default', () => {
    expect(toLocale('fr')).toBe(DEFAULT_LOCALE)
    expect(toLocale(undefined)).toBe(DEFAULT_LOCALE)
    expect(toLocale('en')).toBe('en')
  })
})

describe('direction', () => {
  it('Arabic is RTL', () => {
    expect(dirFor('ar')).toBe('rtl')
  })

  it('English is LTR', () => {
    expect(dirFor('en')).toBe('ltr')
  })
})

describe('precedence: explicit → user → tenant → platform', () => {
  it('falls back to the platform default when nothing is known', () => {
    expect(resolveLocale({})).toBe(DEFAULT_LOCALE)
    expect(resolveLocaleWithSource({}).source).toBe('platform')
  })

  it('uses the tenant default when the user has no preference', () => {
    const r = resolveLocaleWithSource({ user: null, tenant: 'en' })
    expect(r).toEqual({ locale: 'en', source: 'tenant' })
  })

  it('prefers the user over the tenant', () => {
    const r = resolveLocaleWithSource({ user: 'ar', tenant: 'en' })
    expect(r).toEqual({ locale: 'ar', source: 'user' })
  })

  it('prefers an explicit locale over everything — the email/report case', () => {
    const r = resolveLocaleWithSource({ explicit: 'en', user: 'ar', tenant: 'ar' })
    expect(r).toEqual({ locale: 'en', source: 'explicit' })
  })

  it('skips an unsupported value rather than defaulting on it', () => {
    // A junk users.locale must not swallow the tenant default.
    expect(resolveLocale({ user: 'fr', tenant: 'en' })).toBe('en')
    expect(resolveLocale({ explicit: '', user: 'en' })).toBe('en')
  })
})

describe('locale cookie', () => {
  it('reads a valid cookie', () => {
    expect(localeFromCookie('en')).toBe('en')
    expect(localeFromCookie('ar')).toBe('ar')
  })

  it('never throws on a missing or tampered cookie', () => {
    expect(localeFromCookie(undefined)).toBe(DEFAULT_LOCALE)
    expect(localeFromCookie('')).toBe(DEFAULT_LOCALE)
    expect(localeFromCookie('../../etc/passwd')).toBe(DEFAULT_LOCALE)
  })

  it('is readable by the client and scoped to the whole site', () => {
    // The future in-page switcher writes this from the browser; it carries no
    // identity, so httpOnly would buy nothing and cost a round-trip.
    expect(LOCALE_COOKIE).toBe('eq_locale')
    expect(LOCALE_COOKIE_OPTIONS.httpOnly).toBe(false)
    expect(LOCALE_COOKIE_OPTIONS.path).toBe('/')
    expect(LOCALE_COOKIE_OPTIONS.sameSite).toBe('lax')
  })
})

describe('namespace classification', () => {
  it('never lets a server-only namespace into the client set', () => {
    for (const ns of SERVER_NAMESPACES) {
      expect(CLIENT_NAMESPACES).not.toContain(ns)
    }
  })

  it('accounts for every namespace exactly once', () => {
    expect(new Set(NAMESPACES).size).toBe(NAMESPACES.length)
    expect([...CLIENT_NAMESPACES, ...SERVER_NAMESPACES].sort()).toEqual([...NAMESPACES].sort())
  })
})
