// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { normalizeDbUrl } from '../../scripts/backup/lib.mjs'

const HOST = 'aws-1-eu-central-1.pooler.supabase.com:5432'

describe('pasted database link', () => {
  it('keeps a clean link as it is', () => {
    expect(normalizeDbUrl(`postgresql://postgres.ref:Abc123xyz@${HOST}/postgres`).url)
      .toBe(`postgresql://postgres.ref:Abc123xyz@${HOST}/postgres`)
  })

  it('encodes symbols in a raw password, including @', () => {
    const { url, masks } = normalizeDbUrl(`postgresql://postgres.ref:p@ss#w/rd?1:2@${HOST}/postgres`)
    expect(url).toBe(`postgresql://postgres.ref:${encodeURIComponent('p@ss#w/rd?1:2')}@${HOST}/postgres`)
    expect(new URL(url).password).toBe(encodeURIComponent('p@ss#w/rd?1:2'))
    expect(masks).toContain('p@ss#w/rd?1:2')
  })

  it('does not double-encode an already encoded password', () => {
    expect(normalizeDbUrl(`postgresql://u:p%40ss@${HOST}/postgres`).url).toBe(`postgresql://u:p%40ss@${HOST}/postgres`)
  })

  it('drops brackets, quotes, spaces and line breaks from pasting', () => {
    expect(normalizeDbUrl(`  "postgresql://u:[Secret99]@${HOST}/postgres"\n`).url).toBe(`postgresql://u:Secret99@${HOST}/postgres`)
  })

  it('refuses the placeholder and anything that is not a link', () => {
    expect(() => normalizeDbUrl(`postgresql://u:[YOUR-PASSWORD]@${HOST}/postgres`)).toThrow(/placeholder/)
    expect(() => normalizeDbUrl('just-a-password')).toThrow(/not a postgresql/)
  })
})
