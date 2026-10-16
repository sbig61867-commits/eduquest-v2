import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The platform was renamed Tilmoo (2026-10-15). The English messages were
// updated then, but five Arabic strings kept «إديوكويست» — the sign-in page
// title, the invitation button and the 404 page. No locale may carry a
// retired name.
const RETIRED = /EduQuest|إديوكويست|ايديوكويست/i
const ROOT = join(process.cwd(), 'src/messages')

describe('message catalogues use the current platform name', () => {
  for (const locale of readdirSync(ROOT)) {
    it(`${locale}: no retired platform name`, () => {
      const hits = readdirSync(join(ROOT, locale))
        .filter(f => f.endsWith('.json'))
        .flatMap(f => readFileSync(join(ROOT, locale, f), 'utf8')
          .split('\n')
          .map((line, i) => (RETIRED.test(line) ? `${f}:${i + 1}: ${line.trim()}` : null))
          .filter((x): x is string => x !== null))
      expect(hits).toEqual([])
    })
  }
})
