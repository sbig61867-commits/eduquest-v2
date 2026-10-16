import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

/**
 * The centre students list names the institution's own students after the
 * tenant's type (tenants.institution_type, src/content/terminology). QOU was
 * stored as 'school', so its centre manager saw «طالب مدرسة» and a button
 * «اعتباره طالب مدرسة» next to a university trainee (fixed in the data on
 * 2026-10-15). These pin the wording to the type, in Arabic, per row kind.
 */

const store = vi.hoisted(() => ({ tenant: { institution_type: 'university' } as { institution_type: string } | null }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/center/students',
  useSearchParams: () => new URLSearchParams(''),
}))
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${Object.values(vars).join('/')}` : key,
  useLocale: () => 'ar',
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}))
vi.mock('@/stores/auth-store', () => ({ useAuthStore: (sel: (s: unknown) => unknown) => sel(store) }))
vi.mock('@/components/shared/student-name-editor', () => ({ StudentNameEditor: () => null }))
vi.mock('@/components/ui/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { PeopleClient, type PersonRow } from '@/components/center/people-client'

const row = (id: string, isUniversityStudent: boolean): PersonRow => ({
  id, full_name: id, email: `${id}@x.test`, is_active: true, created_at: '2026-09-01T00:00:00Z',
  is_university_student: isUniversityStudent, locked: null, name_complete: true,
})
const paged = { total: 2, active: 2, page: 1, pageCount: 1, search: '' }

beforeEach(() => { store.tenant = { institution_type: 'university' } })

describe('centre students — wording follows the institution type', () => {
  it('university: a university student reads «طالب جامعة», never «مدرسة»', () => {
    render(<PeopleClient role="student" initialPeople={[row('u1', true)]} pagination={paged} />)
    expect(screen.getByText('طالب جامعة')).toBeTruthy()
    expect(document.body.textContent).not.toContain('مدرسة')
  })

  it('university: a centre trainee is a trainee, and the button offers «طالب جامعة»', () => {
    render(<PeopleClient role="student" canSetAffiliation initialPeople={[row('c1', false)]} pagination={paged} />)
    expect(screen.getByText('centreTrainee')).toBeTruthy()
    expect(screen.getByText('makeInstitution:طالب جامعة')).toBeTruthy()
    expect(document.body.textContent).not.toContain('مدرسة')
  })

  it('a missing tenant type falls back to the university wording', () => {
    store.tenant = null
    render(<PeopleClient role="student" initialPeople={[row('u1', true)]} pagination={paged} />)
    expect(screen.getByText('طالب جامعة')).toBeTruthy()
  })

  it('school wording appears only when the tenant really is a school', () => {
    store.tenant = { institution_type: 'school' }
    render(<PeopleClient role="student" initialPeople={[row('s1', true)]} pagination={paged} />)
    expect(screen.getByText('طالب مدرسة')).toBeTruthy()
  })
})
