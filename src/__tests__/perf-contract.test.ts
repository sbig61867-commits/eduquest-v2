import { describe, expect, it } from 'vitest'

import { scanRepo, scanSource, type Rule } from './perf-contract-scan'
import { HEAVY_FEED_CALLS, STAR_SELECT, UNBOUNDED_READS } from './perf-contract-state'

/**
 * The Performance Contract ratchet (PERFORMANCE_CONTRACT.md, rules P1–P3).
 *
 * The backlog captured in perf-contract-state.ts may only shrink: a file above
 * its number is a new violation, a file below it is a fix that must lower the
 * number in the same change, and a file not listed must be clean.
 */

const BASELINE: Record<Rule, Readonly<Record<string, number>>> = {
  starSelect: STAR_SELECT,
  unboundedRead: UNBOUNDED_READS,
  heavyFeedCall: HEAVY_FEED_CALLS,
}

const HINT: Record<Rule, string> = {
  starSelect: 'name the columns the screen needs instead of select(\'*\')',
  unboundedRead: 'bound the read (.limit/.range, a page, a head-only count, or .single()) — see PERFORMANCE_CONTRACT.md P1',
  heavyFeedCall: 'use a metadata / bounded feed instead of a heavy one — see PERFORMANCE_CONTRACT.md P3',
}

const actual = scanRepo()

describe('performance contract ratchet', () => {
  for (const rule of Object.keys(BASELINE) as Rule[]) {
    it(`${rule}: no file above its grandfathered count`, () => {
      const regressions = Object.entries(actual[rule])
        .filter(([file, n]) => n > (BASELINE[rule][file] ?? 0))
        .map(([file, n]) => `${file}: ${n} (allowed ${BASELINE[rule][file] ?? 0}) — ${HINT[rule]}`)
      expect(regressions).toEqual([])
    })

    it(`${rule}: fixed files have their count lowered in perf-contract-state.ts`, () => {
      const stale = Object.entries(BASELINE[rule])
        .filter(([file, n]) => (actual[rule][file] ?? 0) < n)
        .map(([file, n]) => `${file}: now ${actual[rule][file] ?? 0}, state says ${n} — lower it`)
      expect(stale).toEqual([])
    })
  }
})

describe('performance contract scanner', () => {
  const scan = (s: string) => scanSource(s)

  it('flags a whole-table read and a star projection', () => {
    expect(scan(`supabase.from('users').select('*').eq('tenant_id', t)`))
      .toEqual({ starSelect: 1, unboundedRead: 1, heavyFeedCall: 0 })
    expect(scan(`supabase.from('groups').select('id, members(*)')`).starSelect).toBe(1)
  })

  it('accepts bounded reads', () => {
    for (const q of [
      `supabase.from('users').select('id').order('a').limit(20)`,
      `supabase.from('users').select('id').range(0, 49)`,
      `supabase.from('users').select('*', { count: 'exact', head: true }).eq('role', 'student')`,
      `supabase.from('users').select('role').eq('id', user.id)`,
      `supabase.from('users').select('role').eq('x', 1).maybeSingle()`,
    ]) expect(scan(q)).toEqual({ starSelect: 0, unboundedRead: 0, heavyFeedCall: 0 })
  })

  it('ignores writes, storage and non-Supabase .from()', () => {
    for (const q of [
      `supabase.from('users').insert(row).select()`,
      `supabase.from('users').update(row).eq('tenant_id', t).select('*')`,
      `supabase.storage.from('exam-files').list()`,
      `Array.from('abc')`,
    ]) expect(scan(q)).toEqual({ starSelect: 0, unboundedRead: 0, heavyFeedCall: 0 })
  })

  it('counts calls to the heavy feeds only', () => {
    expect(scan(`supabase.rpc('get_student_exams'); supabase.rpc('get_my_ai_allowance')`).heavyFeedCall).toBe(1)
  })
})
