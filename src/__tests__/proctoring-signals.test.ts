import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { environmentFlags } from '@/lib/device-environment'
import {
  ALLOWED_EVENT_TYPES, coveragePercent, eventKind, formatMonitoringSummary, isViolation, parseMonitoringSummary,
} from '@/lib/proctoring-events'
import { useMonitoringCoverage } from '@/hooks/use-monitoring-coverage'

describe('event classification', () => {
  it('counts only violations as flags', () => {
    expect(isViolation({ type: 'multiple_faces' })).toBe(true)
    expect(isViolation({ type: 'face_mismatch' })).toBe(true)
    expect(isViolation({ type: 'paste_detected' })).toBe(false)
    expect(isViolation({ type: 'detector_unavailable' })).toBe(false)
    expect(isViolation({ type: 'monitoring_summary' })).toBe(false)
    expect(isViolation({ type: 'environment_flag' })).toBe(false)
    expect(isViolation(null)).toBe(false)
  })

  it('classifies signals and info', () => {
    expect(eventKind('bulk_insert')).toBe('signal')
    expect(eventKind('monitoring_gap')).toBe('info')
    expect(eventKind('something_unknown')).toBe('info')
  })

  it('accepts every classified type and nothing else', () => {
    for (const t of ['tab_switch', 'paste_detected', 'monitoring_summary', 'speech_detected', 'spoof_detected']) expect(ALLOWED_EVENT_TYPES.has(t)).toBe(true)
    expect(ALLOWED_EVENT_TYPES.has('drop table')).toBe(false)
  })
})

describe('monitoring summary', () => {
  it('round-trips and gives a percentage', () => {
    const s = parseMonitoringSummary(formatMonitoringSummary({ coveredMs: 45_000, totalMs: 60_000, frames: 12 }))
    expect(s).toEqual({ coveredMs: 45_000, totalMs: 60_000, frames: 12 })
    expect(coveragePercent(s!)).toBe(75)
  })

  it('rejects garbage', () => {
    expect(parseMonitoringSummary('covered=abc;total=0')).toBeNull()
    expect(parseMonitoringSummary(undefined)).toBeNull()
  })

  it('clamps to 0–100', () => {
    expect(coveragePercent({ coveredMs: 90, totalMs: 60, frames: 1 })).toBe(100)
  })
})

describe('device environment', () => {
  it('flags virtual and software GPUs', () => {
    expect(environmentFlags({ renderer: 'ANGLE (VMware, VMware SVGA 3D)' })).toHaveLength(1)
    expect(environmentFlags({ renderer: 'Google SwiftShader' })).toHaveLength(1)
    expect(environmentFlags({ renderer: 'llvmpipe (LLVM 15.0.7, 256 bits)' })).toHaveLength(1)
    expect(environmentFlags({ renderer: 'VirtualBox Graphics Adapter' })).toHaveLength(1)
  })

  it('does not flag real GPUs', () => {
    expect(environmentFlags({ renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11)' })).toEqual([])
    expect(environmentFlags({ renderer: 'Apple GPU' })).toEqual([])
    expect(environmentFlags({ renderer: 'Adreno (TM) 640' })).toEqual([])
  })

  it('flags a second screen and automation', () => {
    expect(environmentFlags({ isExtended: true, webdriver: true })).toHaveLength(2)
    expect(environmentFlags({ isExtended: false, webdriver: false })).toEqual([])
  })
})

describe('useMonitoringCoverage', () => {
  afterEach(() => vi.useRealTimers())

  it('credits steady frames and reports a stall once', () => {
    vi.useFakeTimers()
    const onGap = vi.fn()
    const { result } = renderHook(() => useMonitoringCoverage(true, onGap))

    // 30 s of frames every 4 s → fully covered.
    for (let i = 0; i < 7; i++) { act(() => { vi.advanceTimersByTime(4_000) }); result.current.onFrame() }
    // Then 60 s with no frame at all.
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(onGap).toHaveBeenCalledTimes(1)

    const s = result.current.summary()!
    expect(s.frames).toBe(7)
    expect(coveragePercent(s)).toBeGreaterThanOrEqual(30)
    expect(coveragePercent(s)).toBeLessThanOrEqual(35)
  })

  it('caps the credit of one late frame', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useMonitoringCoverage(true, () => {}))
    act(() => { vi.advanceTimersByTime(60_000) })
    result.current.onFrame()
    expect(result.current.summary()!.coveredMs).toBe(10_000)
  })

  it('returns nothing before monitoring started', () => {
    const { result } = renderHook(() => useMonitoringCoverage(false, () => {}))
    expect(result.current.summary()).toBeNull()
  })
})
