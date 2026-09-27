import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

// Live proctoring must publish the exam page's own camera/mic stream, never
// open a second capture: on a phone the double capture blurred the picture,
// made the sound choppy and doubled the CPU load.

const publishTrack = vi.fn().mockResolvedValue({})
const setCameraEnabled = vi.fn()
const setMicrophoneEnabled = vi.fn()
const connect = vi.fn().mockResolvedValue(undefined)
const disconnect = vi.fn().mockResolvedValue(undefined)
let roomOptions: Record<string, unknown> | undefined

vi.mock('livekit-client', () => ({
  Room: class {
    localParticipant = { publishTrack, setCameraEnabled, setMicrophoneEnabled }
    constructor(opts: Record<string, unknown>) { roomOptions = opts }
    connect = connect
    disconnect = disconnect
  },
  Track: { Source: { Camera: 'camera', Microphone: 'microphone' } },
  VideoPresets: { h180: { width: 320, height: 180 } },
}))

import { useLivePublish } from '@/hooks/use-live-publish'

function fakeStream() {
  const video = { kind: 'video', contentHint: '' } as unknown as MediaStreamTrack
  const audio = { kind: 'audio' } as unknown as MediaStreamTrack
  const stream = {
    getVideoTracks: () => [video],
    getAudioTracks: () => [audio],
  } as unknown as MediaStream
  return { stream, video, audio }
}

describe('useLivePublish', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    roomOptions = undefined
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ token: 't', url: 'wss://lk.test' }), { status: 200 })))
  })

  it('publishes the exam stream it is given and never opens a second capture', async () => {
    const { stream, video, audio } = fakeStream()
    const ref = { current: stream }
    const { unmount } = renderHook(() => useLivePublish('exam-1', true, ref))

    await waitFor(() => expect(publishTrack).toHaveBeenCalledTimes(2))
    expect(publishTrack).toHaveBeenCalledWith(video, expect.objectContaining({ source: 'camera', degradationPreference: 'maintain-framerate' }))
    expect(publishTrack).toHaveBeenCalledWith(audio, expect.objectContaining({ source: 'microphone', dtx: false }))
    expect(setCameraEnabled).not.toHaveBeenCalled()
    expect(setMicrophoneEnabled).not.toHaveBeenCalled()
    expect(video.contentHint).toBe('motion')

    // Leaving the room must not stop the camera the detectors still read.
    expect(roomOptions).toMatchObject({ stopLocalTrackOnUnpublish: false })
    unmount()
    expect(disconnect).toHaveBeenCalledWith(false)
  })

  it('does nothing when live proctoring is not configured', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })))
    const { stream } = fakeStream()
    renderHook(() => useLivePublish('exam-1', true, { current: stream }))
    await new Promise(r => setTimeout(r, 20))
    expect(connect).not.toHaveBeenCalled()
    expect(publishTrack).not.toHaveBeenCalled()
  })
})
