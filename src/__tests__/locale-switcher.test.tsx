/**
 * The in-app language switch (signed-in header) is the same compact EN · AR
 * pill as the public pages — two-letter codes, not the full language names.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'

import arMessages from '@/messages/ar'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }))

import { LocaleSwitcher } from '@/components/shared/locale-switcher'

describe('LocaleSwitcher', () => {
  beforeEach(() => {
    refresh.mockReset()
    document.cookie = 'eq_locale=; max-age=0; path=/'
  })

  const renderAr = () => render(
    <NextIntlClientProvider locale="ar" messages={arMessages}><LocaleSwitcher /></NextIntlClientProvider>,
  )

  it('shows two-letter codes, not the language names', () => {
    renderAr()
    expect(screen.getByRole('button', { name: 'English' })).toHaveTextContent(/^EN$/)
    expect(screen.getByRole('button', { name: 'العربية' })).toHaveTextContent(/^AR$/)
    expect(screen.queryByText('English')).toBeNull()
    expect(screen.getByRole('button', { name: 'العربية' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('switches language through the cookie and a refresh', () => {
    renderAr()
    fireEvent.click(screen.getByRole('button', { name: 'English' }))
    expect(document.cookie).toContain('eq_locale=en')
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('does nothing when the active language is picked again', () => {
    renderAr()
    fireEvent.click(screen.getByRole('button', { name: 'العربية' }))
    expect(refresh).not.toHaveBeenCalled()
  })
})
