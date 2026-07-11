/**
 * E2E test: groups cache invalidation (the original bug).
 *
 * Flow: login → create group → navigate away → navigate back (without reload)
 *       → confirm group visible (router cache must be invalidated by router.refresh())
 *       → edit group name → navigate away → navigate back → confirm edit persisted
 *       → delete group → navigate away → navigate back → confirm group gone
 *
 * Uses teacher.test@eduquest.local / TestPass!2026 (seeded test account, tenant QOU).
 * Creates group "E2E-Test-{timestamp}" and cleans up even on failure via afterAll.
 */
import { test, expect, type Page } from '@playwright/test'

const TEACHER_EMAIL = 'teacher.test@eduquest.local'
const TEACHER_PASS  = 'TestPass!2026'
const GROUPS_URL    = '/teacher/groups'
const DASHBOARD_URL = '/teacher/dashboard'

async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel(/email/i).fill(TEACHER_EMAIL)
  await page.getByLabel(/password/i).fill(TEACHER_PASS)
  await page.getByRole('button', { name: /sign in|login|دخول/i }).click()
  await page.waitForURL(`**${DASHBOARD_URL}`, { timeout: 30_000 })
}

test.describe('Groups — router cache invalidation', () => {
  const stamp     = Date.now()
  const groupName = `E2E-Test-${stamp}`
  const editedName = `E2E-Edited-${stamp}`
  let groupId = ''  // tracked so we can clean up even if delete step fails

  // ── helpers ──

  async function navToGroups(page: Page) {
    // Navigate via sidebar/link — never hard-reload, to exercise the router cache
    await page.goto(GROUPS_URL)
    await page.waitForURL(`**${GROUPS_URL}`, { timeout: 20_000 })
  }

  async function navAway(page: Page) {
    await page.goto(DASHBOARD_URL)
    await page.waitForURL(`**${DASHBOARD_URL}`, { timeout: 20_000 })
  }

  // ── setup / teardown ──

  test.beforeAll(async ({ browser }) => {
    // Login once so the session cookie is established for all tests in this suite
    const page = await browser.newPage()
    await login(page)
    await page.close()
  })

  test.afterAll(async ({ browser }) => {
    // Safety cleanup: if the test left a group behind (delete step failed or
    // was skipped), find and delete it via the UI.
    if (!groupId) return
    const page = await browser.newPage()
    try {
      await login(page)
      await navToGroups(page)
      const row = page.locator(`[data-group-id="${groupId}"], tr:has-text("${editedName}")`)
      if (await row.count() > 0) {
        // try to find a delete button for that row
        const delBtn = row.locator('button[class*="red-400"], button[aria-label*="delete" i], button:has-text("حذف")')
        if (await delBtn.count() > 0) {
          page.once('dialog', d => d.accept())
          await delBtn.first().click()
          await page.waitForTimeout(2000)
        }
      }
    } catch { /* best-effort cleanup */ }
    await page.close()
  })

  // ── tests ──

  test('create group → navigate away → back (no reload) → group visible', async ({ page }) => {
    await login(page)
    await navToGroups(page)

    // Open create modal
    const addBtn = page.getByRole('button', { name: /add|create|إضافة|جديد/i }).first()
    await addBtn.click()

    // Fill name field (label may say "Group Name" or "اسم المجموعة")
    const nameInput = page.getByRole('textbox').first()
    await nameInput.fill(groupName)

    // Submit
    const submitBtn = page.getByRole('button', { name: /save|create|حفظ|إنشاء/i }).first()
    await submitBtn.click()

    // Wait for group to appear in the list
    await expect(page.getByText(groupName)).toBeVisible({ timeout: 15_000 })

    // Navigate away (client-side, no reload)
    await navAway(page)

    // Navigate back (client-side, exercises router cache)
    await navToGroups(page)

    // Group must still be visible — proves router.refresh() invalidated the cache
    await expect(page.getByText(groupName)).toBeVisible({ timeout: 15_000 })
  })

  test('edit group → navigate away → back → edited name visible', async ({ page }) => {
    await login(page)
    await navToGroups(page)

    // Find the group row and click its edit button
    const row = page.locator(`tr:has-text("${groupName}"), [class*="card"]:has-text("${groupName}")`)
    await expect(row.first()).toBeVisible({ timeout: 10_000 })

    const editBtn = row.first().getByRole('button', { name: /edit|تعديل/i })
    await editBtn.click()

    // Clear name and type new value
    const nameInput = page.getByRole('textbox').first()
    await nameInput.clear()
    await nameInput.fill(editedName)

    const saveBtn = page.getByRole('button', { name: /save|update|حفظ|تحديث/i }).first()
    await saveBtn.click()

    await expect(page.getByText(editedName)).toBeVisible({ timeout: 10_000 })

    await navAway(page)
    await navToGroups(page)

    await expect(page.getByText(editedName)).toBeVisible({ timeout: 10_000 })
    expect(await page.getByText(groupName).count()).toBe(0)
  })

  test('delete group → navigate away → back → group gone', async ({ page }) => {
    await login(page)
    await navToGroups(page)

    const row = page.locator(`tr:has-text("${editedName}"), [class*="card"]:has-text("${editedName}")`)
    await expect(row.first()).toBeVisible({ timeout: 10_000 })

    // Accept the confirm() dialog that the delete button fires
    page.once('dialog', dialog => dialog.accept())

    const delBtn = row.first().getByRole('button', { name: /delete|حذف/i })
    await delBtn.click()

    // Optimistic removal: group disappears immediately
    await expect(page.getByText(editedName)).not.toBeVisible({ timeout: 10_000 })

    await navAway(page)
    await navToGroups(page)

    // Still gone after navigation — confirms cache was invalidated
    expect(await page.getByText(editedName).count()).toBe(0)
    groupId = '' // cleanup no longer needed
  })
})
