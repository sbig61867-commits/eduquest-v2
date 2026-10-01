import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

/**
 * Batch 3 / P-01 — /teacher/proctoring. loadProctoringPage reads one page of
 * 20 proctored submissions (no exam questions — max_score is on the row) and
 * counts total / flagged in the database; the page shows those totals, the
 * page's cards and Previous / Next.
 */

type Call = [string, ...unknown[]]
let calls: Call[][]
let replies: { total: number; flagged: number; rows: unknown[]; rangeError?: boolean }

function db() {
  return {
    from(table: string) {
      const c: Call[] = [['from', table]]
      calls.push(c)
      const ch: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'or', 'order', 'range', 'is', 'in']) ch[m] = (...a: unknown[]) => { c.push([m, ...a]); return ch }
      ch.then = (resolve: (v: unknown) => unknown) => {
        const head = c.some(x => x[0] === 'select' && (x[2] as { head?: boolean } | undefined)?.head)
        if (table !== 'exam_submissions') return Promise.resolve({ data: [], error: null }).then(resolve)
        if (head) return Promise.resolve({ count: c.some(x => x[0] === 'or') ? replies.flagged : replies.total, error: null }).then(resolve)
        const range = c.find(x => x[0] === 'range') as [string, number, number]
        if (replies.rangeError && range[1] > 0 && c.filter(x => x[0] === 'range').length === 1 && calls.filter(k => k.some(x => x[0] === 'range')).length === 1) {
          return Promise.resolve({ data: null, error: { code: 'PGRST103', message: 'range' } }).then(resolve)
        }
        return Promise.resolve({ data: replies.rows, error: null }).then(resolve)
      }
      return ch
    },
  }
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => db()),
  getAuthUser: vi.fn(async () => ({ id: 'teacher-1', role: 'teacher' })),
}))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => { throw new Error('REDIRECT ' + to) },
  usePathname: () => '/teacher/proctoring',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))
const tStub = Object.assign((k: string, v?: Record<string, unknown>) => `${k}${v ? ':' + Object.values(v).join('/') : ''}`, { has: () => false, rich: (k: string) => k })
vi.mock('next-intl/server', () => ({ getTranslations: async () => tStub, getLocale: async () => 'en' }))
vi.mock('next-intl', () => ({ useTranslations: () => tStub, useLocale: () => 'en' }))

import { loadProctoringPage, violationFilter, PROCTORING_PAGE_SIZE } from '@/lib/data/proctoring'
import { VIOLATION_TYPES } from '@/lib/proctoring-events'
import ProctoringReportsPage from '@/app/(teacher)/teacher/proctoring/page'

const sub = (i: number, events: { type: string }[] = []) => ({
  id: `s${i}`, score: 30, max_score: 40, submitted_at: '2026-10-01T10:00:00Z',
  proctoring_events: events, exams: { title: `Exam ${i}` }, users: { full_name: `Student ${i}`, email: `s${i}@x.test` },
})

beforeEach(() => { calls = []; replies = { total: 0, flagged: 0, rows: [] } })

describe('violationFilter', () => {
  it('one JSONB containment test per violation type — exactly the page\'s rule, no signal / info type', () => {
    const parts = violationFilter().split(',proctoring_events')
    expect(parts).toHaveLength(VIOLATION_TYPES.length)
    for (const type of VIOLATION_TYPES) expect(violationFilter()).toContain(`proctoring_events.cs.[{"type":"${type}"}]`)
    expect(violationFilter()).not.toContain('paste_detected')
    expect(violationFilter()).not.toContain('monitoring_gap')
  })
})

describe('loadProctoringPage', () => {
  it('one page of 20, newest first, NO exam questions; totals from two head counts scoped to the teacher\'s proctored exams', async () => {
    replies = { total: 4000, flagged: 1000, rows: Array.from({ length: 20 }, (_, i) => sub(i)) }
    const { data, error } = await loadProctoringPage(db() as never, 'teacher-1', '3')
    expect(error).toBeNull()
    expect(data).toMatchObject({ total: 4000, flagged: 1000, page: 3, pageCount: 200 })
    expect(data.rows).toHaveLength(20)
    const [total, flagged, rows] = calls
    for (const c of [total, flagged, rows]) {
      expect(c).toContainEqual(['eq', 'exams.teacher_id', 'teacher-1'])
      expect(c).toContainEqual(['eq', 'exams.proctoring_enabled', true])
    }
    expect(total.some(x => x[0] === 'or')).toBe(false)
    expect(flagged).toContainEqual(['or', violationFilter()])
    const select = rows.find(x => x[0] === 'select')![1] as string
    expect(select).not.toContain('questions')
    expect(select).toContain('max_score')
    expect(rows).toContainEqual(['order', 'submitted_at', { ascending: false }])
    expect(rows).toContainEqual(['range', 2 * PROCTORING_PAGE_SIZE, 3 * PROCTORING_PAGE_SIZE - 1])
  })

  it('a page past the end is clamped to the last page; a bad page is page 1', async () => {
    replies = { total: 45, flagged: 0, rows: [sub(1)] }
    expect((await loadProctoringPage(db() as never, 'teacher-1', '99')).data.page).toBe(3)
    calls = []
    expect((await loadProctoringPage(db() as never, 'teacher-1', 'abc')).data.page).toBe(1)
    expect(calls[2]).toContainEqual(['range', 0, PROCTORING_PAGE_SIZE - 1])
  })

  it('no submissions → page 1 of 1, empty', async () => {
    expect((await loadProctoringPage(db() as never, 'teacher-1', undefined)).data).toEqual({ rows: [], total: 0, flagged: 0, page: 1, pageCount: 1 })
  })
})

describe('/teacher/proctoring page', () => {
  it('shows the database totals (not the page length), the score against max_score, and Previous / Next', async () => {
    replies = { total: 4000, flagged: 1000, rows: [sub(1, [{ type: 'tab_switch' }]), sub(2)] }
    const html = renderToStaticMarkup(await ProctoringReportsPage({ searchParams: Promise.resolve({ page: '2' }) }))
    expect(html).toContain('>4000<')
    expect(html).toContain('>1000<')
    expect(html).toContain('>3000<')
    expect(html).toContain('proctoring.scoreLine:30/40/75/')
    expect(html).toContain('pageOf:2/200')
    expect(html).toContain('Student 1')
  })

  it('a single page shows no Previous / Next', async () => {
    replies = { total: 2, flagged: 0, rows: [sub(1), sub(2)] }
    const html = renderToStaticMarkup(await ProctoringReportsPage({ searchParams: Promise.resolve({}) }))
    expect(html).not.toContain('pageOf')
  })
})
