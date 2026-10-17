import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

/**
 * Batch 2 — admin teachers screen: one server page, search through the URL
 * (never by filtering in the browser), the count from the database, plain
 * Previous / Next links — and the existing actions (status, course permission,
 * delete) still call the same routes with the same bodies.
 */

const replace = vi.fn()
const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, refresh, push: vi.fn() }),
  usePathname: () => '/admin/teachers',
  useSearchParams: () => new URLSearchParams('q=ali&page=2'),
}))
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${Object.values(vars).join('/')}` : key,
  useLocale: () => 'en',
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}))
vi.mock('@/lib/confirm-dialog', () => ({ confirmDialog: () => Promise.resolve(true) }))

import { TeachersClient } from '@/app/(admin)/admin/teachers/teachers-client'

const row = (id: string, full_name: string, extra: Record<string, unknown> = {}) => ({
  id, full_name, email: `${id}@x.test`, is_active: true, created_at: '2026-09-01T00:00:00Z',
  can_create_courses: false, ...extra,
})

// The row's two icon buttons (status, delete) — the course chip has a title.
// Row actions: [reset password, status toggle, delete].
const rowButtons = () => [...document.querySelectorAll<HTMLButtonElement>('tbody td:last-child button')]

const fetchMock = vi.fn()
beforeEach(() => {
  replace.mockReset(); refresh.mockReset()
  fetchMock.mockReset().mockResolvedValue({ ok: true })
  vi.stubGlobal('fetch', fetchMock)
})

describe('admin teachers — server pagination', () => {
  it('the count is the database total, not the rows on this page', () => {
    render(<TeachersClient initialTeachers={[row('t1', 'Ali')]} total={2000} page={1} pageCount={40} />)
    expect(screen.getByText('teachers.summary:2000')).toBeTruthy()
  })

  it('typing searches through the URL after a short pause; nothing is filtered locally', async () => {
    render(<TeachersClient initialTeachers={[row('t1', 'Ali'), row('t2', 'Huda')]} total={2} />)
    fireEvent.change(screen.getByPlaceholderText('teachers.search'), { target: { value: 'hu' } })
    expect(screen.getByText('Ali')).toBeTruthy()
    await waitFor(() => expect(replace).toHaveBeenCalledWith('?q=hu'))
  })

  it('clearing the search goes back to the unfiltered first page', async () => {
    render(<TeachersClient initialTeachers={[row('t1', 'Ali')]} total={1} search="ali" />)
    fireEvent.change(screen.getByPlaceholderText('teachers.search'), { target: { value: '' } })
    await waitFor(() => expect(replace).toHaveBeenCalledWith('?'))
  })

  it('Previous / Next keep the search and move one page', () => {
    render(<TeachersClient initialTeachers={[row('t1', 'Ali')]} total={150} page={2} pageCount={3} search="ali" />)
    expect(screen.getByText('prev').closest('a')?.getAttribute('href')).toBe('/admin/teachers?q=ali')
    expect(screen.getByText('next').closest('a')?.getAttribute('href')).toBe('/admin/teachers?q=ali&page=3')
    expect(screen.getByText('pageOf:2/3')).toBeTruthy()
  })

  it('a single page shows no pagination; an empty page shows the empty state', () => {
    render(<TeachersClient initialTeachers={[]} total={0} page={1} pageCount={1} />)
    expect(screen.queryByText('next')).toBeNull()
    expect(screen.getByText('teachers.empty')).toBeTruthy()
  })

  it('a new page from the server replaces the rows', () => {
    const { rerender } = render(<TeachersClient initialTeachers={[row('t1', 'Ali')]} total={2} />)
    rerender(<TeachersClient initialTeachers={[row('t2', 'Huda')]} total={2} />)
    expect(screen.queryByText('Ali')).toBeNull()
    expect(screen.getByText('Huda')).toBeTruthy()
  })
})

describe('admin teachers — existing actions unchanged', () => {
  it('course permission → /api/admin/teacher-permissions, then the row updates', async () => {
    render(<TeachersClient initialTeachers={[row('t1', 'Ali')]} total={1} />)
    fireEvent.click(screen.getByTitle('teachers.grantCourses'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/teacher-permissions', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ teacher_id: 't1', can_create_courses: true }),
    })))
    await waitFor(() => expect(screen.getByText('teachers.allowed')).toBeTruthy())
    expect(refresh).toHaveBeenCalled()
  })

  it('status toggle → /api/admin/toggle-user', async () => {
    render(<TeachersClient initialTeachers={[row('t1', 'Ali')]} total={1} />)
    const [reset, toggle] = rowButtons()
    expect(reset.getAttribute('aria-label')).toContain('action')
    fireEvent.click(toggle)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/toggle-user', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ userId: 't1', isActive: false }),
    })))
    await waitFor(() => expect(screen.getByText('common.disabled')).toBeTruthy())
  })

  it('delete → /api/admin/delete-user', async () => {
    render(<TeachersClient initialTeachers={[row('t1', 'Ali')]} total={1} />)
    const del = rowButtons()[2]
    fireEvent.click(del)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/delete-user?id=t1', { method: 'DELETE' }))
    await waitFor(() => expect(screen.queryByText('Ali')).toBeNull())
  })
})
