// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

// Static guard: every request to an AI provider lives in one of the known
// provider modules, and inside those modules every outbound call sits inside a
// meterCall(...) argument list, where the privacy check runs before it starts.
// No exception for any route: routes call src/lib/ai, never a provider.

const ROOT = path.resolve(__dirname, '../..')
const PROVIDER_MODULES = ['src/lib/ai/chat.ts', 'src/lib/ai/groq.ts', 'src/lib/ai/extract.ts', 'src/lib/ai/gemini.ts']
const MARKERS = [
  /api\.groq\.com/, /generativelanguage\.googleapis/, /@google\/generative-ai/, /openrouter\.ai/,
  /api\.cohere\./, /api\.xkiro\./, /api\.openai\.com/, /api\.anthropic\.com/, /cerebras/i,
  /from ['"]openai['"]/, /from ['"]@anthropic-ai/, /from ['"]groq-sdk['"]/, /from ['"]@google\/genai['"]/,
]

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name === '__tests__') continue
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(name)) out.push(full)
  }
  return out
}

const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join('/')
const sources = [...walk(path.join(ROOT, 'src')), ...(() => { try { return walk(path.join(ROOT, 'scripts')) } catch { return [] } })()]

describe('AI egress is confined to the provider modules', () => {
  it('no provider URL or SDK outside src/lib/ai/{chat,groq,extract,gemini}.ts', () => {
    const offenders: string[] = []
    for (const f of sources) {
      const r = rel(f)
      if (PROVIDER_MODULES.includes(r)) continue
      const text = readFileSync(f, 'utf8')
      for (const m of MARKERS) if (m.test(text)) offenders.push(`${r} ${m}`)
    }
    expect(offenders).toEqual([])
  })

  it('the provider modules exist (the list above is not stale)', () => {
    for (const m of PROVIDER_MODULES) expect(() => statSync(path.join(ROOT, m))).not.toThrow()
  })

  /** True when position `at` is inside the argument list of a meterCall( that starts before it. */
  function insideMeterCall(text: string, at: number): boolean {
    let idx = text.lastIndexOf('meterCall(', at)
    while (idx !== -1) {
      let depth = 0
      for (let i = idx + 'meterCall'.length; i < at; i++) {
        const c = text[i]
        if (c === '(') depth++
        else if (c === ')') depth--
        if (depth === 0) break
      }
      if (depth > 0) return true
      idx = text.lastIndexOf('meterCall(', idx - 1)
    }
    return false
  }

  it.each(PROVIDER_MODULES)('%s: every fetch( and generateContent( runs inside meterCall(...)', (m) => {
    const text = readFileSync(path.join(ROOT, m), 'utf8')
    const calls = [...text.matchAll(/\b(fetch|generateContent)\(/g)]
    const outside = calls.filter(c => !insideMeterCall(text, c.index!)).map(c => `${c[1]}@${text.slice(0, c.index).split('\n').length}`)
    expect(outside).toEqual([])
  })

  it('every meterCall passes an audience argument (5 arguments)', () => {
    for (const m of PROVIDER_MODULES) {
      const text = readFileSync(path.join(ROOT, m), 'utf8')
      for (const c of text.matchAll(/meterCall\(([^,]+),([^,]+),([^,]+),([^,]+),/g)) {
        expect(c[4].trim(), `${m}: ${c[0]}`).not.toMatch(/^async/)
      }
    }
  })
})
