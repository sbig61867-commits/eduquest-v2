import { describe, expect, it } from 'vitest'
import { buildContactUrl, parseContactUrl, isAllowedCtaUrl } from '@/lib/announcement-contact'

describe('announcement contact button', () => {
  it('builds a WhatsApp link with the title prefilled', () => {
    expect(buildContactUrl('whatsapp', '+966 55 123 4567', 'Course X')).toBe('https://wa.me/966551234567?text=Course%20X')
    expect(buildContactUrl('whatsapp', '123', 't')).toBeNull()
  })
  it('builds tel: and mailto:', () => {
    expect(buildContactUrl('phone', '+966 11 234 5678', '')).toBe('tel:+966112345678')
    expect(buildContactUrl('email', 'a@b.co', 'Hi')).toBe('mailto:a@b.co?subject=Hi')
    expect(buildContactUrl('email', 'not-an-email', '')).toBeNull()
  })
  it('keeps empty values empty and rejects non-web links', () => {
    expect(buildContactUrl('link', '  ', '')).toBe('')
    expect(buildContactUrl('link', 'javascript:alert(1)', '')).toBeNull()
  })
  it('round-trips through parse', () => {
    for (const [type, value] of [['whatsapp', '+966551234567'], ['phone', '+966112345678'], ['email', 'a@b.co'], ['link', 'https://x.org/y']] as const) {
      const url = buildContactUrl(type, value, 'Title')!
      expect(parseContactUrl(url)).toEqual({ type, value })
      expect(isAllowedCtaUrl(url)).toBe(true)
    }
  })
  it('server refuses dangerous or malformed schemes', () => {
    expect(isAllowedCtaUrl('javascript:alert(1)')).toBe(false)
    expect(isAllowedCtaUrl('tel:abc')).toBe(false)
    expect(isAllowedCtaUrl('mailto:x')).toBe(false)
    expect(isAllowedCtaUrl('data:text/html,hi')).toBe(false)
  })
})
