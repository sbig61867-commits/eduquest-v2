import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

/**
 * Batch 3 / P-02 + P-04. The admin pages read one row of counts and one page
 * of the metadata feeds (never the whole institution's lessons / exams); the
 * teacher exams list reads named columns + question_count and loads the
 * questions only when the viewer is opened. Database side:
 * supabase/tests/content_feeds_check.sql.
 */

import { loadAdminContentCounts, loadAdminLessonsPage, loadAdminExamsPage, clampPage, ADMIN_CONTENT_PAGE_SIZE } from '@/lib/data/admin-content'
import { TEACHER_EXAM_COLUMNS, toTeacherExamRow } from '@/lib/data/teacher-exams'

let rpcCalls: [string, Record<string, unknown> | undefined][]
let rpcReply: Record<string, unknown[]>
const db = () => ({
  rpc: async (name: string, args?: Record<string, unknown>) => { rpcCalls.push([name, args]); return { data: rpcReply[name] ?? [], error: null } },
}) as never

beforeEach(() => { rpcCalls = []; rpcReply = {} })

describe('admin content feeds (P-02)', () => {
  it('counts: one row → numbers (bigint strings included); no row (not an admin) → zeros', async () => {
    rpcReply.get_admin_content_counts = [{ lessons: '2000', published_lessons: 1400, exams: '1500', homework: 500, submissions: '4000' }]
    expect((await loadAdminContentCounts(db())).counts).toEqual({ lessons: 2000, publishedLessons: 1400, exams: 1500, homework: 500, submissions: 4000 })
    rpcReply.get_admin_content_counts = []
    expect((await loadAdminContentCounts(db())).counts).toEqual({ lessons: 0, publishedLessons: 0, exams: 0, homework: 0, submissions: 0 })
  })

  it('clampPage: malformed → 1, past the end → last page, offset = (page − 1) × size', () => {
    expect(clampPage('abc', 120)).toEqual({ page: 1, pageCount: 3, offset: 0 })
    expect(clampPage('99', 120)).toEqual({ page: 3, pageCount: 3, offset: 100 })
    expect(clampPage('2', 0)).toEqual({ page: 1, pageCount: 1, offset: 0 })
  })

  it('lessons page: one bounded RPC call with limit / offset from the counted total', async () => {
    rpcReply.get_admin_lessons_page = [{ id: 'l1', title: 'L', is_published: true, created_at: 'x', teacher_name: 'T', group_name: 'G' }]
    const { data } = await loadAdminLessonsPage(db(), '3', 2000)
    expect(rpcCalls).toEqual([['get_admin_lessons_page', { p_limit: ADMIN_CONTENT_PAGE_SIZE, p_offset: 100 }]])
    expect(data).toMatchObject({ page: 3, pageCount: 40 })
    expect(data.rows[0]).toEqual({ id: 'l1', title: 'L', is_published: true, created_at: 'x', teacher_name: 'T', group_name: 'G' })
  })

  it('the dashboard\'s 5 newest lessons = one call with limit 5, offset 0', async () => {
    await loadAdminLessonsPage(db(), 1, 5, 5)
    expect(rpcCalls).toEqual([['get_admin_lessons_page', { p_limit: 5, p_offset: 0 }]])
  })

  it('exams / homework pages: the homework flag is passed through; submission_count is numeric', async () => {
    rpcReply.get_admin_exams_page = [{ id: 'e1', title: 'E', type: 'homework', duration_minutes: 0, is_published: true, proctoring_enabled: false, created_at: 'x', teacher_name: null, group_name: null, submission_count: '7' }]
    const { data } = await loadAdminExamsPage(db(), true, undefined, 500)
    expect(rpcCalls).toEqual([['get_admin_exams_page', { p_homework: true, p_limit: ADMIN_CONTENT_PAGE_SIZE, p_offset: 0 }]])
    expect(data.rows[0].submission_count).toBe(7)
    expect(data.pageCount).toBe(10)
  })

  it('no admin page or the dashboard still calls the unbounded get_admin_lessons / get_admin_exams', async () => {
    const { readFileSync } = await import('node:fs')
    for (const f of ['dashboard/page.tsx', 'lessons/page.tsx', 'exams/page.tsx']) {
      const src = readFileSync(`src/app/(admin)/admin/${f}`, 'utf8')
      expect(src).not.toMatch(/rpc\('get_admin_(lessons|exams)'\)/)
    }
  })
})

