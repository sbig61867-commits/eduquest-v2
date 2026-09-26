/**
 * Renders the real shell/pages with the auth store set up as each kind of
 * account would have it, to verify what each user actually sees:
 *   - university admin on an existing tenant (flat, has a centre)
 *   - admin of a school without a centre
 *   - admin of a tenant switched to the academic structure
 *   - a university student vs a centre trainee
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render as rtlRender, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'

import arMessages from '@/messages/ar'
import type { Tenant, User } from '@/types'
import { useAuthStore } from '@/stores/auth-store'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/admin/dashboard',
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { signOut: vi.fn() } }) }))
vi.mock('@/components/shared/notification-bell', () => ({ NotificationBell: () => null }))

import { Sidebar, type NavItem } from '@/components/shared/sidebar'
import { Header } from '@/components/shared/header'
import { StudentProfileClient } from '@/app/(student)/student/profile/profile-client'
import { StudentsClient } from '@/app/(admin)/admin/students/students-client'

const tenant = (over: Partial<Tenant>): Tenant => ({
  id: 't1', name: 'QOU', slug: 'qou', logo_url: null, is_active: true, created_at: '2026-09-01T00:00:00Z',
  institution_type: 'university', structure_mode: 'flat', has_center: true, ...over,
})
const user = (over: Partial<User>): User => ({
  id: 'u1', email: 'x@y.z', full_name: 'Dr Test', avatar_url: null, role: 'university_admin',
  tenant_id: 't1', is_active: true, can_create_courses: false, created_at: '2026-09-01T00:00:00Z', ...over,
})
const signIn = (u: User, t: Tenant) => useAuthStore.setState({ user: u, tenant: t, isLoading: false })

// The shell reads from the message layer now (the locale switcher in the
// header, the student pages), so these renders need the same provider the
// real layouts mount. Pinned to the default locale: these tests assert what
// an Arabic-locale user sees, which is what they asserted before i18n.
const render = (ui: React.ReactElement) =>
  rtlRender(
    <NextIntlClientProvider locale="ar" messages={arMessages}>
      {ui}
    </NextIntlClientProvider>
  )

// The admin sidebar exactly as src/app/(admin)/layout.tsx declares it
const ADMIN_NAV: NavItem[] = [
  { label: 'Dashboard', href: '/admin/dashboard', icon: 'LayoutDashboard' },
  { label: 'Academic', href: '/admin/academic', icon: 'Network', academicOnly: true },
  { label: 'Groups', href: '/admin/groups', icon: 'Layers', term: 'groups' },
  { label: 'Centre Staff', href: '/admin/center-staff', icon: 'ShieldCheck', centerOnly: true },
]

beforeEach(() => useAuthStore.setState({ user: null, tenant: null, isLoading: false }))

describe('university admin — existing tenant (flat, has centre)', () => {
  it('sees the original menu: no Academic, Centre Staff present, University Admin title', () => {
    signIn(user({}), tenant({}))
    render(<Sidebar items={ADMIN_NAV} title="University Admin" titleTerm="institutionAdmin" />)
    expect(screen.queryByText('Academic')).toBeNull()
    expect(screen.getByText('Centre Staff')).toBeInTheDocument()
    expect(screen.getByText('المجموعات')).toBeInTheDocument()
    expect(screen.getByText('مدير الجامعة')).toBeInTheDocument()
  })

  it('header shows University Admin · QOU', () => {
    signIn(user({}), tenant({}))
    render(<Header title="Admin Panel" />)
    expect(screen.getByText(/مدير الجامعة/)).toBeInTheDocument()
  })
})

describe('school admin — no centre', () => {
  it('menu uses school wording and hides centre staff', () => {
    signIn(user({}), tenant({ institution_type: 'school', has_center: false }))
    render(<Sidebar items={ADMIN_NAV} title="University Admin" titleTerm="institutionAdmin" />)
    expect(screen.getByText('مدير المدرسة')).toBeInTheDocument()
    expect(screen.getByText('الفصول')).toBeInTheDocument()
    expect(screen.queryByText('Centre Staff')).toBeNull()
    expect(screen.queryByText('Academic')).toBeNull()
  })

  it('students list shows no university/centre badges', () => {
    signIn(user({}), tenant({ institution_type: 'school', has_center: false }))
    render(<StudentsClient hasCenter={false} initialStudents={[user({ id: 's1', role: 'student', full_name: 'Sara', is_university_student: false })]} />)
    expect(screen.getByText('Sara')).toBeInTheDocument()
    expect(screen.queryByText('Centre trainee')).toBeNull()
  })
})

describe('admin — tenant switched to the academic structure', () => {
  it('Academic link appears', () => {
    signIn(user({}), tenant({ structure_mode: 'academic' }))
    render(<Sidebar items={ADMIN_NAV} title="University Admin" titleTerm="institutionAdmin" />)
    expect(screen.getByText('Academic')).toBeInTheDocument()
  })
})

describe('students', () => {
  const profile = { id: 's1', full_name: 'Sara', email: 's@x', role: 'student', is_active: true, created_at: '2026-09-01T00:00:00Z', tenants: { name: 'QOU', slug: 'qou' } }

  it('centre trainee: Centre Trainee title/header and the centre card, never faculties', () => {
    signIn(user({ role: 'student', is_university_student: false }), tenant({}))
    const { unmount } = render(<Sidebar items={[]} title="طالب" centreTraineeTitle="متدرب التعليم المستمر" />)
    expect(screen.getByText('متدرب التعليم المستمر')).toBeInTheDocument()
    unmount()
    render(<Header title="بوابة الطالب" />)
    expect(screen.getByText(/متدرب التعليم المستمر/)).toBeInTheDocument()
  })

  it('centre trainee profile shows the centre card and no faculty block', () => {
    signIn(user({ role: 'student', is_university_student: false }), tenant({}))
    render(<StudentProfileClient profile={profile} groups={[]}
      affiliation={{ track: 'centre', unitL1Label: 'Faculty', unitL2Label: 'Department', units: [{ l1: 'Science', l2: 'CS' }] }} />)
    expect(screen.getByText('متدرب مركز التعليم المستمر')).toBeInTheDocument()
    expect(screen.queryByText(/Science/)).toBeNull()
  })

  it('university student: Student title and faculty › department on profile', () => {
    signIn(user({ role: 'student', is_university_student: true }), tenant({ structure_mode: 'academic' }))
    const { unmount } = render(<Sidebar items={[]} title="طالب" centreTraineeTitle="متدرب التعليم المستمر" />)
    expect(screen.getByText('طالب')).toBeInTheDocument()
    unmount()
    render(<StudentProfileClient profile={profile} groups={[]}
      affiliation={{ track: 'institution', unitL1Label: 'Faculty', unitL2Label: 'Department', units: [{ l1: 'Science', l2: 'CS' }] }} />)
    expect(screen.getByText('Science › CS')).toBeInTheDocument()
    expect(screen.queryByText('متدرب مركز التعليم المستمر')).toBeNull()
  })

  it('trainee flag is ignored in a tenant without a centre', () => {
    signIn(user({ role: 'student', is_university_student: false }), tenant({ has_center: false, institution_type: 'school' }))
    render(<Sidebar items={[]} title="طالب" centreTraineeTitle="متدرب التعليم المستمر" />)
    expect(screen.getByText('طالب')).toBeInTheDocument()
  })
})

describe('dates', () => {
  it('formatDate pins Gregorian + Latin digits under RTL (no "١٥ ٢٠٢٦" / hijri drift)', async () => {
    const { formatDate } = await import('@/lib/utils')
    expect(formatDate('2026-09-15T12:00:00Z', 'ar')).toBe('15 سبتمبر 2026')
  })
})
