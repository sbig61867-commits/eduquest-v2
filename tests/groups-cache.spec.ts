/**
 * E2E test: groups cache invalidation (the original bug).
 *
 * Flow: login → create group → navigate away → navigate back (without reload)
 *       → confirm group visible (router cache must be invalidated by router.refresh())
 *       → edit group name → navigate away → navigate back → confirm edit persisted
 *       → delete group → navigate away → navigate back → confirm group gone
 *
 * Uses teacher.test@eduquest.local / TestPass!2026 (seeded test account, tenant QOU).
 * Tests run sequentially (1 worker). Each test logs in independently.
 *
 * UI notes (confirmed from live screenshot):
 *   - Create: "New Group" button top-right → modal title h3 "New Group" → "Create Group" submit
 *   - Edit:   first icon button in card (pencil, index 0) → h3 "Edit Group" → "Save Changes"
 *   - Delete: third icon button in card (trash, index 2) — pencil=0, archive=1, trash=2
 *             "Manage Students" is index 3 (bottom) — do NOT use .last()
 *   - Card container: div.rounded-xl (no "card" in className)
 */
import { test, expect, type Page } from '@playwright/test'

const TEACHER_EMAIL = 'teacher.test@eduquest.local'
const TEACHER_PASS  = 'TestPass!2026'
const GROUPS_URL    = '/teacher/groups'
const DASHBOARD_URL = '/teacher/dashboard'

async function login(page: Page) {
  await page.goto('/login')
  // Wait for Suspense boundary to resolve (LoginForm uses useSearchParams)
  await page.waitForSelector('input[type="password"]', { timeout: 30_000 })
  await page.locator('input[type="email"]').fill(TEACHER_EMAIL)
  await page.locator('input[type="password"]').fill(TEACHER_PASS)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL(`**${DASHBOARD_URL}`, { timeout: 60_000 })
}

test.describe('Groups — router cache invalidation', () => {
  // stamp is evaluated once per run — shared across all tests in the suite
  const stamp      = Date.now()
  const groupName  = `E2E-Test-${stamp}`
  const editedName = `E2E-Edited-${stamp}`

  async function navToGroups(page: Page) {
    await page.goto(GROUPS_URL)
    await page.waitForURL(`**${GROUPS_URL}`, { timeout: 20_000 })
    // networkidle ensures React has fully hydrated (event handlers attached)
    await page.waitForLoadState('networkidle')
  }

  async function navAway(page: Page) {
    await page.goto(DASHBOARD_URL)
    await page.waitForURL(`**${DASHBOARD_URL}`, { timeout: 20_000 })
  }

  // ── Test 1: create ──────────────────────────────────────────────────────────
  // Proves: after creation + router.refresh(), group is visible on navigation back

  test('create group → navigate away → back (no reload) → group visible', async ({ page }) => {
    await login(page)
    await navToGroups(page)

    // "New Group" button — confirmed text from live screenshot
    await page.getByRole('button', { name: 'New Group' }).click()

    // Modal title h3 (Modal component does not use role="dialog")
    await page.waitForSelector('h3:has-text("New Group")', { timeout: 10_000 })
    await page.getByRole('textbox').first().fill(groupName)

    await page.getByRole('button', { name: 'Create Group' }).click()

    // Group appears in list (optimistic + server confirm)
    await expect(page.getByText(groupName)).toBeVisible({ timeout: 15_000 })

    // Navigate away — client-side, no hard reload
    await navAway(page)

    // Navigate back — exercises router cache
    await navToGroups(page)

    // MUST be visible — proves router.refresh() invalidated the cache
    await expect(page.getByText(groupName)).toBeVisible({ timeout: 15_000 })
  })

  // ── Test 2: edit ───────────────────────────────────────────────────────────

  test('edit group → navigate away → back → edited name visible', async ({ page }) => {
    await login(page)
    await navToGroups(page)

    const card = page.locator(`div.rounded-xl:has-text("${groupName}")`).first()
    await expect(card).toBeVisible({ timeout: 15_000 })

    // Edit button: first icon button (pencil, index 0)
    await card.locator('button').first().click()

    await page.waitForSelector('h3:has-text("Edit Group")', { timeout: 10_000 })
    const nameInput = page.getByRole('textbox').first()
    await nameInput.clear()
    await nameInput.fill(editedName)

    await page.getByRole('button', { name: 'Save Changes' }).click()

    await expect(page.getByText(editedName)).toBeVisible({ timeout: 15_000 })

    await navAway(page)
    await navToGroups(page)

    // Edited name persists after navigation — cache was invalidated
    await expect(page.getByText(editedName)).toBeVisible({ timeout: 15_000 })
    expect(await page.getByText(groupName).count()).toBe(0)
  })

  // ── Test 3: delete ─────────────────────────────────────────────────────────

  test('delete group → navigate away → back → group gone', async ({ page }) => {
    await login(page)
    await navToGroups(page)

    const card = page.locator(`div.rounded-xl:has-text("${editedName}")`).first()
    await expect(card).toBeVisible({ timeout: 15_000 })

    // Delete button: 3rd button in card (index 2) — pencil=0, archive=1, trash=2
    // .last() would select "Manage Students" (index 3) — avoid it
    page.once('dialog', dialog => dialog.accept())
    await card.locator('button').nth(2).click()

    // Optimistic removal — scoped locator avoids strict-mode violation
    await expect(page.locator(`div.rounded-xl:has-text("${editedName}")`))
      .not.toBeVisible({ timeout: 10_000 })

    await navAway(page)
    await navToGroups(page)

    // Still gone after navigation — proves router.refresh() invalidated the cache
    expect(await page.locator(`div.rounded-xl:has-text("${editedName}")`).count()).toBe(0)
  })
})
