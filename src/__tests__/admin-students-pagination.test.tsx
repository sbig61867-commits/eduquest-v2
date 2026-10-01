import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

/**
 * Batch 2 — admin students screen: it shows one server page, searches through
 * the URL (never by filtering in the browser), takes the count from the
 * database, and pages with plain Previous / Next links.
 */

const replace = vi.fn()
const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, refresh, push: vi.fn() }),
  usePathname: () => '/admin/students',
  useSearchParams: () => new URLSearchParams('q=sara&page=2'),
}))
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${Object.values(vars).join('/')}` : key,
  useLocale: () => 'en',
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}))
vi.mock('@/stores/auth-store', () => ({ useAuthStore: (sel: (s: unknown) => unknown) => sel({ tenant: null }) }))
vi.mock('@/components/shared/student-name-editor', () => ({ StudentNameEditor: () => null }))

import { StudentsClient } from '@/app/(admin)/admin/students/students-client'

const row = (id: string, full_name: string, extra: Record<string, unknown> = {}) => ({
  id, full_name, email: `${id}@x.test`, is_active: true, created_at: '2026-09-01T00:00:00Z',
  is_university_student: true, name_complete: true, ...extra,
})

beforeEach(() => { replace.mockReset(); refresh.mockReset() })

describe('admin students — server pagination', () => {
  it('the count is the database total, not the rows on this page', () => {
    render(<StudentsClient initialStudents={[row('s1', 'Sara')]} total={12345} page={1} pageCount={247} />)
    expect(screen.getByText('students.summary:12345')).toBeTruthy()
  })

  it('shows the incomplete-name flag from the row itself', () => {
    render(<StudentsClient initialStudents={[row('s1', 'Sara', { name_complete: false }), row('s2', 'Omar')]} total={2} />)
    expect(screen.getAllByText('notFourPart')).toHaveLength(1)
  })

  it('typing searches through the URL after a short pause; nothing is filtered locally', async () => {
    render(<StudentsClient initialStudents={[row('s1', 'Sara'), row('s2', 'Omar')]} total={2} />)
    fireEvent.change(screen.getByPlaceholderText('students.search'), { target: { value: 'om' } })
    // Rows stay as the server sent them until the server answers.
    expect(screen.getByText('Sara')).toBeTruthy()
    await waitFor(() => expect(replace).toHaveBeenCalledWith('?q=om'))
  })

  it('clearing the search goes back to the unfiltered first page', async () => {
    render(<StudentsClient initialStudents={[row('s1', 'Sara')]} total={1} search="sara" />)
    fireEvent.change(screen.getByPlaceholderText('students.search'), { target: { value: '' } })
    await waitFor(() => expect(replace).toHaveBeenCalledWith('?'))
  })

  it('does not re-query when the box already matches the server search', async () => {
    render(<StudentsClient initialStudents={[row('s1', 'Sara')]} total={1} search="sara" />)
    await new Promise(r => setTimeout(r, 450))
    expect(replace).not.toHaveBeenCalled()
  })

  it('Previous / Next keep the search and move one page', () => {
    render(<StudentsClient initialStudents={[row('s1', 'Sara')]} total={150} page={2} pageCount={3} search="sara" />)
    expect(screen.getByText('prev').closest('a')?.getAttribute('href')).toBe('/admin/students?q=sara')
    expect(screen.getByText('next').closest('a')?.getAttribute('href')).toBe('/admin/students?q=sara&page=3')
    expect(screen.getByText('pageOf:2/3')).toBeTruthy()
  })

  it('a single page shows no pagination', () => {
    render(<StudentsClient initialStudents={[row('s1', 'Sara')]} total={1} page={1} pageCount={1} />)
    expect(screen.queryByText('next')).toBeNull()
  })

  it('a new page from the server replaces the rows', () => {
    const { rerender } = render(<StudentsClient initialStudents={[row('s1', 'Sara')]} total={2} />)
    rerender(<StudentsClient initialStudents={[row('s2', 'Omar')]} total={2} />)
    expect(screen.queryByText('Sara')).toBeNull()
    expect(screen.getByText('Omar')).toBeTruthy()
  })
})
