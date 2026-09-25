import { describe, expect, it } from 'vitest'

import { CLIENT_NAMESPACES, LOCALES, NAMESPACES, type Namespace } from '@/i18n/config'
import { allMessages, clientMessages } from '@/i18n/messages'

function flatten(tree: unknown, prefix = ''): string[] {
  if (tree === null || typeof tree !== 'object' || Array.isArray(tree)) return [prefix]
  return Object.entries(tree as Record<string, unknown>).flatMap(([k, v]) =>
    flatten(v, prefix ? `${prefix}.${k}` : k)
  )
}

/**
 * C3, the static half.
 *
 * Phase 0a proved a missing key renders its own key path silently. The runtime
 * guard in src/i18n/request.ts makes that visible; this test makes it
 * impossible to introduce in the first place, which is cheaper. `en` is the
 * authoritative baseline, so the assertion is symmetric on purpose — a key in
 * `ar` that `en` lacks is just as much a bug.
 */
describe('message parity (missing-key prevention)', () => {
  it('has the same key set in every locale', () => {
    const [reference, ...rest] = LOCALES
    const expected = flatten(allMessages(reference)).sort()

    for (const locale of rest) {
      const actual = flatten(allMessages(locale)).sort()
      const missing = expected.filter((k) => !actual.includes(k))
      const extra = actual.filter((k) => !expected.includes(k))

      expect({ locale, missing, extra }).toEqual({ locale, missing: [], extra: [] })
    }
  })

  it('has no empty strings standing in for a translation', () => {
    for (const locale of LOCALES) {
      const dict = allMessages(locale) as unknown as Record<string, unknown>
      const empties = flatten(dict).filter((path) => {
        const value = path.split('.').reduce<unknown>(
          (node, key) => (node as Record<string, unknown>)?.[key],
          dict
        )
        return typeof value === 'string' && value.trim() === ''
      })
      expect({ locale, empties }).toEqual({ locale, empties: [] })
    }
  })

  it('declares every namespace that exists on disk, and no more', () => {
    for (const locale of LOCALES) {
      expect(Object.keys(allMessages(locale)).sort()).toEqual([...NAMESPACES].sort())
    }
  })
})

/**
 * C1 — namespace isolation.
 *
 * `clientMessages()` is the single choke point every NextIntlClientProvider in
 * the app goes through (src/i18n/provider.tsx), so asserting on it asserts on
 * the real client payload, not on a parallel model of it.
 */
describe('client payload scoping (C1)', () => {
  it('the root provider ships common only', () => {
    expect(Object.keys(clientMessages('ar', ['common']))).toEqual(['common'])
  })

  it('/admin does NOT serialize teacher or student messages', () => {
    const payload = clientMessages('ar', ['common', 'admin'])
    expect(Object.keys(payload).sort()).toEqual(['admin', 'common'])
    expect(payload).not.toHaveProperty('teacher')
    expect(payload).not.toHaveProperty('student')

    // Belt and braces: the serialized form must not contain a teacher- or
    // student-only string anywhere, however the tree is shaped.
    const serialized = JSON.stringify(payload)
    expect(serialized).not.toContain('لوحة المعلم')
    expect(serialized).not.toContain('لوحة الطالب')
  })

  it('/teacher does NOT serialize student or admin messages', () => {
    const payload = clientMessages('ar', ['common', 'teacher'])
    expect(Object.keys(payload).sort()).toEqual(['common', 'teacher'])

    const serialized = JSON.stringify(payload)
    expect(serialized).not.toContain('لوحة الطالب')
    expect(serialized).not.toContain('لوحة الإدارة')
  })

  it('refuses to put a server-only namespace on the wire', () => {
    // The email dictionary is rendered server-side only. Shipping it would be
    // dead weight on every page that made the mistake.
    expect(() => clientMessages('ar', ['email' as Namespace])).toThrow(/server-only/)
  })

  it('refuses an unknown namespace instead of silently dropping it', () => {
    expect(() => clientMessages('ar', ['nope' as Namespace])).toThrow()
  })

  it('never widens: the picked payload is a strict subset of the dictionary', () => {
    const full = Object.keys(allMessages('en'))
    for (const ns of CLIENT_NAMESPACES) {
      expect(full).toContain(ns)
    }
    expect(Object.keys(clientMessages('en', CLIENT_NAMESPACES)).length).toBeLessThan(full.length)
  })
})

/**
 * Counted nouns. Arabic has five forms for a counted noun (1, 2, 3–10, 11–99,
 * 100+), so a message like "{count} طالب" reads wrong for most numbers — these
 * are ICU plurals instead. Guards: every plural message formats for each
 * category in every locale, and Arabic prints the number as `{var}` (plain
 * Latin digits) rather than `#`, whose digits depend on the runtime's number
 * formatter for `ar`.
 */
describe('plural messages', () => {
  const PLURAL = /\{(\w+), plural,/g
  const SAMPLES = [0, 1, 2, 3, 11, 100]

  function pluralMessages(locale: string) {
    const out: { path: string; message: string; vars: string[] }[] = []
    const walk = (node: unknown, path: string) => {
      if (typeof node === 'string') {
        const vars = [...node.matchAll(PLURAL)].map(m => m[1])
        if (vars.length) out.push({ path, message: node, vars })
      } else if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k)
      }
    }
    walk(allMessages(locale as never), '')
    return out
  }

  it('finds the plural messages (guards against a broken matcher)', () => {
    expect(pluralMessages('ar').length).toBeGreaterThan(80)
  })

  it('formats every plural message for every Arabic and English category', async () => {
    const { createTranslator } = await import('next-intl')
    for (const locale of LOCALES) {
      for (const { path, message, vars } of pluralMessages(locale)) {
        const t = createTranslator({ locale, messages: { m: message } })
        for (const n of SAMPLES) {
          const values: Record<string, string | number> = Object.fromEntries(vars.map(v => [v, n]))
          // Other placeholders in the same message get a neutral stand-in.
          for (const m of message.matchAll(/\{(\w+)\}/g)) if (!(m[1] in values)) values[m[1]] = 'x'
          let text = ''
          expect(() => { text = t('m', values) }, `${locale}:${path} with ${n}`).not.toThrow()
          expect(text, `${locale}:${path} with ${n}`).not.toMatch(/[٠-٩]/)
        }
      }
    }
 }, 30_000) // hundreds of translators; slow when the machine is busy

  it('Arabic plural branches print the number as {var}, not #', () => {
    const offenders = pluralMessages('ar').filter(p => p.message.includes('#')).map(p => p.path)
    expect(offenders).toEqual([])
  })
})
