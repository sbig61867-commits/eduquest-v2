// Strips what identifies a person from text before it goes to an AI provider
// (owner, 2026-10-18): only the question and its content should leave, never a
// student's contact details or identifiers. Pure, no I/O.
//
// Removed: e-mail addresses, phone numbers, long digit runs (member, national
// and card numbers), web links (they can carry tokens or private documents),
// and any name passed in (the student's own name, a teacher's name).
// Short numbers stay: "3 + 4", "page 12", "year 2026" are lesson content.

const EMAIL_RE = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu
const URL_RE = /\b(?:https?:\/\/|www\.)\S+/gi
// Seven or more digits, allowing spaces, dots, dashes and brackets between them
// (phone numbers and identifiers); Arabic-Indic and Persian digits included.
const LONG_DIGITS_RE = /\+?[(\d٠-٩۰-۹](?:[\d٠-٩۰-۹\s().-]{5,}[\d٠-٩۰-۹])/g
const MIN_DIGITS = 7

export const REDACTED = '[…]'

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** `text` without contact details, identifiers, links or the given names. */
export function redactSensitive(text: string, names: readonly (string | null | undefined)[] = []): string {
  let out = text.replace(EMAIL_RE, REDACTED).replace(URL_RE, REDACTED)
  out = out.replace(LONG_DIGITS_RE, m => (m.replace(/\D/g, '').length + (m.match(/[٠-٩۰-۹]/g)?.length ?? 0) >= MIN_DIGITS ? REDACTED : m))
  // Each name and each of its parts of 3+ letters (a first name alone is still the person).
  const parts = new Set<string>()
  for (const n of names) {
    const full = n?.trim()
    if (!full) continue
    parts.add(full)
    for (const p of full.split(/\s+/)) if (p.length >= 3) parts.add(p)
  }
  for (const p of [...parts].sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(`(^|[^\\p{L}])${escapeRe(p)}(?=$|[^\\p{L}])`, 'giu'), `$1${REDACTED}`)
  }
  return out
}
