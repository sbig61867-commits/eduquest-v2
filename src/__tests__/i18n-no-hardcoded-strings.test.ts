import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { MIGRATED_DIRS, UNMIGRATED_FILES } from './i18n-migration-state'

/**
 * The ratchet that makes the extraction phases stick.
 *
 * Every user-facing string used to be written straight into the component.
 * An earlier "Arabic UI" pass did not change that — it swapped the English
 * literals for Arabic ones in place, so the count of hardcoded strings went
 * UP, not down, and switching locale could not change a single screen.
 *
 * This test freezes that damage at its current size:
 *
 *   • a file inside a MIGRATED_DIRS area may not contain Arabic literals at
 *     all — its strings belong in src/messages/<locale>/*.json;
 *   • every other file is grandfathered in UNMIGRATED_FILES, and the list is
 *     only ever allowed to SHRINK. A new file with Arabic in it fails here,
 *     and so does a migrated file that regresses.
 *
 * Deleting a name from UNMIGRATED_FILES is how a phase records its progress.
 */

const ARABIC = /[؀-ۿ]/
// A string literal or a JSX text node containing Arabic.
const LITERAL = /["'`][^"'`\n]*[؀-ۿ][^"'`\n]*["'`]/g
const JSX_TEXT = />[^<>{}\n]*[؀-ۿ][^<>{}\n]*</g

const ROOT = join(__dirname, '..')
const SCAN_DIRS = ['app', 'components', 'lib']

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name === '__tests__' || name === 'messages') continue
      walk(p, out)
    } else if (/\.tsx?$/.test(name)) {
      out.push(p)
    }
  }
  return out
}

function arabicCount(source: string): number {
  // Comments explaining Arabic behaviour are fine; only shipped strings count.
  const code = source
    .split('\n')
    .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n')
  return (code.match(LITERAL)?.length ?? 0) + (code.match(JSX_TEXT)?.length ?? 0)
}

const files = SCAN_DIRS.flatMap(d => walk(join(ROOT, d)))
  .map(p => relative(ROOT, p).split(sep).join('/'))