describe('teacher exams (P-04)', () => {
  it('the list selects named columns + question_count — never questions or *', () => {
    expect(TEACHER_EXAM_COLUMNS).toContain('question_count')
    expect(TEACHER_EXAM_COLUMNS).not.toMatch(/\bquestions\b|\*/)
  })

  it('a full row returned by POST / PATCH is kept as a list row: question_count from its questions, questions dropped', () => {
    const row = toTeacherExamRow({ id: 'e', title: 'T', duration_minutes: 60, is_published: false, proctoring_enabled: false, created_at: 'x', groups: null, questions: [{}, {}, {}] })
    expect(row.question_count).toBe(3)
    expect('questions' in row).toBe(false)
    expect(toTeacherExamRow({ id: 'e', title: 'T', duration_minutes: 60, is_published: false, proctoring_enabled: false, created_at: 'x', groups: null, question_count: 9 }).question_count).toBe(9)
  })
})

// ── ExamsClient: questions on demand ─────────────────────────────────────────
const questionsRead = vi.fn()
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: (t: string) => ({ select: (c: string) => ({ eq: (k: string, v: string) => ({ single: async () => questionsRead(t, c, k, v) }) }) }) }),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => '/teacher/exams', useSearchParams: () => new URLSearchParams() }))
const tStub = Object.assign((k: string, v?: Record<string, unknown>) => `${k}${v ? ':' + Object.values(v).join('/') : ''}`, { rich: (k: string) => k, has: () => true })
vi.mock('next-intl', () => ({ useTranslations: () => tStub, useLocale: () => 'en' }))
vi.mock('@/components/shared/ai-quota', () => ({ AiQuota: () => null }))
const toastError = vi.fn()
vi.mock('@/components/ui/toast', () => ({ toast: { error: (m: string) => toastError(m), success: vi.fn(), warning: vi.fn() } }))

import { ExamsClient } from '@/app/(teacher)/teacher/exams/exams-client'

describe('ExamsClient (P-04)', () => {
  const exam = { id: 'ex-1', title: 'Midterm', duration_minutes: 60, question_count: 2, is_published: true, proctoring_enabled: false, created_at: '2026-10-01T00:00:00Z', groups: { name: 'G' } }

  it('shows the count from question_count and reads the questions only when the viewer is opened', async () => {
    questionsRead.mockResolvedValue({ data: { questions: [{ text: 'What is 2+2?', type: 'mcq', points: 3, options: ['4', '5'] }, { text: 'Explain gravity', type: 'essay', points: 5 }] }, error: null })
    const { container } = render(<ExamsClient initialExams={[exam]} groups={[]} />)
    expect(container.textContent).toContain('exams.metaLine:60/2/')
    expect(questionsRead).not.toHaveBeenCalled()
    fireEvent.click(container.querySelector('button[title="exams.viewQuestionsTitle"]')!)
    await waitFor(() => expect(screen.getByText('What is 2+2?')).toBeTruthy())
    expect(questionsRead).toHaveBeenCalledWith('exams', 'questions', 'id', 'ex-1')
    expect(container.ownerDocument.body.textContent).toContain('exams.questionsViewer.summary:2')
  })

  it('a refused read shows an error and opens nothing', async () => {
    questionsRead.mockResolvedValue({ data: null, error: { message: 'denied' } })
    const { container } = render(<ExamsClient initialExams={[exam]} groups={[]} />)
    fireEvent.click(container.querySelector('button[title="exams.viewQuestionsTitle"]')!)
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('denied'))
    expect(screen.queryByText(/exams.questionsViewer.summary/)).toBeNull()
  })
})
