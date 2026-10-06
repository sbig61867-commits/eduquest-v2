import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * D3.1: the body / --font-sans stack must name the bare Plex families
 * (--font-*-face, set in layout.tsx), never the next/font variables, whose
 * generated "… Fallback" face (local Arial, no unicode-range) would catch
 * Latin text and digits before IBM Plex Sans. Arial is the last fallback.
 */

const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8')
const STACK = 'var(--font-latin-face), var(--font-arabic-face), Arial, sans-serif'

const stacks = [
  ...css.matchAll(/--font-sans\s*:\s*([^;]+);/g),
  ...css.matchAll(/body\s*\{[^}]*?font-family\s*:\s*([^;]+);/g),
].map(m => m[1].trim())

describe('font stack', () => {
  it('body and --font-sans use the bare-face stack', () => {
    expect(stacks).toEqual([STACK, STACK])
  })

  it('never uses the next/font variables (they carry the Arial fallback face)', () => {
    for (const s of stacks) expect(s).not.toMatch(/var\(--font-(arabic|latin)\)/)
  })

  it('Arial is the last fallback before sans-serif', () => {
    for (const s of stacks) expect(s.split(',').map(x => x.trim()).slice(-2)).toEqual(['Arial', 'sans-serif'])
  })
})
