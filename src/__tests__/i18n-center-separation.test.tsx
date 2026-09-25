/**
 * Phase 3 acceptance: the centre-manager UI is Arabic OR English, never a mix.
 *
 * Mirrors the Phase 1 (student) and Phase 2 (teacher) tests. This one matters
 * more than either, because the centre pages are the part of the migration I
 * could not sign in to check by hand — this is the standing proof that their
 * strings come from the message files rather than the source.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'

import ar from '@/messages/ar'
import en from '@/messages/en'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/center/groups',
}))

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (sel?: (s: unknown) => unknown) => {
    const state = { tenant: { institution_type: 'training_center', has_center: true }, user: null }
    return sel ? sel(state) : state
  },
}))

import { CenterGroupsClient } from '@/components/center/groups-client'

const MESSAGES = { ar, en } as Record<'ar' | 'en', unknown>

// Latin-only fixture data, so any Arabic in the English render can only have
// come from a hardcoded UI string.
const groups = [
  {
    id: 'g1', name: 'Morning Cohort', description: 'Level A1',
    is_active: true, teacher_id: 't1', student_count: 12,
    course_id: null, image_url: null, max_students: null, instructions: null,
  },
  {
    id: 'g2', name: 'Evening Cohort', description: null,
    is_active: false, teacher_id: 't1', student_count: 4,
    course_id: null, image_url: null, max_students: null, instructions: null,
  },
]

function renderIn(locale: 'ar' | 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale] as never}>
      <CenterGroupsClient
        initialGroups={groups}
        teachers={[{ id: 't1', name: 'Sara Idris' }]}
        students={[]}
        courses={[]}
      />
    </NextIntlClientProvider>
  )
}

const ARABIC = /[؀-ۿ]/

describe('centre UI — one language at a time', () => {
  it('renders the groups screen fully in Arabic under ar', () => {
    renderIn('ar')
    expect(screen.getByText('المجموعات')).toBeInTheDocument()
    expect(screen.getByText('مجموعة جديدة')).toBeInTheDocument()
    expect(screen.getByText('نشطة')).toBeInTheDocument()
    expect(screen.queryByText('Groups')).toBeNull()
    expect(screen.queryByText('New Group')).toBeNull()
  })

  it('renders the same screen fully in English under en', () => {
    renderIn('en')
    expect(screen.getByText('Groups')).toBeInTheDocument()
    expect(screen.getByText('New Group')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.queryByText('المجموعات')).toBeNull()
    expect(screen.queryByText('مجموعة جديدة')).toBeNull()
  })

  it('leaks no Arabic character anywhere in the English render', () => {
    const { container } = renderIn('en')
    const stray = (container.textContent ?? '')
      .split(/\s+/)
      .filter(w => ARABIC.test(w))
    expect(stray, 'hardcoded Arabic survived into the English centre UI').toEqual([])
  })

  it('resolves tenant vocabulary through the locale, not the default', () => {
    // A training centre calls a group a "Cohort" in English and a "دفعة" in
    // Arabic. Both come from the terminology overlay, which every call site
    // used to read without a locale — so the English half was unreachable.
    renderIn('en')
    expect(screen.queryByText('الدفعات')).toBeNull()
  })
})