describe('i18n extraction ratchet', () => {
  it('has no Arabic literals in an already-migrated area', () => {
    const offenders = files
      .filter(f => MIGRATED_DIRS.some(d => f.startsWith(d)))
      .filter(f => arabicCount(readFileSync(join(ROOT, f), 'utf8')) > 0)

    expect(
      offenders,
      `These files are in a migrated area but still hold Arabic literals. ` +
        `Move them into src/messages/<locale>/*.json and read them with ` +
        `useTranslations()/getTranslations().`
    ).toEqual([])
  })

  it('introduces no new file with hardcoded Arabic', () => {
    const known = new Set<string>(UNMIGRATED_FILES)
    const unexpected = files
      .filter(f => !MIGRATED_DIRS.some(d => f.startsWith(d)))
      .filter(f => arabicCount(readFileSync(join(ROOT, f), 'utf8')) > 0)
      .filter(f => !known.has(f))

    expect(
      unexpected,
      `New hardcoded Arabic. Put the text in src/messages/<locale>/*.json ` +
        `instead of the component — that is what made the previous pass ` +
        `impossible to switch languages on.`
    ).toEqual([])
  })

  it('keeps the grandfathered list honest (no stale entries)', () => {
    const present = new Set(files)
    const stale = UNMIGRATED_FILES.filter(f => {
      if (!present.has(f)) return true // deleted or renamed
      return arabicCount(readFileSync(join(ROOT, f), 'utf8')) === 0
    })

    expect(
      stale,
      `These are listed as unmigrated but are clean (or gone). Remove them ` +
        `from UNMIGRATED_FILES so the list keeps shrinking.`
    ).toEqual([])
  })

  it('formats every date through the active locale in a migrated area', () => {
    // formatDate/formatDateTime default to Arabic for the unmigrated backlog,
    // whose pages are still Arabic top to bottom. Inside a migrated area that
    // default is a leak: the English UI renders "سبتمبر" next to English text,
    // which is precisely the half-Arabic mix the extraction removes. Caught
    // live by i18n-teacher-separation before this guard existed.
    const BARE_CALL = /\bformatDate(?:Time)?\(\s*[^,()]*(?:\([^()]*\))?[^,()]*\)/g

    const offenders = files
      .filter(f => MIGRATED_DIRS.some(d => f.startsWith(d)))
      .flatMap(f => {
        const source = readFileSync(join(ROOT, f), 'utf8')
        return (source.match(BARE_CALL) ?? []).map(call => `${f}: ${call}`)
      })

    expect(
      offenders,
      `These call formatDate/formatDateTime without a locale, so they render ` +
        `Arabic months inside the English UI. Pass the locale from ` +
        `useLocale() (client) or await getLocale() (server).`
    ).toEqual([])
  })

  it('resolves tenant vocabulary through the active locale in a migrated area', () => {
    // terminology.ts holds a locale-keyed overlay, but every call site was
    // built before the locale existed and none passed one — so getTerms fell
    // back to DEFAULT_LOCALE ('ar') everywhere and the English half of the
    // table was unreachable dead code. Found live: an English admin sidebar
    // rendering "الدفعات" for the groups nav item.
    //
    // getTerms(type, locale) and getRoleLabel(role, type, locale) both put the
    // locale last, so requiring a second/third argument is what this checks.
    const BARE_TERMS = /\bgetTerms\(\s*[^,()]*(?:\([^()]*\))?[^,()]*\)/g
    const BARE_ROLE_LABEL = /\bgetRoleLabel\(\s*[^,()]*(?:\([^()]*\))?[^,()]*(?:,\s*[^,()]*(?:\([^()]*\))?[^,()]*)?\)/g

    const offenders = files
      .filter(f => MIGRATED_DIRS.some(d => f.startsWith(d)))
      .flatMap(f => {
        const source = readFileSync(join(ROOT, f), 'utf8')
        return [
          ...(source.match(BARE_TERMS) ?? []),
          ...(source.match(BARE_ROLE_LABEL) ?? []),
        ].map(call => `${f}: ${call}`)
      })

    expect(
      offenders,
      `These resolve tenant vocabulary without a locale, so they render Arabic ` +
        `terms inside the English UI. Pass the locale from useLocale() (client) ` +
        `or await getLocale() (server).`
    ).toEqual([])
  })

  it('has no hardcoded English UI text in a migrated area either', () => {
    // The Arabic-literal check is one-directional. The same half-and-half
    // screen happens the other way round — "My Groups (3)", "Teacher:",
    // "{n} questions", a whole block of English exam rules — and every one of
    // those was found inside areas already marked migrated, because nothing
    // was looking for Latin text.
    //
    // Deliberately narrow so it does not cry wolf: only text a user reads —
    // JSX text nodes, text trailing an expression up to a tag, and
    // user-facing props. Brand names, SQL filenames and example
    // emails/URLs are correct as they are.
    //
    // Known blind spot: it reads line by line, so prose sitting alone on its
    // own line (opening tag on the line above) is not seen — e.g.
    //     <p>
    //       Teacher: {name}
    // A one-off sweep found and fixed the instances present when this was
    // written; a pass here is not proof that shape is absent.
    const WORD = /[A-Za-z]{2,}/
    // Code shapes: operators, member access, identifiers with _ or !, a
    // call left open (`name(`), a closing paren leading the run, template holes.
    const CODE = /[=?&|[\];_!]|=>|\.\w|^\)|\w\($|\$\{/
    const KEYWORD = /^(?:else|catch|finally|try|return|do)$/
    // `(?<![=-])` skips the `>` of `=>` / `->`, so arrow-function bodies are not read as text.
    const TEXT_NODE = /(?<![=-])>([^<>{}]*)(?=[<{])/g
    const TAIL = /\}([^<>{}`]*)</g
    const PROP = /\b(?:title|placeholder|label|aria-label|description|alt|emptyText|emptyHint)="([^"]+)"/g
    const ALLOWED = /^(?:EduQuest|Google|Gmail|LiveKit|Markdown|Error ID:?|Dev|[\w/-]+\.sql)$/
    const isUrlish = (v: string) => /@|^https?:|^\//.test(v)

    const offenders = files
      .filter(f => MIGRATED_DIRS.some(d => f.startsWith(d)) && f.endsWith('.tsx'))
      .flatMap(f =>
        readFileSync(join(ROOT, f), 'utf8').split('\n').flatMap((line, i) => {
          const s = line.trim()
          if (/^(\/\/|\*|\/\*|\{\/\*|import )/.test(s)) return []
          const found: string[] = []
          for (const re of [TEXT_NODE, TAIL]) {
            for (const m of line.matchAll(re)) {
              const t = m[1].trim()
              if (t && WORD.test(t) && !CODE.test(t) && !KEYWORD.test(t) && !ALLOWED.test(t)) found.push(t)
            }
          }
          for (const m of line.matchAll(PROP)) {
            const v = m[1].trim()
            if (WORD.test(v) && !isUrlish(v) && !ALLOWED.test(v)) found.push(`${m[0]}`)
          }
          return found.map(t => `${f}:${i + 1}: ${t}`)
        })
      )

    expect(
      offenders,
      `Hardcoded English in a migrated area renders inside the Arabic UI. ` +
        `Move it into src/messages/<locale>/*.json.`
    ).toEqual([])
  })

  it('still finds Arabic at all (guards against a broken matcher)', () => {
    expect(ARABIC.test('مرحبا')).toBe(true)
    expect(arabicCount(`const a = 'مرحبا'`)).toBe(1)
    expect(arabicCount(`const a = 'hello'`)).toBe(0)
  })
})
