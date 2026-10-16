/**
 * The language switch is a compact dropdown: the button shows the current
 * two-letter code, and the menu lists every language by its full name.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'

import arMessages from '@/messages/ar'

// A language switch is a full page reload (owner's rule 2026-10-09).
const refresh = vi.fn()
Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, reload: refresh } })
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

  it('shows the current language code, and the menu is closed at first', () => {
    renderAr()
    const trigger = screen.getByRole('button', { name: /العربية/ })
    expect(trigger).toHaveTextContent(/^AR$/)
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('opens a menu that lists every language and marks the active one', () => {
    renderAr()
    fireEvent.click(screen.getByRole('button', { name: /العربية/ }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    const items = screen.getAllByRole('menuitemradio')
    expect(items.map(i => i.textContent?.replace('✓', '').trim())).toEqual(['English', 'العربية'])
    expect(screen.getByRole('menuitemradio', { name: /العربية/ })).toHaveAttribute('aria-checked', 'true')
  })

  it('switches language through the cookie and a full reload', async () => {
    renderAr()
    fireEvent.click(screen.getByRole('button', { name: /العربية/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /English/ }))
    expect(document.cookie).toContain('eq_locale=en')
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
  })

  it('does nothing when the active language is picked again', () => {
    renderAr()
    fireEvent.click(screen.getByRole('button', { name: /العربية/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /العربية/ }))
    expect(refresh).not.toHaveBeenCalled()
  })
})
