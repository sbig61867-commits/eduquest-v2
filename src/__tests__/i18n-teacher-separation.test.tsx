/**
 * Phase 2 acceptance: the teacher UI is Arabic OR English, never a mix.
 *
 * Mirrors the Phase 1 student test. Rendering the same component under each
 * locale is the only check a translation-in-place approach cannot pass: it
 * proves the strings come from the message files rather than the source.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'

import ar from '@/messages/ar'
import en from '@/messages/en'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/teacher/lessons',
}))

import { LessonsClient } from '@/app/(teacher)/teacher/lessons/lessons-client'

const MESSAGES = { ar, en } as Record<'ar' | 'en', unknown>

// Latin-only fixture data, so any Arabic in the English render can only have
// come from a hardcoded UI string.
const lessons = [
  {
    id: 'l1', title: 'Kinematics', content: 'Displacement and velocity.',
    is_published: true, created_at: '2026-09-01T00:00:00Z',
    groups: { name: 'Physics 101' },
  },
  {
    id: 'l2', title: 'Thermodynamics', content: null,
    is_published: false, created_at: '2026-09-02T00:00:00Z',
    groups: { name: 'Physics 101' },
  },
]

function renderIn(locale: 'ar' | 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale] as never}>
      <LessonsClient initialLessons={lessons} groups={[{ id: 'g1', name: 'Physics 101' }]} />
    </NextIntlClientProvider>
  )
}

const ARABIC = /[؀-ۿ]/

describe('teacher UI — one language at a time', () => {
  it('renders the lessons screen fully in Arabic under ar', () => {
    renderIn('ar')
    expect(screen.getByText('الدروس')).toBeInTheDocument()
    expect(screen.getByText('درس جديد')).toBeInTheDocument()
    expect(screen.getByText('منشور')).toBeInTheDocument()
    expect(screen.getByText('مسودة')).toBeInTheDocument()
    expect(screen.queryByText('Lessons')).toBeNull()
    expect(screen.queryByText('New Lesson')).toBeNull()
  })

  it('renders the same screen fully in English under en', () => {
    renderIn('en')
    expect(screen.getByText('Lessons')).toBeInTheDocument()
    expect(screen.getByText('New Lesson')).toBeInTheDocument()
    expect(screen.getByText('Published')).toBeInTheDocument()
    expect(screen.getByText('Draft')).toBeInTheDocument()
    expect(screen.queryByText('الدروس')).toBeNull()
    expect(screen.queryByText('درس جديد')).toBeNull()
  })

  it('leaks no Arabic character anywhere in the English render', () => {
    const { container } = renderIn('en')
    const stray = (container.textContent ?? '')
      .split(/\s+/)
      .filter(w => ARABIC.test(w))
    expect(stray, 'hardcoded Arabic survived into the English teacher UI').toEqual([])
  })
})
