// Home page FAQ: shape of the copy (public.landing.faq in
// src/messages/<locale>/public.json) and the pure helpers shared by the client
// accordion (faq-section.tsx) and the server-rendered FAQPage JSON-LD
// (src/app/page.tsx). No 'use client' here: the server page imports it.
//
// Categories and questions are keyed objects, not arrays, so each key is a
// stable slug in both languages (i18n-messages.test.ts keeps the key sets
// identical): a question keyed `signIn` is linked as #faq-sign-in.

export type FaqItemCopy = { q: string; a: string }
export type FaqCategoryCopy = { title: string; items: Record<string, FaqItemCopy> }
export type FaqCopy = {
  title: string
  intro: string
  categoriesLabel: string
  searchLabel: string
  searchPlaceholder: string
  resultsTitle: string
  noResults: string
  moreTitle: string
  moreLink: string
  copyLink: string
  copied: string
  categories: Record<string, FaqCategoryCopy>
}

export type FaqEntry = { key: string; id: string; q: string; a: string; haystack: string }
export type FaqCategory = { key: string; title: string; items: FaqEntry[] }

const kebab = (key: string) => key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()

/** The in-page anchor of one question: `faq-<slug>`. */
export const faqItemId = (key: string) => `faq-${kebab(key)}`

/**
 * Lower case, accents and Arabic diacritics removed, and the Arabic letters
 * people type interchangeably folded together (alef forms, alef maqsura and
 * yaa, taa marbuta and haa), so a search finds a word typed with or without
 * hamza. Letters by code point: the i18n ratchet allows no Arabic literal here.
 */
const ch = (...cps: number[]) => String.fromCodePoint(...cps)
const FOLDS: [RegExp, string][] = [
  [new RegExp(ch(0x640), 'g'), ''], // tatweel
  [new RegExp(`[${ch(0x622, 0x623, 0x625, 0x671)}]`, 'g'), ch(0x627)], // alef forms to bare alef
  [new RegExp(ch(0x649), 'g'), ch(0x64a)], // alef maqsura to yaa
  [new RegExp(ch(0x629), 'g'), ch(0x647)], // taa marbuta to haa
]

export function normalizeForSearch(text: string): string {
  let out = text.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '')
  for (const [re, to] of FOLDS) out = out.replace(re, to)
  return out
}

/** The categories in copy order, each question with its anchor and search text. */
export function faqCategories(copy: FaqCopy): FaqCategory[] {
  return Object.entries(copy.categories).map(([key, c]) => ({
    key,
    title: c.title,
    items: Object.entries(c.items).map(([k, it]) => ({
      key: k,
      id: faqItemId(k),
      q: it.q,
      a: it.a,
      haystack: normalizeForSearch(`${it.q} ${it.a} ${c.title}`),
    })),
  }))
}

/** Every word of the query appears somewhere in the entry. */
export function matchesQuery(entry: FaqEntry, query: string): boolean {
  const words = normalizeForSearch(query).split(/\s+/).filter(Boolean)
  return words.every(w => entry.haystack.includes(w))
}

/** schema.org FAQPage for the questions in the current locale, safe to inline in a script tag. */
export function faqJsonLd(copy: FaqCopy, locale: string): string {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    inLanguage: locale,
    mainEntity: faqCategories(copy).flatMap(c =>
      c.items.map(it => ({
        '@type': 'Question',
        name: it.q,
        acceptedAnswer: { '@type': 'Answer', text: it.a },
      })),
    ),
  }
  return JSON.stringify(data).replace(/</g, '\\u003c')
}
