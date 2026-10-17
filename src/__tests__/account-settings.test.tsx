/**
 * The shared account section (2026-10-17): every role's settings page shows
 * my details, change password, and language/appearance, in both languages.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NextIntlClientProvider } from 'next-intl'
import ar from '@/messages/ar'
import en from '@/messages/en'
import { useAuthStore } from '@/stores/auth-store'
import { AccountSettings, PasswordCard } from '@/components/shared/account-settings'
import { NAVIGATION } from '@/lib/navigation'
import type { Tenant, User } from '@/types'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }), usePathname: () => '/teacher/settings' }))

const USER = { id: 'u1', full_name: 'Lina Matar', email: 'lina@example.test', member_code: 'ZZ1-T12345678', role: 'teacher' } as unknown as User
const TENANT = { id: 't1', name: 'Horizon University', institution_type: 'university' } as unknown as Tenant

function renderIn(locale: 'ar' | 'en', ui: React.ReactNode) {
  const messages = locale === 'ar' ? ar : en
  return render(<NextIntlClientProvider locale={locale} messages={messages}>{ui}</NextIntlClientProvider>)
}

const fetchMock = vi.fn()
beforeEach(() => {
  useAuthStore.setState({ user: USER, tenant: TENANT })
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

const fill = (label: RegExp | string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

describe('AccountSettings', () => {
  it('shows my details, change password and preferences (English)', () => {
    renderIn('en', <AccountSettings />)
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeTruthy()
    const details = screen.getByRole('region', { name: 'My details' })
    expect(within(details).getByText('Lina Matar')).toBeTruthy()
    expect(within(details).getByText('ZZ1-T12345678')).toBeTruthy()
    expect(within(details).getByText('Horizon University')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Change password' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Preferences' })).toBeTruthy()
  })

  it('renders in Arabic with the same sections', () => {
    renderIn('ar', <AccountSettings />)
    expect(screen.getByRole('region', { name: 'بياناتي' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'تغيير كلمة المرور' })).toBeTruthy()
    expect(screen.getByLabelText('كلمة المرور الحالية')).toBeTruthy()
  })
})

describe('PasswordCard', () => {
  it('every field has a label and the right autocomplete', () => {
    renderIn('en', <PasswordCard />)
    expect(screen.getByLabelText('Current password').getAttribute('autocomplete')).toBe('current-password')
    expect(screen.getByLabelText('New password').getAttribute('autocomplete')).toBe('new-password')
    expect(screen.getByLabelText('Confirm the new password').getAttribute('autocomplete')).toBe('new-password')
  })

  it('refuses a short new password without calling the server', () => {
    renderIn('en', <PasswordCard />)
    fill('Current password', 'old-password'); fill('New password', 'short'); fill('Confirm the new password', 'short')
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }))
    expect(screen.getByRole('status').textContent).toContain('At least 8 characters')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses mismatched new passwords without calling the server', () => {
    renderIn('en', <PasswordCard />)
    fill('Current password', 'old-password'); fill('New password', 'brand-new-pass'); fill('Confirm the new password', 'brand-new-paxx')
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }))
    expect(screen.getByRole('status').textContent).toContain('do not match')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends current + new to /api/account/password and clears the form on success', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    renderIn('en', <PasswordCard />)
    fill('Current password', 'old-password'); fill('New password', 'brand-new-pass'); fill('Confirm the new password', 'brand-new-pass')
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Your password has been changed.'))
    expect(fetchMock).toHaveBeenCalledWith('/api/account/password', expect.objectContaining({ method: 'POST' }))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ current: 'old-password', next: 'brand-new-pass' })
    expect((screen.getByLabelText('Current password') as HTMLInputElement).value).toBe('')
  })

  it('shows the server message when the current password is wrong', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'The current password is not correct.', code: 'currentPasswordWrong' }) })
    renderIn('en', <PasswordCard />)
    fill('Current password', 'guess'); fill('New password', 'brand-new-pass'); fill('Confirm the new password', 'brand-new-pass')
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('The current password is not correct.'))
  })
})

describe('every role has the settings section', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), 'src', p), 'utf8')

  it('each role links to its own settings page in the navigation', () => {
    for (const role of ['admin', 'center', 'teacher', 'student', 'superAdmin'] as const) {
      const hrefs = NAVIGATION[role].groups.flatMap(g => g.items.map(i => i.href))
      expect(hrefs.some(h => h.endsWith('/settings')), role).toBe(true)
    }
  })

  it('the four role pages render AccountSettings; super admin renders the password card', () => {
    for (const p of ['app/(admin)/admin/settings/page.tsx', 'app/(center)/center/settings/page.tsx',
      'app/(teacher)/teacher/settings/page.tsx', 'app/(student)/student/settings/page.tsx']) {
      expect(read(p), p).toContain('<AccountSettings />')
    }
    const sa = read('app/(super-admin)/super-admin/settings/page.tsx')
    expect(sa).toContain('<PasswordCard />')
    expect(sa).toContain('<PreferencesCard />')
  })

  it('no settings page changes a password in the browser without the current one', () => {
    expect(read('app/(super-admin)/super-admin/settings/settings-client.tsx')).not.toContain('auth.updateUser')
  })
})
