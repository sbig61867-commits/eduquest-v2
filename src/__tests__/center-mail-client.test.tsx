import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

/**
 * Batch 2 — Centre Mail component. No student body and no member list reach
 * it: students come from /api/mail/recipients?q= (≤ 20), a whole group stays a
 * group id (count from the server), and the send carries recipient_ids +
 * group_ids. The confirmation names the server's exact count.
 */

// Stable like next-intl's own `t` (the component reloads the mailbox status when `t` changes).
const tStable = Object.assign(
  (key: string, vars?: Record<string, unknown>) => `${key}${vars ? ':' + Object.values(vars).join('/') : ''}`,
  { rich: (key: string) => key },
)
vi.mock('next-intl', () => ({ useTranslations: () => tStable }))
const toastError = vi.fn()
vi.mock('@/components/ui/toast', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: (m: string) => toastError(m) } }))
const confirm = vi.fn<(msg: string) => Promise<boolean>>(async () => true)
vi.mock('@/lib/confirm-dialog', () => ({ confirmDialog: (m: string) => confirm(m) }))

import { MailClient } from '@/components/mail/mail-client'

const GROUPS = [{ id: 'g1', name: 'Morning', member_count: 19 }, { id: 'g2', name: 'Evening', member_count: 7 }]
let previewCount: number | { status: number; error: string }
const fetchMock = vi.fn()
const calls = (prefix: string, method = 'GET') => fetchMock.mock.calls.filter(([u, i]) => String(u).startsWith(prefix) && (i?.method ?? 'GET') === method)

beforeEach(() => {
  toastError.mockReset(); confirm.mockClear()
  previewCount = 12
  fetchMock.mockReset().mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/mail/connection') return { ok: true, json: async () => ({ configured: { google: true }, connections: [{ provider: 'google', email: 'me@inst.edu', status: 'active', last_error: null }] }) }
    if (url.startsWith('/api/mail/recipients?')) {
      const q = new URL(url, 'http://x').searchParams.get('q')
      return { ok: true, json: async () => ({ students: q === 'huda' ? [{ id: 's1', name: 'Huda Saleh', email: 'huda@x.edu' }, { id: 's2', name: 'Huda Omar', email: 'ho@x.edu' }] : [] }) }
    }
    if (url === '/api/mail/recipients' && init?.method === 'POST') {
      if (typeof previewCount === 'number') { const c = previewCount; return { ok: true, json: async () => ({ count: c }) } }
      const e = previewCount; return { ok: false, json: async () => ({ error: e.error }) }
    }
    if (url === '/api/mail/send') return { ok: true, json: async () => ({ sent: 3, failed: 0, skipped: 0 }) }
    return { ok: false, json: async () => ({}) }
  })
  vi.stubGlobal('fetch', fetchMock)
})

async function ready() {
  render(<MailClient groups={GROUPS} />)
  await waitFor(() => expect(screen.getByPlaceholderText('searchRecipient')).toBeTruthy())
}
const type = (v: string) => fireEvent.change(screen.getByPlaceholderText('searchRecipient'), { target: { value: v } })
const fill = () => {
  fireEvent.change(screen.getByText('subject').parentElement!.querySelector('input')!, { target: { value: 'Hi' } })
  fireEvent.change(screen.getByText('body').parentElement!.querySelector('textarea')!, { target: { value: 'Text' } })
}
const sendBody = () => JSON.parse(String(calls('/api/mail/send', 'POST')[0][1].body))

describe('Centre Mail — recipients on demand, groups by id', () => {
  it('lists no student until the user types; the group menu shows each group size from the page', async () => {
    await ready()
    expect(screen.getByText('typeToSearch')).toBeTruthy()
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(screen.getByText('Morning (19)')).toBeTruthy()
    await act(() => new Promise(r => setTimeout(r, 400)))
    expect(calls('/api/mail/recipients?')).toHaveLength(0)
  })

  it('ONE search per pause; ticking keeps the pick (name + email) when the search text is cleared', async () => {
    await ready()
    for (const v of ['h', 'hu', 'hud', 'huda']) type(v)
    await waitFor(() => expect(screen.getByText('Huda Saleh')).toBeTruthy())
    expect(calls('/api/mail/recipients?')).toHaveLength(1)
    expect(calls('/api/mail/recipients?')[0][0]).toBe('/api/mail/recipients?q=huda')
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    type('')
    expect(screen.getByText('Huda Saleh')).toBeTruthy()
    expect(screen.getByText('huda@x.edu')).toBeTruthy()
    expect(screen.getByText('selectedCount:1')).toBeTruthy()
  })

  it('a whole group is kept as its id; the count comes from the server; the send carries group_ids', async () => {
    await ready()
    type('huda')
    await waitFor(() => expect(screen.getByText('Huda Saleh')).toBeTruthy())
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    fireEvent.change(screen.getByDisplayValue('addGroup'), { target: { value: 'g1' } })
    expect(screen.getByText('wholeGroup:Morning (19)')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('selectedCount:12')).toBeTruthy())
    expect(JSON.parse(String(calls('/api/mail/recipients', 'POST')[0][1].body))).toEqual({ recipient_ids: ['s1'], group_ids: ['g1'] })

    fill()
    fireEvent.click(screen.getByText('send'))
    await waitFor(() => expect(calls('/api/mail/send', 'POST')).toHaveLength(1))
    expect(confirm).toHaveBeenCalledWith('sendConfirm:me@inst.edu/12')
    expect(sendBody()).toEqual({ recipient_ids: ['s1'], group_ids: ['g1'], subject: 'Hi', body: 'Text' })
  })

  it('a group the server refuses (e.g. over the limit) is reported before any confirmation or send', async () => {
    await ready()
    fireEvent.change(screen.getByDisplayValue('addGroup'), { target: { value: 'g2' } })
    previewCount = { status: 400, error: '50 recipients max per send' }
    fill()
    fireEvent.click(screen.getByText('send'))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('50 recipients max per send'))
    expect(confirm).not.toHaveBeenCalled()
    expect(calls('/api/mail/send', 'POST')).toHaveLength(0)
  })

  it('removing a group or clearing the selection drops it from the send', async () => {
    await ready()
    fireEvent.change(screen.getByDisplayValue('addGroup'), { target: { value: 'g1' } })
    fireEvent.change(screen.getByDisplayValue('addGroup'), { target: { value: 'g2' } })
    fireEvent.click(screen.getAllByLabelText('remove')[0])
    expect(screen.queryByText('wholeGroup:Morning (19)')).toBeNull()
    fill()
    fireEvent.click(screen.getByText('send'))
    await waitFor(() => expect(calls('/api/mail/send', 'POST')).toHaveLength(1))
    expect(sendBody().group_ids).toEqual(['g2'])
    // after a successful send everything is cleared
    await waitFor(() => expect(screen.queryByText('wholeGroup:Evening (7)')).toBeNull())
  })

  it('nothing chosen → the same «choose a recipient» message, no request', async () => {
    await ready()
    fill()
    fireEvent.click(screen.getByText('send'))
    expect(toastError).toHaveBeenCalledWith('pickRecipient')
    expect(calls('/api/mail/send', 'POST')).toHaveLength(0)
  })
})
