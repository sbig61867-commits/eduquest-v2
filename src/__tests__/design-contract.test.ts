import { describe, expect, it } from 'vitest'

import { RULES, scanRepo, scanSource, type Rule } from './design-contract-scan'
import {
  ARBITRARY_TEXT_SIZE,
  BACKDROP_BLUR,
  COLORED_SHADOW,
  GRADIENT,
  LARGE_RADIUS,
  P5,
  RAW_COLOR,
} from './design-contract-state'

/**
 * The design-system ratchet (D3, CLAUDE.md → "Design system").
 *
 * The backlog in design-contract-state.ts may only shrink: a file above its
 * number is a new violation, a file below it is a fix that must lower the
 * number in the same change, and a file not listed (e.g. a new file) must be
 * clean. Use the tokens in src/app/design-tokens.css instead.
 */

const BASELINE: Record<Rule, Readonly<Record<string, number>>> = {
  rawColor: RAW_COLOR,
  arbitraryTextSize: ARBITRARY_TEXT_SIZE,
  largeRadius: LARGE_RADIUS,
  gradient: GRADIENT,
  coloredShadow: COLORED_SHADOW,
  backdropBlur: BACKDROP_BLUR,
  p5: P5,
}

const HINT: Record<Rule, string> = {
  rawColor: 'use a semantic token (bg-surface, text-fg-2, border-line, text-accent, text-danger …)',
  arbitraryTextSize: 'use the type scale (text-h1 … text-meta, text-label)',
  largeRadius: 'use rounded-control (4px), rounded-overlay (8px), none, or rounded-full for avatars/dots',
  gradient: 'no gradients — flat surfaces and hairlines',
  coloredShadow: 'no coloured shadows — shadow-overlay on floating elements only',
  backdropBlur: 'no glass panels — use an opaque surface',
  p5: 'use the 4/8 spacing rhythm (p-4 or p-6)',
}

const actual = scanRepo()

describe('design contract ratchet', () => {
  for (const rule of RULES) {
    it(`${rule}: no file above its grandfathered count, no new file`, () => {
      const over = Object.entries(actual[rule])
        .filter(([file, n]) => n > (BASELINE[rule][file] ?? 0))
        .map(([file, n]) => `${file}: ${n} (allowed ${BASELINE[rule][file] ?? 0}) — ${HINT[rule]}`)
      expect(over).toEqual([])
    })

    it(`${rule}: baseline lowered when a file is cleaned`, () => {
      const stale = Object.entries(BASELINE[rule])
        .filter(([file, n]) => (actual[rule][file] ?? 0) < n)
        .map(([file, n]) => `${file}: now ${actual[rule][file] ?? 0}, baseline ${n} — lower it in design-contract-state.ts`)
      expect(stale).toEqual([])
    })
  }
})

describe('design contract scanner', () => {
  it('counts each pattern', () => {
    const src = `
      <div className="bg-slate-900 text-blue-400 border-slate-800 rounded-xl p-5" />
      <div className="text-[13px] rounded-2xl bg-gradient-to-r from-blue-600 shadow-blue-500/20 backdrop-blur-sm" />
      <div style={{ background: 'linear-gradient(90deg, red, blue)' }} />`
    expect(scanSource(src)).toEqual({
      rawColor: 4,
      arbitraryTextSize: 1,
      largeRadius: 2,
      gradient: 2,
      coloredShadow: 1,
      backdropBlur: 1,
      p5: 1,
    })
  })

  it('leaves tokens and allowed values alone', () => {
    const src = `<div className="bg-surface text-fg-3 border-line rounded-control rounded-full rounded-lg p-4 px-5 text-meta num shadow-overlay text-white bg-black/60" />`
    expect(scanSource(src)).toEqual({
      rawColor: 0,
      arbitraryTextSize: 0,
      largeRadius: 0,
      gradient: 0,
      coloredShadow: 0,
      backdropBlur: 0,
      p5: 0,
    })
  })
})
