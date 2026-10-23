import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

/**
 * Batch 3 / P-05 — /student/lessons. loadStudentLessons reads one page of 50
 * published lessons of the student's active groups WITHOUT bodies (one
 * statement, read as the student); LessonDetails reads a body only when that
 * lesson is opened, from /api/student/lesson-body, once.
 */

type Q = { text: string; values: unknown[]; ctx: { as: string; userId?: string } }
const db = vi.hoisted(() => ({ calls: [] as Q[], reply: [] as unknown[] | Error }))
vi.mock('@/lib/db/sql', async () => (await import('./helpers/fake-sql')).fakeSqlModule(q => {
  db.calls.push(q as Q)
  return db.reply
}))
const tStub = Object.assign((k: string) => k, { rich: (k: string) => k, has: () => true })
vi.mock('next-intl', () => ({ useTranslations: () => tStub, useLocale: () => 'en' }))
vi.mock('@/components/lesson/lesson-view', () => ({ LessonView: ({ content }: { content: string }) => <div data-testid="body">{content}</div> }))

import { loadStudentLessons, STUDENT_LESSONS_PAGE_SIZE } from '@/lib/data/student-lessons'
import { LessonDetails } from '@/components/student/lesson-details'

const row = (i: number) => ({ id: `l${i}`, title: `Lesson ${i}`, created_at: '2026-10-01T00:00:00Z', group_id: 'g1', groups: { name: 'Physics' } })
const bodyFetch = vi.fn()

beforeEach(() => {
  db.calls = []
  db.reply = []
  bodyFetch.mockReset()
  vi.stubGlobal('fetch', bodyFetch)
})

describe('loadStudentLessons', () => {
  it('one page of 50 published lessons of the student\'s active groups — titles only, no body, exact count', async () => {
    db.reply = [{ total: 300, page: 2, rows: [row(1), row(2)] }]
    const { data, error } = await loadStudentLessons('stu-1', ['g1', 'g2'], '2')
    expect(error).toBeNull()
    expect(db.calls).toHaveLength(1)
    const [q] = db.calls
    expect(q.ctx).toEqual({ as: 'user', userId: 'stu-1' })
    expect(q.text).toContain('where l.is_published and g.is_active')
    expect(q.text).not.toContain('content')
    expect(q.values).toEqual([['g1', 'g2'], 2, STUDENT_LESSONS_PAGE_SIZE, STUDENT_LESSONS_PAGE_SIZE, STUDENT_LESSONS_PAGE_SIZE])
    expect(data).toMatchObject({ total: 300, page: 2, pageCount: 6 })
    expect(data.rows[0]).toEqual({ id: 'l1', title: 'Lesson 1', created_at: '2026-10-01T00:00:00Z', group_id: 'g1', groups: { name: 'Physics' } })
  })

  it('no groups → no query, empty page; past the end → the statement answers the last page', async () => {
    expect((await loadStudentLessons('stu-1', [], '1')).data).toEqual({ rows: [], total: 0, page: 1, pageCount: 1 })
    expect(db.calls).toHaveLength(0)
    db.reply = [{ total: 120, page: 3, rows: [row(9)] }]
    expect((await loadStudentLessons('stu-1', ['g1'], '99')).data.page).toBe(3)
    expect(db.calls[0].text).toContain('least($, greatest(1, ceil(n / $::numeric)::int))')
  })

  it('a failed read is an error with an empty page, never a partial one', async () => {
    db.reply = new Error('boom')
    expect(await loadStudentLessons('stu-1', ['g1'], '1')).toEqual({ data: { rows: [], total: 0, page: 1, pageCount: 1 }, error: { message: 'boom' } })
  })
})

describe('LessonDetails', () => {
  // jsdom fires `toggle` by itself when `open` changes, like a browser — set the attribute only.
  const open = (el: HTMLElement) => { (el as HTMLDetailsElement).open = true }
  const close = (el: HTMLElement) => { (el as HTMLDetailsElement).open = false }
  const ok = (content: string) => ({ ok: true, json: async () => ({ content }) })

  it('reads nothing until opened; opening reads THAT lesson once and shows its body', async () => {
    bodyFetch.mockResolvedValue(ok('Body of lesson 1'))
    const { container } = render(<LessonDetails lessonId="l1" summary={<summary>Lesson 1</summary>}><p>homework</p></LessonDetails>)
    expect(bodyFetch).not.toHaveBeenCalled()
    expect(screen.queryByTestId('body')).toBeNull()
    const details = container.querySelector('details')!
    open(details)
    await waitFor(() => expect(screen.getByTestId('body').textContent).toBe('Body of lesson 1'))
    expect(bodyFetch).toHaveBeenCalledWith('/api/student/lesson-body?id=l1')
    close(details)
    await new Promise(r => setTimeout(r, 20))
    open(details)
    await new Promise(r => setTimeout(r, 20))
    expect(bodyFetch).toHaveBeenCalledTimes(1)
    expect(screen.getByText('homework')).toBeTruthy()
  })

  it('a refused read (RLS / archived group) shows the error text and is retried on the next opening', async () => {
    bodyFetch.mockResolvedValueOnce({ ok: false, json: async () => ({}) })
    const { container } = render(<LessonDetails lessonId="l1" summary={<summary>Lesson 1</summary>} />)
    const details = container.querySelector('details')!
    open(details)
    await waitFor(() => expect(screen.getByText('loadFailed')).toBeTruthy())
    bodyFetch.mockResolvedValueOnce(ok('now ok'))
    close(details)
    await new Promise(r => setTimeout(r, 20))
    open(details)
    await waitFor(() => expect(screen.getByTestId('body').textContent).toBe('now ok'))
  })
})
