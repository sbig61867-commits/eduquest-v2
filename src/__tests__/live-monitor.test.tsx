import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'

// The teacher's monitoring page, with a fake Realtime client: students come
// from presence (no table read), the wall shows only validated pictures, and
// the 'last 30 s' button broadcasts to that one student.

const channels: Record<string, { handlers: Record<string, (m: unknown) => void>; sent: unknown[]; state: Record<string, unknown[]> }> = {}
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    realtime: { setAuth: async () => {} },
    channel: (topic: string) => {
      const rec = channels[topic] ??= { handlers: {}, sent: [], state: {} }
      const ch = {
        on: (type: string, filter: { event: string }, fn: (m: unknown) => void) => { rec.handlers[`${type}:${filter.event}`] = fn; return ch },
        subscribe: (cb: (s: string) => void) => { setTimeout(() => cb('SUBSCRIBED'), 0); return ch },
        track: async () => {},
        send: async (msg: unknown) => { rec.sent.push(msg); return 'ok' },
        presenceState: () => rec.state,
      }
      return ch
    },
    removeChannel: () => {},
    from: () => ({ select: () => ({ in: async () => ({ data: [{ id: S1, full_name: 'Sara' }, { id: S2, full_name: 'Omar' }] }) }) }),
  }),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }) }))
vi.mock('next-intl', () => ({
  useTranslations: () => Object.assign((key: string, v?: Record<string, unknown>) => (v?.count !== undefined ? `${key}:${v.count}` : key), { has: () => true }),
  useLocale: () => 'en',
}))
vi.mock('@/components/ui/toast', () => ({ toast: Object.assign(() => {}, { success: () => {}, error: () => {} }) }))
vi.mock('@/app/(teacher)/teacher/proctoring/live/[examId]/evidence-panel', () => ({ EvidencePanel: () => null }))

import { LiveMonitor } from '@/app/(teacher)/teacher/proctoring/live/[examId]/live-monitor'

const EXAM = '11111111-1111-4111-8111-111111111111'
const S1 = '22222222-2222-4222-8222-222222222222'
const S2 = '33333333-3333-4333-8333-333333333333'

describe('teacher live monitor', () => {
  beforeEach(() => { for (const k of Object.keys(channels)) delete channels[k] })

  it('lists students from presence with their counts, without video', async () => {
    render(<LiveMonitor examId={EXAM} examTitle="Quiz" liveConfigured={false} />)
    await waitFor(() => expect(channels[`exam-live:${EXAM}`]).toBeTruthy())
    const live = channels[`exam-live:${EXAM}`]
    live.state = { teacher: [{}], [S1]: [{ v: 3, ev: 1 }], [S2]: [{ v: 0, ev: 0 }], 'not-a-uuid': [{ v: 99 }] }
    act(() => live.handlers['presence:sync']({}))
    expect(await screen.findByText('Sara')).toBeTruthy()
    expect(screen.getByText('Omar')).toBeTruthy()
    expect(screen.getByText('violationsCount:3')).toBeTruthy()
    expect(screen.queryByText('violationsCount:99')).toBeNull() // junk presence keys are ignored
  })

  it('asks one student for the last 30 seconds', async () => {
    render(<LiveMonitor examId={EXAM} examTitle="Quiz" liveConfigured={false} />)
    await waitFor(() => expect(channels[`exam-live:${EXAM}`]).toBeTruthy())
    const live = channels[`exam-live:${EXAM}`]
    live.state = { [S1]: [{ v: 0, ev: 0 }] }
    act(() => live.handlers['presence:sync']({}))
    await screen.findByText('Sara')
    fireEvent.click(screen.getByText('clipLast30'))
    expect(live.sent).toContainEqual({ type: 'broadcast', event: 'clip', payload: { ids: [S1], seconds: 30 } })
  })

  it('shows wall pictures, but only real image data', async () => {
    render(<LiveMonitor examId={EXAM} examTitle="Quiz" liveConfigured={false} />)
    await waitFor(() => expect(channels[`exam-live:${EXAM}`]).toBeTruthy())
    const live = channels[`exam-live:${EXAM}`]
    live.state = { [S1]: [{ v: 0, ev: 0 }], [S2]: [{ v: 0, ev: 0 }] }
    act(() => live.handlers['presence:sync']({}))
    await screen.findByText('Sara')

    fireEvent.click(screen.getByText('wallStart'))
    expect(live.sent).toContainEqual({ type: 'broadcast', event: 'thumbs', payload: { on: true } })
    await waitFor(() => expect(channels[`exam-thumbs:${EXAM}`]).toBeTruthy())
    const thumbs = channels[`exam-thumbs:${EXAM}`]
    act(() => thumbs.handlers['broadcast:thumb']({ payload: { id: S1, img: 'data:image/webp;base64,AAAA' } }))
    act(() => thumbs.handlers['broadcast:thumb']({ payload: { id: S2, img: 'javascript:alert(1)' } }))
    const imgs = document.querySelectorAll('img')
    expect(imgs).toHaveLength(1)
    expect(imgs[0].getAttribute('src')).toBe('data:image/webp;base64,AAAA')

    fireEvent.click(screen.getByText('wallStop'))
    expect(live.sent).toContainEqual({ type: 'broadcast', event: 'thumbs', payload: { on: false } })
  })
})
