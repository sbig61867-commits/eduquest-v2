import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

/**
 * Batch 2 — PeopleClient, shared by /center/students and /center/teachers: one
 * server page, search through the URL, counts from the database, Previous /
 * Next, and each list's own lock rules and actions.
 */

const replace = vi.fn()
const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, refresh, push: vi.fn() }),
  usePathname: () => '/center/students',
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
vi.mock('@/components/ui/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { PeopleClient, type PersonRow } from '@/components/center/people-client'

const row = (id: string, full_name: string, extra: Partial<PersonRow> = {}): PersonRow => ({
  id, full_name, email: `${id}@x.test`, is_active: true, created_at: '2026-09-01T00:00:00Z',
  is_university_student: false, locked: null, name_complete: true, ...extra,
})
const paged = (over: Partial<{ total: number; active: number; page: number; pageCount: number; search: string }> = {}) =>
  ({ total: 1, active: 1, page: 1, pageCount: 1, search: '', ...over })

const fetchMock = vi.fn()
beforeEach(() => {
  replace.mockReset(); refresh.mockReset()
  fetchMock.mockReset().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
  vi.stubGlobal('fetch', fetchMock)
})

describe('centre students — server pagination', () => {
  it('total and active come from the database, not from the rows on this page', () => {
    render(<PeopleClient role="student" initialPeople={[row('s1', 'Sara')]} pagination={paged({ total: 20000, active: 17143, pageCount: 400 })} />)
    expect(screen.getByText('student.summary:20000/17143')).toBeTruthy()
  })

  it('shows the incomplete-name flag from the row itself', () => {
    render(<PeopleClient role="student" initialPeople={[row('s1', 'Sara', { name_complete: false }), row('s2', 'Omar')]} pagination={paged({ total: 2 })} />)
    expect(screen.getAllByText('notFourPart')).toHaveLength(1)
  })

  it('typing searches through the URL after a short pause; nothing is filtered locally', async () => {
    render(<PeopleClient role="student" initialPeople={[row('s1', 'Sara'), row('s2', 'Omar')]} pagination={paged({ total: 2 })} />)
    fireEvent.change(screen.getByPlaceholderText('search'), { target: { value: 'om' } })
    expect(screen.getByText('Sara')).toBeTruthy()
    await waitFor(() => expect(replace).toHaveBeenCalledWith('?q=om'))
  })

  it('does not re-query when the box already matches the server search; clearing goes back to page 1', async () => {
    render(<PeopleClient role="student" initialPeople={[row('s1', 'Sara')]} pagination={paged({ search: 'sara' })} />)
    expect((screen.getByPlaceholderText('search') as HTMLInputElement).value).toBe('sara')
    await new Promise(r => setTimeout(r, 450))
    expect(replace).not.toHaveBeenCalled()
    fireEvent.change(screen.getByPlaceholderText('search'), { target: { value: '' } })
    await waitFor(() => expect(replace).toHaveBeenCalledWith('?'))
  })

  it('Previous / Next keep the search and move one page', () => {
    render(<PeopleClient role="student" initialPeople={[row('s1', 'Sara')]} pagination={paged({ total: 150, page: 2, pageCount: 3, search: 'sara' })} />)
    expect(screen.getByText('prev').closest('a')?.getAttribute('href')).toBe('/center/students?q=sara')
    expect(screen.getByText('next').closest('a')?.getAttribute('href')).toBe('/center/students?q=sara&page=3')
  })

  it('a new page from the server replaces the rows', () => {
    const { rerender } = render(<PeopleClient role="student" initialPeople={[row('s1', 'Sara')]} pagination={paged({ total: 2 })} />)
    rerender(<PeopleClient role="student" initialPeople={[row('s2', 'Omar')]} pagination={paged({ total: 2 })} />)
    expect(screen.queryByText('Sara')).toBeNull()
    expect(screen.getByText('Omar')).toBeTruthy()
  })

  it('a university-owned student stays locked (no toggle, no name correction); a centre trainee keeps both', () => {
    render(<PeopleClient role="student" initialPeople={[
      row('u1', 'Uni', { is_university_student: true, locked: 'universityStudent' }),
      row('c1', 'Centre'),
    ]} pagination={paged({ total: 2, active: 2 })} />)
    expect(screen.getAllByText('disable')).toHaveLength(1)
    expect(screen.getAllByText('correct')).toHaveLength(1)
    expect(screen.getAllByText(/^locked\.universityStudent/).length).toBeGreaterThan(0)
  })

  it('status toggle still goes through /api/admin/toggle-user, then refreshes the page', async () => {
    render(<PeopleClient role="student" initialPeople={[row('c1', 'Centre')]} pagination={paged()} />)
    fireEvent.click(screen.getByText('disable'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/toggle-user', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ userId: 'c1', isActive: false }),
    })))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it('affiliation toggle (announce_to_university) still goes through /api/admin/student-affiliation', async () => {
    render(<PeopleClient role="student" canSetAffiliation initialPeople={[row('c1', 'Centre')]} pagination={paged()} />)
    fireEvent.click(screen.getByText(/^makeInstitution/))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/student-affiliation', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ userId: 'c1', isUniversityStudent: true }),
    })))
  })
})

describe('centre teachers (/center/teachers) — server pagination', () => {
  const teacher = (id: string, name: string, locked: PersonRow['locked'], extra: Partial<PersonRow> = {}) =>
    row(id, name, { is_university_student: undefined, name_complete: undefined, locked, ...extra })

  it('counts come from the database; search goes through the URL', async () => {
    render(<PeopleClient role="teacher" initialPeople={[teacher('t1', 'Ali', null), teacher('t2', 'Huda', null)]}
      pagination={paged({ total: 2000, active: 1715, pageCount: 40 })} />)
    expect(screen.getByText('teacher.summary:2000/1715')).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('search'), { target: { value: 'hu' } })
    expect(screen.getByText('Ali')).toBeTruthy()
    await waitFor(() => expect(replace).toHaveBeenCalledWith('?q=hu'))
  })

  it('a shared or unassigned teacher is locked; a centre-only teacher keeps the toggle; no student-only actions', () => {
    render(<PeopleClient role="teacher" initialPeople={[
      teacher('t1', 'Shared', 'sharedTeacher'),
      teacher('t2', 'Unassigned', 'unassignedTeacher'),
      teacher('t3', 'Centre', null),
    ]} pagination={paged({ total: 3, active: 3 })} />)
    expect(screen.getAllByText('disable')).toHaveLength(1)
    expect(screen.getAllByText(/^locked\.sharedTeacher/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/^locked\.unassignedTeacher/).length).toBeGreaterThan(0)
    expect(screen.queryByText('correct')).toBeNull()
    expect(screen.queryByText(/^makeInstitution/)).toBeNull()
    expect(screen.queryByText('notFourPart')).toBeNull()
  })

  it('Previous / Next move one page', () => {
    render(<PeopleClient role="teacher" initialPeople={[teacher('t1', 'Ali', null)]} pagination={paged({ total: 120, page: 1, pageCount: 3 })} />)
    expect(screen.getByText('next').closest('a')?.getAttribute('href')).toBe('/center/students?q=sara&page=2')
  })
})
