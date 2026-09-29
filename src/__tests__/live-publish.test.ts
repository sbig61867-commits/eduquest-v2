import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

// Live proctoring is on demand. The student publishes the exam page's own
// camera/mic stream (never a second capture: on a phone that blurred the
// picture, made the sound choppy and doubled the CPU load), only while the
// teacher watches, and leaves as soon as LiveKit says the teacher is gone.

const publishTrack = vi.fn().mockResolvedValue({})
const setCameraEnabled = vi.fn()
const setMicrophoneEnabled = vi.fn()
const connect = vi.fn().mockResolvedValue(undefined)
const disconnect = vi.fn().mockResolvedValue(undefined)
let roomOptions: Record<string, unknown> | undefined
let handlers: Record<string, (...args: unknown[]) => void> = {}

vi.mock('livekit-client', () => ({
  Room: class {
    localParticipant = { publishTrack, setCameraEnabled, setMicrophoneEnabled }
    remoteParticipants = new Map()
    constructor(opts: Record<string, unknown>) { roomOptions = opts }
    on(event: string, fn: (...args: unknown[]) => void) { handlers[event] = fn; return this }
    connect = connect
    disconnect = disconnect
  },
  RoomEvent: {
    ParticipantDisconnected: 'participantDisconnected',
    ParticipantAttributesChanged: 'participantAttributesChanged',
    Disconnected: 'disconnected',
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

const tokenResponse = () => new Response(JSON.stringify({ token: 't', url: 'wss://lk.test', identity: 'student-1', teacher: 'teacher-1' }), { status: 200 })

describe('useLivePublish', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    roomOptions = undefined
    handlers = {}
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => tokenResponse()))
  })

  it('publishes the exam stream it is given and never opens a second capture', async () => {
    const { stream, video, audio } = fakeStream()
    const { unmount } = renderHook(() => useLivePublish('exam-1', true, { current: stream }))

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

  it('does not connect at all while nobody watches (active = false)', async () => {
    const { stream } = fakeStream()
    renderHook(() => useLivePublish('exam-1', false, { current: stream }))
    await new Promise(r => setTimeout(r, 20))
    expect(fetch).not.toHaveBeenCalled()
    expect(connect).not.toHaveBeenCalled()
  })

  it('retries a 409 once the teacher has had time to announce the watch', async () => {
    // First request races the teacher's LiveKit attribute update; the retry wins.
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 409 }))
      .mockImplementation(async () => tokenResponse()))
    const onEnded = vi.fn()
    const { stream } = fakeStream()
    renderHook(() => useLivePublish('exam-1', true, { current: stream }, onEnded))
    await waitFor(() => expect(publishTrack).toHaveBeenCalledTimes(2), { timeout: 4000 })
    expect(onEnded).not.toHaveBeenCalled()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('gives up when the server keeps saying the teacher is not watching (409)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(null, { status: 409 })))
    const onEnded = vi.fn()
    const { stream } = fakeStream()
    renderHook(() => useLivePublish('exam-1', true, { current: stream }, onEnded))
    await waitFor(() => expect(onEnded).toHaveBeenCalled(), { timeout: 9000 })
    expect(connect).not.toHaveBeenCalled()
    expect(fetch).toHaveBeenCalledTimes(4)
  }, 12_000)

  it('leaves as soon as the teacher leaves or stops watching this student', async () => {
    const onEnded = vi.fn()
    const { stream } = fakeStream()
    renderHook(() => useLivePublish('exam-1', true, { current: stream }, onEnded))
    await waitFor(() => expect(publishTrack).toHaveBeenCalledTimes(2))

    // Another student leaving changes nothing.
    handlers.participantDisconnected({ identity: 'student-2' })
    expect(onEnded).not.toHaveBeenCalled()
    // The teacher still watching us: nothing.
    handlers.participantAttributesChanged({}, { identity: 'teacher-1', attributes: { watching: 'student-1,student-3' } })
    expect(onEnded).not.toHaveBeenCalled()
    // The teacher drops us from the watch list: leave.
    handlers.participantAttributesChanged({}, { identity: 'teacher-1', attributes: { watching: 'student-3' } })
    expect(disconnect).toHaveBeenCalledWith(false)
    expect(onEnded).toHaveBeenCalled()
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
