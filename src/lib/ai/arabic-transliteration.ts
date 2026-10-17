// Arabic-letter pronunciation of foreign words (2026-10-17). Generated
// language lessons write a word's pronunciation in parentheses after it,
// e.g. "Rouge (r-w-j in Arabic letters)". Models sometimes use Persian/Urdu
// letters there (zhe, pe, che, gaf, ve), which an Arabic-speaking student
// reads wrongly. Only the parentheses right after a Latin-script word are
// touched, so a lesson that is itself in Persian or Urdu keeps its letters.
// Letters are written as escapes: they are data, not interface text.

const MAP: Record<string, string> = {
  '\u0698': '\u062C', // zhe -> jeem: French j / soft g (rouge, jour)
  '\u067E': '\u0628', // pe -> beh
  '\u06A4': '\u0641', // ve -> feh
  '\u06CB': '\u0641', // ve (Kurdish) -> feh
  '\u0686': '\u062A\u0634', // che -> teh + sheen
  '\u06AF': '\u063A', // gaf -> ghain: hard g (gateau)
  '\u06AD': '\u063A', // ng -> ghain
  '\u06A9': '\u0643', // Persian kaf -> Arabic kaf
  '\u06CC': '\u064A', // Persian yeh -> Arabic yeh
}
const NON_ARABIC = /[\u0698\u067E\u06A4\u06CB\u0686\u06AF\u06AD\u06A9\u06CC]/g
const HAS_NON_ARABIC = /[\u0698\u067E\u06A4\u06CB\u0686\u06AF\u06AD\u06A9\u06CC]/

/** "Rouge (…)" : fixes the letters only inside the pronunciation parentheses. */
export function normalizeTransliterations(text: string): string {
  return text.replace(/([A-Za-zÀ-ÖØ-öø-ÿŒœ][A-Za-zÀ-ÖØ-öø-ÿŒœ'’\- ]*?\s*)\(([^()\n]{1,80})\)/g, (all, word: string, inside: string) =>
    HAS_NON_ARABIC.test(inside) ? `${word}(${inside.replace(NON_ARABIC, ch => MAP[ch] ?? ch)})` : all,
  )
}
