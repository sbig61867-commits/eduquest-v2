import { describe, expect, it } from 'vitest'
import { REDACTED, redactSensitive } from '@/lib/ai/redact'

describe('redactSensitive', () => {
  it('removes e-mails, links and phone numbers', () => {
    const out = redactSensitive('Mail me at sara.k@uni.edu or call +970 59-123-4567, see https://x.io/doc?token=abc')
    expect(out).not.toMatch(/sara|@|4567|token/)
    expect(out.split(REDACTED).length - 1).toBe(3)
  })

  it('removes long identifiers in Latin and Arabic-Indic digits', () => {
    expect(redactSensitive('my id 402918377')).toBe(`my id ${REDACTED}`)
    expect(redactSensitive('رقمي ٤٠٢٩١٨٣٧٧')).toBe(`رقمي ${REDACTED}`)
  })

  it('keeps short numbers that are lesson content', () => {
    const q = 'What is 345 + 12 in 2026, page 14?'
    expect(redactSensitive(q)).toBe(q)
  })

  it('removes the given names and their parts, whole words only', () => {
    const out = redactSensitive('Ahmad Saleh asked: is Ahmadiyya a word? Ahmad thinks so.', ['Ahmad Saleh'])
    expect(out).toBe(`${REDACTED} asked: is Ahmadiyya a word? ${REDACTED} thinks so.`)
    expect(redactSensitive('سأل محمد علي عن الدرس', ['محمد علي'])).toBe(`سأل ${REDACTED} عن الدرس`)
  })

  it('ignores empty names', () => {
    expect(redactSensitive('hello', [null, '', '  '])).toBe('hello')
  })
})
