import { describe, expect, it } from 'vitest'

import arPublic from '@/messages/ar/public.json'
import enPublic from '@/messages/en/public.json'
import { pricingText as arPricing } from '@/content/pricing/ar'
import { pricingText as enPricing } from '@/content/pricing/en'

/**
 * House style of the public marketing pages (home, features, pricing, contact,
 * privacy, terms), set by the owner: plain sentences that end with a period.
 * No dashes, commas, brackets, slashes, quotation marks, colons, semicolons,
 * question or exclamation marks, or ellipses. FAQ entries are topic titles, not
 * questions. `|` in page titles, `%`, the apostrophe and `{placeholders}` are
 * allowed. The /demo copy is a product mock-up and is not covered.
 */
const BANNED = /[—–\-,،()[\]"“”«»/:;!?؟…]|\.\.\./
const SECTIONS = ['meta', 'shell', 'landing', 'featuresPage', 'pricingPage', 'contact', 'policy'] as const

function offenders(node: unknown, path: string, out: string[] = []): string[] {
  if (typeof node === 'string') {
    if (BANNED.test(node.replace(/\{\w+\}/g, ''))) out.push(`${path} => ${node}`)
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) offenders(v, `${path}.${k}`, out)
  }
  return out
}

describe('public page copy style', () => {
  for (const [locale, messages, pricing] of [
    ['ar', arPublic, arPricing],
    ['en', enPublic, enPricing],
  ] as const) {
    it(`${locale}: marketing messages use plain punctuation`, () => {
      const found = SECTIONS.flatMap(s => offenders(messages[s], s))
      expect(found).toEqual([])
    })

    it(`${locale}: pricing wording uses plain punctuation`, () => {
      expect(offenders(pricing, 'pricing')).toEqual([])
    })
  }

  it('still catches a banned character (guards against a broken matcher)', () => {
    expect(offenders('one — two', 'x')).toHaveLength(1)
    expect(offenders('أ، ب', 'x')).toHaveLength(1)
    expect(offenders('A plain sentence.', 'x')).toHaveLength(0)
  })
})
