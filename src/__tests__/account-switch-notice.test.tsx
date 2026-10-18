import { act, render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import en from '@/messages/en'

// One browser keeps one sign-in for every tab: when another tab signs in to a
// different account, the older tab says so as soon as it is looked at again.

const session = vi.hoisted(() => ({ id: 'teacher-1' as string | null }))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getSession: async () => ({ data: { session: session.id ? { user: { id: session.id } } : null } }) },
  }),
}))

import { AccountSwitchNotice } from '@/components/shared/account-switch-notice'

const mount = () => render(<NextIntlClientProvider locale="en" messages={en}><AccountSwitchNotice /></NextIntlClientProvider>)
const refocus = async () => { await act(async () => { window.dispatchEvent(new Event('focus')) }) }

beforeEach(() => { session.id = 'teacher-1' })

describe('AccountSwitchNotice', () => {
  it('stays hidden while the account is the same', async () => {
    mount()
    await act(async () => {})
    await refocus()
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('explains a switch to another account made in another tab', async () => {
    mount()
    await act(async () => {})
    session.id = 'student-9'
    await refocus()
    expect(screen.getByRole('alertdialog').textContent).toContain('This tab is now signed in to another account')
    expect(screen.getByRole('button', { name: 'Continue with the current account' })).toBeTruthy()
  })

  it('explains a sign-out made in another tab', async () => {
    mount()
    await act(async () => {})
    session.id = null
    await refocus()
    expect(screen.getByRole('alertdialog').textContent).toContain('You were signed out')
  })
})
