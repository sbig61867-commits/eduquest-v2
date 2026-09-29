import { describe, expect, it } from 'vitest'
import { formatMb, storageStatus } from '@/lib/storage-quota'

const MB = 1024 * 1024

describe('institution file storage limit', () => {
  it('has no cap when the owner set none, or before the migration', () => {
    expect(storageStatus(null, 5 * MB, 4 * MB)).toEqual({ limitBytes: null, usedBytes: 5 * MB, allowed: true })
    expect(storageStatus(undefined, null, MB).allowed).toBe(true)
  })

  it('allows an upload that still fits, refuses one that would pass the limit', () => {
    expect(storageStatus(150, 149 * MB, MB).allowed).toBe(true)
    expect(storageStatus(150, 149 * MB, MB + 1).allowed).toBe(false)
    expect(storageStatus(0, 0, 1).allowed).toBe(false)
  })

  it('fails open when usage cannot be read', () => {
    expect(storageStatus(150, null, 10 * MB).allowed).toBe(true)
  })

  it('formats megabytes for the owner', () => {
    expect(formatMb(1.5 * MB)).toBe('1.5')
    expect(formatMb(150 * MB)).toBe('150')
  })
})
