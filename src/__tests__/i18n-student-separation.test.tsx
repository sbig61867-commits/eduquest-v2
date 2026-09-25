/**
 * Phase 1 acceptance: the student UI is Arabic OR English, never a mix.
 *
 * The previous "Arabic UI" work swapped English literals for Arabic ones in
 * place, so a screen could only ever be one language and switching the locale
 * changed nothing. These tests render the same component under each locale
 * and assert both that the right words appear AND that none of the other
 * language's words leak through — which is the part a translation-in-place
 * approach can never satisfy.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'

import ar from '@/messages/ar'
import en from '@/messages/en'
import { LOCALES, type Locale } from '@/i18n/config'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/student/exams',
}))

import { StudentExamsClient } from '@/app/(student)/student/exams/exams-client'

const MESSAGES: Record<Locale, unknown> = { ar, en }

const exam = (over: Record<string, unknown> = {}) => ({
  id: 'e1', tenant_id: 't1', group_id: 'g1', teacher_id: 'u2',
  title: 'Midterm', duration_minutes: 60, questions: [], is_published: true,
  proctoring_enabled: false, starts_at: null, ends_at: null,
  created_at: '2026-09-01T00:00:00Z', type: 'exam',
  groups: { name: 'Group A' }, courses: null, ...over,
})

function renderIn(locale: Locale) {
  return render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale] as never}>
      <StudentExamsClient
        availableExams={[exam(), exam({ id: 'h1', type: 'homework', duration_minutes: 43200 })] as never}
        completedExams={[]}
        submissions={[]}
        userId="u1"
      />
    </NextIntlClientProvider>
  )
}

const ARABIC = /[؀-ۿ]/

describe('student UI — one language at a time', () => {
  it('renders the exams screen fully in Arabic under ar', () => {
    renderIn('ar')
    expect(screen.getByText('اختباراتي')).toBeInTheDocument()
    expect(screen.getAllByText('بدء الاختبار').length).toBeGreaterThan(0)
    expect(screen.getAllByText('حل الواجب').length).toBeGreaterThan(0)
    // None of the English equivalents may appear.
    expect(screen.queryByText('My Exams')).toBeNull()
    expect(screen.queryByText('Start exam')).toBeNull()
  })

  it('renders the same screen fully in English under en', () => {
    renderIn('en')
    expect(screen.getByText('My Exams')).toBeInTheDocument()
    expect(screen.getAllByText('Start exam').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Start homework').length).toBeGreaterThan(0)
    expect(screen.queryByText('اختباراتي')).toBeNull()
    expect(screen.queryByText('بدء الاختبار')).toBeNull()
  })

  it('leaks no Arabic character anywhere in the English render', () => {
    const { container } = renderIn('en')
    // Data (group names, exam titles) is the tenant's own and is not
    // translated — this fixture deliberately uses Latin data so any Arabic
    // found here can only have come from a hardcoded UI string.
    const stray = (container.textContent ?? '')
      .split(/\s+/)
      .filter(w => ARABIC.test(w))
    expect(stray, 'hardcoded Arabic survived into the English UI').toEqual([])
  })

  it('covers every configured locale', () => {
    expect([...LOCALES].sort()).toEqual(['ar', 'en'])
  })
})
