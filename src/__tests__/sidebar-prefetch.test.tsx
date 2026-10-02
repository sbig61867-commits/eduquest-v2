import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import arMessages from '@/messages/ar'
import { useAuthStore } from '@/stores/auth-store'
import { useUIStore } from '@/stores/ui-store'

/**
 * Batch 5 (PERFORMANCE_CONTRACT.md P11). Sidebar links no longer prefetch on
 * sight — that cost two requests per link on every full page load — but on
 * intent: hover, keyboard focus or touch prefetch that one link. The links
 * stay ordinary anchors, so navigation and keyboard access are unchanged.
 */

const prefetch = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ prefetch, refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/student/dashboard',
}))
// Records the prefetch prop next/link receives and forwards the handlers to the anchor.
vi.mock('next/link', () => ({
  default: ({ href, children, prefetch: p, ...rest }: { href: string; children: React.ReactNode; prefetch?: boolean | null }) =>
    <a href={href} data-prefetch={String(p)} {...rest}>{children}</a>,
}))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { signOut: vi.fn() } }) }))

import { Sidebar, type NavItem } from '@/components/shared/sidebar'

const NAV: NavItem[] = [
  { label: 'Dashboard', href: '/student/dashboard', icon: 'LayoutDashboard' },
  { label: 'Courses', href: '/student/courses', icon: 'Layers' },
  { label: 'Exams', href: '/student/exams', icon: 'ClipboardList' },
]

const renderSidebar = () => render(
  <NextIntlClientProvider locale="ar" messages={arMessages}>
    <Sidebar items={NAV} title="Student" />
  </NextIntlClientProvider>,
)
const link = (name: string) => screen.getByRole('link', { name })

beforeEach(() => {
  prefetch.mockClear()
  useAuthStore.setState({ user: null, tenant: null, isLoading: false })
  useUIStore.setState({ sidebarOpen: true, mobileNavOpen: false })
})

describe('Sidebar prefetch on intent (Batch 5)', () => {
  it('every link opts out of viewport prefetch, and nothing is prefetched on render', () => {
    renderSidebar()
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(NAV.length)
    for (const a of links) expect(a.getAttribute('data-prefetch')).toBe('false')
    expect(prefetch).not.toHaveBeenCalled()
  })

  it('hover prefetches only the hovered link', () => {
    renderSidebar()
    fireEvent.mouseEnter(link('Courses'))
    expect(prefetch).toHaveBeenCalledTimes(1)
    expect(prefetch).toHaveBeenCalledWith('/student/courses')
  })

  it('keyboard focus prefetches the focused link', () => {
    renderSidebar()
    fireEvent.focus(link('Exams'))
    expect(prefetch).toHaveBeenCalledWith('/student/exams')
  })

  it('touch prefetches the touched link (mobile / collapsed: icon-only links)', () => {
    useUIStore.setState({ sidebarOpen: false })
    const { container } = renderSidebar()
    fireEvent.touchStart(container.querySelector('a[href="/student/courses"]')!)
    expect(prefetch).toHaveBeenCalledTimes(1)
    expect(prefetch).toHaveBeenCalledWith('/student/courses')
  })

  it('links stay ordinary anchors: href, accessible name, active state unchanged', () => {
    renderSidebar()
    expect(link('Dashboard').getAttribute('href')).toBe('/student/dashboard')
    expect(link('Courses').getAttribute('href')).toBe('/student/courses')
    expect(link('Dashboard').className).toContain('bg-blue-600')
    expect(link('Courses').className).not.toContain('bg-blue-600')
  })
})
