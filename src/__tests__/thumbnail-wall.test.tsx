import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { THUMBS_TIMEOUT_MS, THUMB_EVERY_MS } from '@/lib/live-channel'

// A fake Supabase Realtime client: records handlers, lets the test broadcast.
const handlers: Record<string, (msg: { payload: unknown }) => void> = {}
const httpSend = vi.fn()
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    realtime: { setAuth: async () => {} },
    channel: () => {
      const ch = {
        on: (_type: string, filter: { event: string }, fn: (msg: { payload: unknown }) => void) => { handlers[filter.event] = fn; return ch },
        subscribe: (cb: (s: string) => void) => { cb('SUBSCRIBED'); return ch },
        track: async () => {},
        httpSend,
      }
      return ch
    },
    removeChannel: () => {},
  }),
}))

import { useExamLiveChannel } from '@/hooks/use-exam-live-channel'
import { useThumbnailSender } from '@/hooks/use-thumbnail-sender'

async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve() }) }

describe('thumbnail wall — student side', () => {
  beforeEach(() => { vi.useFakeTimers(); for (const k of Object.keys(handlers)) delete handlers[k]; httpSend.mockReset() })
  afterEach(() => vi.useRealTimers())

  it('turns on when the teacher says so and off by itself after silence', async () => {
    const { result } = renderHook(() => useExamLiveChannel('e1', 'u1', true, { v: 0, ev: 0 }))
    await flush()
    expect(result.current.thumbsOn).toBe(false)
    act(() => handlers.thumbs({ payload: { on: true } }))
    expect(result.current.thumbsOn).toBe(true)
    // A keep-alive resets the timer…
    act(() => { vi.advanceTimersByTime(THUMBS_TIMEOUT_MS - 1_000) })
    act(() => handlers.thumbs({ payload: { on: true } }))
    act(() => { vi.advanceTimersByTime(THUMBS_TIMEOUT_MS - 1_000) })
    expect(result.current.thumbsOn).toBe(true)
    // …and silence (a closed teacher tab) switches it off.
    act(() => { vi.advanceTimersByTime(2_000) })
    expect(result.current.thumbsOn).toBe(false)
  })

  it('turns off at once when the teacher hides the wall', async () => {
    const { result } = renderHook(() => useExamLiveChannel('e1', 'u1', true, { v: 0, ev: 0 }))
    await flush()
    act(() => handlers.thumbs({ payload: { on: true } }))
    act(() => handlers.thumbs({ payload: { on: false } }))
    expect(result.current.thumbsOn).toBe(false)
  })
})

describe('thumbnail sender', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    httpSend.mockReset()
    // jsdom has no canvas: a tiny stand-in that "encodes" a WebP.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: () => {} } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/webp;base64,AAAA')
  })
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  const video = { current: { readyState: 4 } as unknown as HTMLVideoElement }

  it('sends a picture every few seconds while active, over HTTP', async () => {
    httpSend.mockResolvedValue({ success: true })
    const { unmount } = renderHook(() => useThumbnailSender('e1', 'u1', video, true))
    await flush()
    await act(async () => { vi.advanceTimersByTime(THUMB_EVERY_MS * 2) })
    expect(httpSend.mock.calls.length).toBeGreaterThanOrEqual(3)
    expect(httpSend).toHaveBeenCalledWith('thumb', expect.objectContaining({ id: 'u1', img: 'data:image/webp;base64,AAAA' }))
    unmount()
  })

  it('stops for good when the topic refuses it (migration not applied)', async () => {
    httpSend.mockResolvedValue({ success: false, status: 403, error: 'forbidden' })
    renderHook(() => useThumbnailSender('e1', 'u1', video, true))
    await flush()
    await act(async () => { vi.advanceTimersByTime(THUMB_EVERY_MS * 4) })
    expect(httpSend).toHaveBeenCalledTimes(1)
  })

  it('sends nothing while inactive', async () => {
    renderHook(() => useThumbnailSender('e1', 'u1', video, false))
    await act(async () => { vi.advanceTimersByTime(THUMB_EVERY_MS * 3) })
    expect(httpSend).not.toHaveBeenCalled()
  })
})
