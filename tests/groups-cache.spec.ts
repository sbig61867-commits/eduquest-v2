/**
 * E2E test: groups cache invalidation.
 *
 * Flow: login → create group → navigate away → navigate back → edit →
 * navigate away → back → delete → navigate away → back.
 *
 * Required environment variables:
 *   E2E_TEACHER_EMAIL
 *   E2E_TEACHER_PASS
 *
 * The test mutates the configured E2E tenant, so run it only against a
 * disposable/test environment. It is intentionally serial because later
 * assertions depend on the group created by the first test.
 */
import { test, expect, type Page } from '@playwright/test'

const TEACHER_EMAIL = process.env.E2E_TEACHER_EMAIL
const TEACHER_PASS  = process.env.E2E_TEACHER_PASS
const GROUPS_URL    = '/teacher/groups'
const DASHBOARD_URL = '/teacher/dashboard'

if (!TEACHER_EMAIL || !TEACHER_PASS) {
  throw new Error('E2E_TEACHER_EMAIL and E2E_TEACHER_PASS must be set to run the groups E2E test.')
}

async function login(page: Page) {
  await page.goto('/login')
  await page.waitForSelector('input[type="password"]', { timeout: 30_000 })
  await page.locator('input[type="email"]').fill(TEACHER_EMAIL)
  await page.locator('input[type="password"]').fill(TEACHER_PASS)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL(`**${DASHBOARD_URL}`, { timeout: 60_000 })
}

test.describe('Groups — router cache invalidation', () => {
  test.describe.configure({ mode: 'serial' })

  const stamp      = Date.now()
  const groupName  = `E2E-Test-${stamp}`
  const editedName = `E2E-Edited-${stamp}`

  async function navToGroups(page: Page) {
    await page.goto(GROUPS_URL)
    await page.waitForURL(`**${GROUPS_URL}`, { timeout: 20_000 })
    await page.waitForLoadState('networkidle')
  }

  async function navAway(page: Page) {
    await page.goto(DASHBOARD_URL)
    await page.waitForURL(`**${DASHBOARD_URL}`, { timeout: 20_000 })
  }

  test('create → navigate away/back → edit → navigate away/back → delete → navigate away/back', async ({ page }) => {
    await login(page)
    await navToGroups(page)

    await page.getByRole('button', { name: 'New Group' }).click()
    await page.waitForSelector('h3:has-text("New Group")', { timeout: 10_000 })
    await page.getByRole('textbox').first().fill(groupName)
    await page.getByRole('button', { name: 'Create Group' }).click()
    await expect(page.getByText(groupName)).toBeVisible({ timeout: 15_000 })

    await navAway(page)
    await navToGroups(page)
    await expect(page.getByText(groupName)).toBeVisible({ timeout: 15_000 })

    const card = page.locator(`div.rounded-xl:has-text("${groupName}")`).first()
    await expect(card).toBeVisible({ timeout: 15_000 })
    await card.locator('button').first().click()
    await page.waitForSelector('h3:has-text("Edit Group")', { timeout: 10_000 })
    const nameInput = page.getByRole('textbox').first()
    await nameInput.clear()
    await nameInput.fill(editedName)
    await page.getByRole('button', { name: 'Save Changes' }).click()
    await expect(page.getByText(editedName)).toBeVisible({ timeout: 15_000 })

    await navAway(page)
    await navToGroups(page)
    await expect(page.getByText(editedName)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(groupName)).toHaveCount(0)

    const editedCard = page.locator(`div.rounded-xl:has-text("${editedName}")`).first()
    await editedCard.locator('button').nth(2).click()

    // The application now uses a custom ConfirmDialog rather than the native
    // browser dialog, so page.once('dialog') would never confirm deletion.
    await expect(page.getByRole('button', { name: 'تأكيد' })).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: 'تأكيد' }).click()

    await expect(page.locator(`div.rounded-xl:has-text("${editedName}")`)).not.toBeVisible({ timeout: 10_000 })
    await navAway(page)
    await navToGroups(page)
    await expect(page.locator(`div.rounded-xl:has-text("${editedName}")`)).toHaveCount(0)
  })
})
