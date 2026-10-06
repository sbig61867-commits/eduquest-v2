import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * Static scan behind the design-system ratchet (D3, CLAUDE.md → "Design system").
 *
 * Counts, per file in src/{app,components}, the class patterns that made the UI
 * read as generated: raw Tailwind palette colours instead of tokens, arbitrary
 * pixel font sizes, oversized radii, gradients, coloured shadows, backdrop blur
 * and p-5 (20px, off the 4/8 spacing rhythm). Text-level regexes: a class built
 * at runtime from fragments is not seen.
 */

export type Rule =
  | 'rawColor'
  | 'arbitraryTextSize'
  | 'largeRadius'
  | 'gradient'
  | 'coloredShadow'
  | 'backdropBlur'
  | 'p5'
export type Counts = Record<Rule, Record<string, number>>

const PALETTE =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose'

export const PATTERNS: Record<Rule, RegExp> = {
  rawColor: new RegExp(
    `\\b(?:bg|text|border(?:-[xytrblse])?|ring|ring-offset|from|via|to|fill|stroke|divide|outline|placeholder|accent|caret|decoration)-(?:${PALETTE})-\\d{2,3}\\b`,
    'g',
  ),
  arbitraryTextSize: /\btext-\[\d+(?:\.\d+)?(?:px|rem)\]/g,
  largeRadius: /\brounded(?:-(?:[setblr]|ss|se|es|ee|tl|tr|bl|br))?-(?:xl|2xl|3xl)\b/g,
  gradient: /\b(?:bg-gradient-to-[a-z]+|bg-linear-[a-z0-9-]+|bg-radial|bg-conic)\b|linear-gradient\(|radial-gradient\(|conic-gradient\(/g,
  coloredShadow: new RegExp(`\\bshadow-(?:${PALETTE})-\\d{2,3}\\b`, 'g'),
  backdropBlur: /\bbackdrop-blur\b(?:-[a-z0-9]+)?/g,
  p5: /(?<![\w-])p-5\b/g,
}

export const RULES = Object.keys(PATTERNS) as Rule[]

const ROOT = join(__dirname, '..')
const SCAN_DIRS = ['app', 'components']

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name === '__tests__') continue
      walk(p, out)
    } else if (/\.tsx?$/.test(name) && !/\.d\.ts$/.test(name)) {
      out.push(p)
    }
  }
  return out
}

export function scanSource(source: string): Record<Rule, number> {
  const out = {} as Record<Rule, number>
  for (const rule of RULES) out[rule] = source.match(PATTERNS[rule])?.length ?? 0
  return out
}

export function scanRepo(): Counts {
  const counts = Object.fromEntries(RULES.map(r => [r, {}])) as Counts
  for (const dir of SCAN_DIRS) {
    for (const file of walk(join(ROOT, dir))) {
      const key = relative(ROOT, file).split(sep).join('/')
      const found = scanSource(readFileSync(file, 'utf8'))
      for (const rule of RULES) if (found[rule] > 0) counts[rule][key] = found[rule]
    }
  }
  return counts
}
