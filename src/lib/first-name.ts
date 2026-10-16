/**
 * The first name to greet a user by, taken from `users.full_name`.
 *
 * Arabic compound first names are two words (Abd Allah, Abd al-Rahman, Abu
 * Bakr), so a leading abd / abu keeps the word after it — in Arabic script and
 * in the Latin spellings Abd, Abdul, Abdel, Abu (see first-name.test.ts).
 * Returns null when there is no usable name, so the caller can greet without
 * one rather than show something wrong.
 */
// Matching rules, not UI text (so escaped, which also keeps the i18n ratchet
// quiet): \u0639\u0628\u062f = abd, \u0627\u0628\u0648 / \u0623\u0628\u0648 = abu.
const JOINERS = new Set(['\u0639\u0628\u062f', '\u0627\u0628\u0648', '\u0623\u0628\u0648', 'abd', 'abdul', 'abdel', 'abu'])

export function firstName(fullName: string | null | undefined): string | null {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return null
  const head = parts[0]
  if (parts.length > 1 && JOINERS.has(head.toLowerCase())) return `${head} ${parts[1]}`
  return head
}
