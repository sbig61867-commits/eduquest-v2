import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render as rtlRender, screen, fireEvent, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import arMessages from '@/messages/ar'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }))

import { AnnouncementsBanner, type StudentAnnouncement } from '@/components/student/announcements-banner'

const render = (ui: React.ReactElement) =>
  rtlRender(<NextIntlClientProvider locale="ar" messages={arMessages}>{ui}</NextIntlClientProvider>)

const base: StudentAnnouncement = {
  id: 'a1', title: 'دورة جديدة', body: 'سجّل هنا https://forms.gle/abc123. شكراً',
  image_url: null, link_url: null, cta_label: null,
}

describe('announcement banner — engagement', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetchMock)
    sessionStorage.clear()
    refresh.mockClear()
  })

  it('makes links in the body clickable, without the trailing full stop', () => {
    render(<AnnouncementsBanner announcements={[base]} />)
    const link = screen.getByRole('link', { name: 'https://forms.gle/abc123' })
    expect(link).toHaveAttribute('href', 'https://forms.gle/abc123')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('records one view per session for the student, never for other viewers', () => {
    const { unmount } = render(<AnnouncementsBanner announcements={[base]} />)
    expect(fetchMock).not.toHaveBeenCalled()
    unmount()
    render(<AnnouncementsBanner announcements={[base]} track />)
    render(<AnnouncementsBanner announcements={[base]} track />)
    const views = fetchMock.mock.calls.filter(c => JSON.parse(c[1].body).kind === 'view')
    expect(views).toHaveLength(1)
  })

  it('shows "I\'m interested" only where the author asked for it, and records it', async () => {
    const { rerender } = render(<AnnouncementsBanner announcements={[base]} track />)
    expect(screen.queryByRole('button', { name: /أنا مهتم/ })).toBeNull()
    rerender(
      <NextIntlClientProvider locale="ar" messages={arMessages}>
        <AnnouncementsBanner announcements={[{ ...base, collect_interest: true }]} track />
      </NextIntlClientProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: /أنا مهتم/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: /سجّلت اهتمامك/ })).toBeInTheDocument())
    const call = fetchMock.mock.calls.find(c => JSON.parse(c[1].body).kind === 'interest')!
    expect(call[1].method).toBe('POST')
    expect(refresh).toHaveBeenCalled()
  })

  it('warns when the announcement ends within three days, and shows the pin', () => {
    const ends = new Date(Date.now() + 2 * 24 * 3600 * 1000 - 60_000).toISOString()
    render(<AnnouncementsBanner announcements={[{ ...base, ends_at: ends, pinned: true }]} />)
    expect(screen.getByText('ينتهي خلال يومين')).toBeInTheDocument()
    expect(screen.getByText('مثبّت')).toBeInTheDocument()
  })
})
