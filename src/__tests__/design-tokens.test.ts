import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Design tokens (src/app/design-tokens.css, D3):
 *  - every dark `--eq-*` colour token has a light counterpart,
 *  - light mode exists as tokens only — nothing in src/ turns it on,
 *  - the agreed text pairs meet WCAG AA (4.5:1) in both themes, from the real values.
 */

const SRC = join(__dirname, '..')
const css = readFileSync(join(SRC, 'app', 'design-tokens.css'), 'utf8')

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`)
  expect(start, `${selector} block`).toBeGreaterThanOrEqual(0)
  const body = css.slice(start, css.indexOf('}', start))
  const vars: Record<string, string> = {}
  for (const m of body.matchAll(/(--eq-[\w-]+)\s*:\s*([^;]+);/g)) vars[m[1]] = m[2].trim()
  return vars
}

const dark = block(':root')
const light = block(':root[data-eq-app-theme="light"]')

function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) throw new Error(`not a #rrggbb colour: ${hex}`)
  const [r, g, b] = [0, 2, 4].map(i => {
    const c = parseInt(m[1].slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const AA_PAIRS: [fg: string, bg: string][] = [
  ['--eq-fg', '--eq-canvas'],
  ['--eq-fg-2', '--eq-canvas'],
  ['--eq-fg-3', '--eq-surface'],
  ['--eq-accent', '--eq-canvas'],
]

describe('design tokens', () => {
  it('every dark colour token has a light counterpart', () => {
    const colourTokens = Object.keys(dark).filter(k => !/duration|ease/.test(k))
    expect(colourTokens.length).toBeGreaterThan(15)
    expect(colourTokens.filter(k => !(k in light))).toEqual([])
  })

  for (const [theme, vars] of [['dark', dark], ['light', light]] as const) {
    for (const [fg, bg] of AA_PAIRS) {
      it(`${theme}: ${fg} on ${bg} meets WCAG AA`, () => {
        expect(contrast(vars[fg], vars[bg])).toBeGreaterThanOrEqual(4.5)
      })
    }
  }

  it('light mode is not enabled anywhere in src/', () => {
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) {
          if (name !== '__tests__' && name !== 'node_modules') walk(p)
        } else if (/\.(tsx?|jsx?|css)$/.test(name) && !p.endsWith(join('app', 'design-tokens.css'))) {
          const text = readFileSync(p, 'utf8')
          if (/data-eq-app-theme|eqAppTheme/.test(text)) offenders.push(relative(SRC, p).split(sep).join('/'))
        }
      }
    }
    walk(SRC)
    expect(offenders).toEqual([])
  })
})
