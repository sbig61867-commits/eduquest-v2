// An announcement's call-to-action button is a single `link_url`. Besides a
// web link it can be a way to reach the author directly — WhatsApp, a phone
// call or an email — so a student who wants to register has someone to talk
// to. These helpers build that URL from what the author typed and read it
// back when the announcement is edited. No schema change: it is still one URL.

export type ContactType = 'link' | 'whatsapp' | 'phone' | 'email'
export const CONTACT_TYPES: ContactType[] = ['whatsapp', 'phone', 'email', 'link']

const EMAIL_RE = /^[^\s@<>"',;:?&]+@[^\s@<>"',;:?&]+\.[^\s@<>"',;:?&]{2,}$/

function digits(value: string): string {
  return value.replace(/[^\d]/g, '')
}

/** Returns the button URL, '' for an empty value, or null when the value is invalid for the type. */
export function buildContactUrl(type: ContactType, value: string, title: string): string | null {
  const v = value.trim()
  if (!v) return ''
  switch (type) {
    case 'whatsapp': {
      const d = digits(v)
      if (d.length < 8 || d.length > 15) return null
      const text = title.trim() ? `?text=${encodeURIComponent(title.trim())}` : ''
      return `https://wa.me/${d}${text}`
    }
    case 'phone': {
      const d = digits(v)
      if (d.length < 6 || d.length > 15) return null
      return `tel:${v.trim().startsWith('+') ? '+' : ''}${d}`
    }
    case 'email': {
      if (!EMAIL_RE.test(v)) return null
      const subject = title.trim() ? `?subject=${encodeURIComponent(title.trim())}` : ''
      return `mailto:${v}${subject}`
    }
    case 'link': {
      const lower = v.toLowerCase()
      return lower.startsWith('https://') || lower.startsWith('http://') ? v : null
    }
  }
}

/** Splits a stored `link_url` back into the editor's type + value. */
export function parseContactUrl(url: string | null): { type: ContactType; value: string } {
  const u = (url ?? '').trim()
  if (!u) return { type: 'whatsapp', value: '' }
  const wa = /^https:\/\/(?:wa\.me|api\.whatsapp\.com\/send\?phone=)\/?(\d+)/i.exec(u)
  if (wa) return { type: 'whatsapp', value: `+${wa[1]}` }
  if (u.toLowerCase().startsWith('tel:')) return { type: 'phone', value: u.slice(4) }
  if (u.toLowerCase().startsWith('mailto:')) {
    return { type: 'email', value: decodeURIComponent(u.slice(7).split('?')[0]) }
  }
  return { type: 'link', value: u }
}

/** Server-side check for a stored button URL: web link, or a well-formed tel:/mailto:. */
export function isAllowedCtaUrl(url: string): boolean {
  const u = url.trim()
  const lower = u.toLowerCase()
  if (lower.startsWith('https://') || lower.startsWith('http://')) return true
  if (lower.startsWith('tel:')) return /^tel:\+?\d{6,15}$/i.test(u)
  if (lower.startsWith('mailto:')) {
    const [addr] = u.slice(7).split('?')
    return EMAIL_RE.test(decodeURIComponent(addr))
  }
  return false
}

export function isWebUrl(url: string): boolean {
  return /^https?:\/\//i.test(url.trim())
}
