import { describe, it, expect, vi } from 'vitest'
import { render as rtlRender, screen, fireEvent, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import arMessages from '@/messages/ar'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

import { AnnouncementsManager, type AnnouncementRow } from '@/components/announcements/announcements-manager'

const render = (ui: React.ReactElement) =>
  rtlRender(<NextIntlClientProvider locale="ar" messages={arMessages}>{ui}</NextIntlClientProvider>)

const row = (over: Partial<AnnouncementRow>): AnnouncementRow => ({
  id: 'x', title: 'عنوان', body: null, image_url: null, link_url: null, cta_label: null,
  audience: 'all', center_students_only: false, is_published: true, starts_at: null, ends_at: null,
  created_at: '2026-09-20T10:00:00Z', group_ids: [], pinned: false, collect_interest: false, stats: null, ...over,
})

const rows = [
  row({ id: 'live', title: 'التسجيل مفتوح', collect_interest: true, pinned: true,
        link_url: 'https://wa.me/966500000000', stats: { views: 12, clicks: 3, interest: 5 } }),
  row({ id: 'draft', title: 'مسودة الامتحان', is_published: false, stats: { views: 0, clicks: 0, interest: 0 } }),
  row({ id: 'ended', title: 'إعلان قديم', ends_at: '2026-01-01T00:00:00Z', stats: { views: 40, clicks: 0, interest: 0 } }),
]

describe('announcements manager', () => {
  it('filters by status and searches', () => {
    render(<AnnouncementsManager announcements={rows} groups={[]} canTargetUniversity engagementReady />)
    const tabs = screen.getByRole('tablist')
    fireEvent.click(within(tabs).getByRole('tab', { name: /مسودة/ }))
    expect(screen.getByText('مسودة الامتحان')).toBeInTheDocument()
    expect(screen.queryByText('التسجيل مفتوح')).toBeNull()

    fireEvent.click(within(tabs).getByRole('tab', { name: /الكل/ }))
    fireEvent.change(screen.getByPlaceholderText('ابحث في الإعلانات…'), { target: { value: 'قديم' } })
    expect(screen.getByText('إعلان قديم')).toBeInTheDocument()
    expect(screen.queryByText('مسودة الامتحان')).toBeNull()
  })

  it('shows engagement numbers and the interested list entry point', () => {
    render(<AnnouncementsManager announcements={rows} groups={[]} canTargetUniversity engagementReady />)
    expect(screen.getByText('12 مشاهدةً')).toBeInTheDocument()
    expect(screen.getByText('3 نقرات')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /5 مهتم/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /تمديد أسبوع/ })).toBeInTheDocument() // the ended one
  })

  it('hides pinning and interest until the migration is applied', () => {
    render(<AnnouncementsManager announcements={rows.map(r => ({ ...r, stats: null }))} groups={[]} canTargetUniversity />)
    expect(screen.queryByRole('button', { name: /^تثبيت$/ })).toBeNull()
    expect(screen.queryByText('12 مشاهدةً')).toBeNull()
  })

  it('duplicates an announcement into a new unpublished draft', () => {
    render(<AnnouncementsManager announcements={rows} groups={[]} canTargetUniversity engagementReady />)
    window.scrollTo = vi.fn()
    fireEvent.click(screen.getAllByRole('button', { name: /نسخ$/ })[0])
    expect(screen.getByDisplayValue('نسخة من التسجيل مفتوح')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'نشر الإعلان' })).not.toBeChecked()
  })
})
