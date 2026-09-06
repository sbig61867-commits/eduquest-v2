/**
 * Security & Auth E2E tests — run against production (eduquest-v2.vercel.app).
 *
 * Covers:
 *  1. Unauthenticated access → redirect to /login (all protected prefixes)
 *  2. Role isolation — student cannot reach teacher/admin routes
 *  3. API routes return 401 without a valid session
 *  4. Login page renders correctly and rejects bad credentials
 *  5. Google OAuth button present on login page
 */
import { test, expect, type Page } from '@playwright/test'

const STUDENT_EMAIL = 'student.test@eduquest.local'
const STUDENT_PASS  = 'TestPass!2026'

// ── helpers ────────────────────────────────────────────────────────────────

async function loginAs(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.waitForSelector('input[type="password"]', { timeout: 30_000 })
  await page.locator('input[type="email"]').fill(email)
  await page.locator('input[type="password"]').fill(password)
  await page.locator('button[type="submit"]').click()
}

// ── 1. Unauthenticated redirect ────────────────────────────────────────────

test.describe('Unauthenticated access → /login redirect', () => {
  const protectedRoutes = [
    '/teacher/dashboard',
    '/student/dashboard',
    '/admin/dashboard',
    '/super-admin/dashboard',
    '/center/dashboard',
  ]

  for (const route of protectedRoutes) {
    test(`${route} redirects to /login`, async ({ page }) => {
      await page.goto(route)
      await expect(page).toHaveURL(/\/login/, { timeout: 15_000 })
    })
  }
})

// ── 2. API routes → 401 without session ────────────────────────────────────

test.describe('API routes without session → 401', () => {
  const apiRoutes = [
    '/api/admin/create-user',
    '/api/admin/toggle-user',
    '/api/invitations',
    '/api/requests',
    '/api/announcements',
  ]

  for (const route of apiRoutes) {
    test(`POST ${route} → 401`, async ({ request }) => {
      const res = await request.post(route, { data: {} })
      expect(res.status()).toBe(401)
    })
  }
})

// ── 3. Login page ──────────────────────────────────────────────────────────

test.describe('Login page', () => {
  test('renders email + password fields and submit button', async ({ page }) => {
    await page.goto('/login')
    await expect(page.locator('input[type="email"]')).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
    await expect(page.locator('button[type="submit"]')).toBeVisible()
  })

  test('Google sign-in button is present', async ({ page }) => {
    await page.goto('/login')
    // Button text contains "Google" (case-insensitive)
    const googleBtn = page.getByRole('button', { name: /google/i })
    await expect(googleBtn).toBeVisible({ timeout: 10_000 })
  })

  test('bad credentials show an error message', async ({ page }) => {
    await loginAs(page, 'nobody@example.com', 'wrongpassword')
    // Should stay on /login and show some error feedback
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 })
    // Error text visible (any text that is not the submit button label)
    const errorVisible = await page.locator('[role="alert"], .text-red-400, .text-red-500').count()
    expect(errorVisible).toBeGreaterThan(0)
  })
})

// ── 4. Role isolation ──────────────────────────────────────────────────────

test.describe('Role isolation — student cannot reach teacher routes', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, STUDENT_EMAIL, STUDENT_PASS)
    await page.waitForURL(/\/student\/dashboard/, { timeout: 60_000 })
  })

  test('student visiting /teacher/dashboard is redirected away', async ({ page }) => {
    await page.goto('/teacher/dashboard')
    // Must not stay on a teacher route — redirected to student dashboard or login
    await expect(page).not.toHaveURL(/\/teacher\//, { timeout: 15_000 })
  })

  test('student visiting /admin/dashboard is redirected away', async ({ page }) => {
    await page.goto('/admin/dashboard')
    await expect(page).not.toHaveURL(/\/admin\//, { timeout: 15_000 })
  })
})

// ── 5. Security headers ────────────────────────────────────────────────────

test.describe('Security headers on main page', () => {
  test('X-Frame-Options or CSP frame-ancestors is set', async ({ request }) => {
    const res = await request.get('/')
    const xfo = res.headers()['x-frame-options']
    const csp = res.headers()['content-security-policy']
    const hasFrameProtection =
      (xfo && /DENY|SAMEORIGIN/i.test(xfo)) ||
      (csp && csp.includes('frame-ancestors'))
    expect(hasFrameProtection).toBeTruthy()
  })

  test('X-Content-Type-Options is nosniff', async ({ request }) => {
    const res = await request.get('/')
    expect(res.headers()['x-content-type-options']).toBe('nosniff')
  })
})
