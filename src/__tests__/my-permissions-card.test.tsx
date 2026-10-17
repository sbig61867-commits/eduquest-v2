import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { createTranslator } from 'next-intl'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ar from '@/messages/ar'
import en from '@/messages/en'
import { CAPABILITIES, resolvePermissions } from '@/lib/permissions'

// The centre manager's settings page shows what their institution allows them
// to do (2026-10-17): every capability, with its real state, read-only.

const lang = vi.hoisted(() => ({ locale: 'en' as 'en' | 'ar' }))
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: string) => {
    const messages = lang.locale === 'ar' ? ar : en
    return createTranslator({ locale: lang.locale, messages, namespace: namespace as never })
  },
}))

const { MyPermissionsCard } = await import('@/components/shared/my-permissions-card')

async function show(locale: 'en' | 'ar', perms: Record<string, unknown> | null) {
  lang.locale = locale
  render(await MyPermissionsCard({ permissions: resolvePermissions('center_manager', perms) }))
  return screen.getByRole('region')
}

describe('MyPermissionsCard', () => {
  it('lists every capability with what the institution granted', async () => {
    const card = await show('en', { manage_students: true, manage_schedules: true })
    expect(within(card).getAllByRole('listitem')).toHaveLength(CAPABILITIES.length)
    const state = (label: string) => within(within(card).getByText(label).closest('li')!).getByText(/Allowed|Not allowed/).textContent
    expect(state(en.staff.capabilities.manage_students.label)).toBe('Allowed')
    expect(state(en.staff.capabilities.manage_schedules.label)).toBe('Allowed')
    expect(state(en.staff.capabilities.manage_teachers.label)).toBe('Not allowed')
  })

  it('a centre manager with nothing granted sees everything off', async () => {
    const card = await show('en', null)
    expect(within(card).queryAllByText('Allowed')).toHaveLength(0)
    expect(within(card).getAllByText('Not allowed')).toHaveLength(CAPABILITIES.length)
  })

  it('renders in Arabic', async () => {
    const card = await show('ar', { manage_students: true })
    expect(within(card).getByRole('heading', { name: 'صلاحياتي' })).toBeTruthy()
    expect(within(card).getAllByText('مسموح')).toHaveLength(1)
  })

  it('the centre settings page shows it under the shared account section', () => {
    const page = readFileSync(join(process.cwd(), 'src/app/(center)/center/settings/page.tsx'), 'utf8')
    expect(page).toContain('<AccountSettings />')
    expect(page).toContain('<MyPermissionsCard permissions={permissions} />')
    expect(page).toContain('resolvePermissions(me?.role')
  })
})
