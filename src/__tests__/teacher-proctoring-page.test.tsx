import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

/**
 * Batch 3 / P-01 — /teacher/proctoring. loadProctoringPage reads one page of
 * 20 proctored submissions (no exam questions — max_score is on the row) and
 * counts total / flagged in the database, in ONE statement read as the
 * teacher (step 9); the page shows those totals, the page's cards and
 * Previous / Next.
 */

type Q = { text: string; values: unknown[]; ctx: { as: string; userId?: string } }
const db = vi.hoisted(() => ({
  calls: [] as Q[],
  replies: { total: 0, flagged: 0, rows: [] as unknown[] },
}))

// The statement clamps the page; the fake does the same arithmetic on the values it was sent.
vi.mock('@/lib/db/sql', async () => (await import('./helpers/fake-sql')).fakeSqlModule(q => {
  db.calls.push(q as Q)
  if (q.text.startsWith('with subs as')) {
    const [, , requested, size] = q.values as [string, unknown, number, number]
    const page = Math.min(requested, Math.max(1, Math.ceil(db.replies.total / size)))
    return [{ total: db.replies.total, flagged: db.replies.flagged, page, rows: db.replies.rows }]
  }
  return []
}))
vi.mock('@/lib/auth/current', () => ({ currentUser: async () => ({ id: 'teacher-1', role: 'teacher', tenant_id: 't' }) }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => { throw new Error('REDIRECT ' + to) },
  usePathname: () => '/teacher/proctoring',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))
const tStub = Object.assign((k: string, v?: Record<string, unknown>) => `${k}${v ? ':' + Object.values(v).join('/') : ''}`, { has: () => false, rich: (k: string) => k })
vi.mock('next-intl/server', () => ({ getTranslations: async () => tStub, getLocale: async () => 'en' }))
vi.mock('next-intl', () => ({ useTranslations: () => tStub, useLocale: () => 'en' }))

import { loadProctoringPage, PROCTORING_PAGE_SIZE } from '@/lib/data/proctoring'
import { VIOLATION_TYPES } from '@/lib/proctoring-events'
import ProctoringReportsPage from '@/app/(teacher)/teacher/proctoring/page'

const sub = (i: number, events: { type: string }[] = []) => ({
  id: `s${i}`, score: 30, max_score: 40, submitted_at: '2026-10-01T10:00:00Z',
  proctoring_events: events, exams: { title: `Exam ${i}` }, users: { full_name: `Student ${i}`, email: `s${i}@x.test` },
})
const pageStatement = () => db.calls.find(q => q.text.startsWith('with subs as'))!

beforeEach(() => { db.calls = []; db.replies = { total: 0, flagged: 0, rows: [] } })

describe('loadProctoringPage', () => {
  it('one statement as the teacher: the teacher\'s proctored exams, NO exam questions, newest first, totals and flagged counted in the database', async () => {
    db.replies = { total: 4000, flagged: 1000, rows: Array.from({ length: 20 }, (_, i) => sub(i)) }
    const { data, error } = await loadProctoringPage('teacher-1', '3')
    expect(error).toBeNull()
    expect(data).toMatchObject({ total: 4000, flagged: 1000, page: 3, pageCount: 200 })
    expect(data.rows).toHaveLength(20)
    expect(db.calls).toHaveLength(1)
    const q = pageStatement()
    expect(q.ctx).toEqual({ as: 'user', userId: 'teacher-1' })
    expect(q.text).toContain('where e.teacher_id = $ and e.proctoring_enabled')
    expect(q.text).not.toContain('questions')
    expect(q.text).toContain('s.max_score')
    expect(q.text).toContain('order by submitted_at desc, id')
    expect(q.values).toEqual(['teacher-1', [...VIOLATION_TYPES], 3, PROCTORING_PAGE_SIZE, PROCTORING_PAGE_SIZE, PROCTORING_PAGE_SIZE])
  })

  it('«flagged» = at least one VIOLATION event (the page\'s rule) — the violation types are passed as one parameter, no signal / info type', async () => {
    await loadProctoringPage('teacher-1', '1')
    const types = pageStatement().values[1] as string[]
    expect(types).toEqual([...VIOLATION_TYPES])
    expect(types).not.toContain('paste_detected')
    expect(types).not.toContain('monitoring_gap')
    expect(pageStatement().text).toContain("ev->>'type' in (select jsonb_array_elements_text($))")
  })

  it('a page past the end is clamped to the last page; a bad page is page 1', async () => {
    db.replies = { total: 45, flagged: 0, rows: [sub(1)] }
    expect((await loadProctoringPage('teacher-1', '99')).data.page).toBe(3)
    db.calls = []
    expect((await loadProctoringPage('teacher-1', 'abc')).data.page).toBe(1)
    expect(pageStatement().values[2]).toBe(1)
  })

  it('no submissions → page 1 of 1, empty', async () => {
    expect((await loadProctoringPage('teacher-1', undefined)).data).toEqual({ rows: [], total: 0, flagged: 0, page: 1, pageCount: 1 })
  })
})

describe('/teacher/proctoring page', () => {
  it('shows the database totals (not the page length), the score against max_score, and Previous / Next', async () => {
    db.replies = { total: 4000, flagged: 1000, rows: [sub(1, [{ type: 'tab_switch' }]), sub(2)] }
    const html = renderToStaticMarkup(await ProctoringReportsPage({ searchParams: Promise.resolve({ page: '2' }) }))
    expect(html).toContain('>4000<')
    expect(html).toContain('>1000<')
    expect(html).toContain('>3000<')
    expect(html).toContain('proctoring.scoreLine:30/40/75/')
    expect(html).toContain('pageOf:2/200')
    expect(html).toContain('Student 1')
  })

  it('a single page shows no Previous / Next', async () => {
    db.replies = { total: 2, flagged: 0, rows: [sub(1), sub(2)] }
    const html = renderToStaticMarkup(await ProctoringReportsPage({ searchParams: Promise.resolve({}) }))
    expect(html).not.toContain('pageOf')
  })
})
