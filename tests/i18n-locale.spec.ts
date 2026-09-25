import { expect, test } from '@playwright/test'

/**
 * Locale resolution, end to end, against a LOCAL build.
 *
 * Every URL here is absolute and derived from `E2E_BASE_URL` (default
 * localhost), deliberately bypassing the production `baseURL` in
 * playwright.config.ts — this suite must never be pointed at production by
 * accident, and the behaviour it checks is not deployed.
 *
 *   npm run build && npm run start
 *   npx playwright test tests/i18n-locale.spec.ts
 *
 * `/login` is used because it is public: this proves the root layout's
 * lang/dir derivation without needing a session, which is the part Phase 0b
 * actually changed.
 */

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000'
const LOGIN = `${BASE}/login`

async function htmlAttrs(page: import('@playwright/test').Page) {
  const html = page.locator('html')
  return {
    lang: await html.getAttribute('lang'),
    dir: await html.getAttribute('dir'),
  }
}

test.describe('root layout locale', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies()
  })

  test('Arabic cookie ⇒ lang="ar" dir="rtl"', async ({ context, page }) => {
    await context.addCookies([{ name: 'eq_locale', value: 'ar', url: BASE }])
    await page.goto(LOGIN)
    expect(await htmlAttrs(page)).toEqual({ lang: 'ar', dir: 'rtl' })
  })

  test('English cookie ⇒ lang="en" dir="ltr" — same URL, no /en prefix', async ({
    context,
    page,
  }) => {
    await context.addCookies([{ name: 'eq_locale', value: 'en', url: BASE }])
    await page.goto(LOGIN)
    expect(await htmlAttrs(page)).toEqual({ lang: 'en', dir: 'ltr' })
    // The whole architecture rests on this: one URL, no locale segment.
    expect(new URL(page.url()).pathname).toBe('/login')
  })

  test('no cookie ⇒ the platform default renders, nothing breaks', async ({ page }) => {
    await page.goto(LOGIN)
    const { lang, dir } = await htmlAttrs(page)
    expect(['ar', 'en']).toContain(lang)
    expect(dir).toBe(lang === 'ar' ? 'rtl' : 'ltr')
  })

  test('a tampered cookie falls back instead of erroring', async ({ context, page }) => {
    await context.addCookies([{ name: 'eq_locale', value: 'fr', url: BASE }])
    const response = await page.goto(LOGIN)
    expect(response?.status()).toBeLessThan(400)
    const { lang, dir } = await htmlAttrs(page)
    expect(['ar', 'en']).toContain(lang)
    expect(dir).toBe(lang === 'ar' ? 'rtl' : 'ltr')
  })

  test('no missing-key markers leaked into the page', async ({ page }) => {
    // C3's fallback is deliberately conspicuous; if one ever reaches a real
    // screen, this fails rather than letting it pass as copy.
    await page.goto(LOGIN)
    expect(await page.content()).not.toContain('⟦')
  })
})
