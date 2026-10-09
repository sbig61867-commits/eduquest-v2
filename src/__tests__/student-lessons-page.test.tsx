import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

/**
 * Batch 3 / P-05 — /student/lessons. loadStudentLessons reads one page of 50
 * published lessons of the student's active groups WITHOUT bodies; LessonDetails
 * reads a body only when that lesson is opened, through the student's session
 * with the same active-group filter, once.
 */

const bodyRead = vi.fn()
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: (cols: string) => {
        const filters: unknown[][] = []
        const ch = {
          eq: (...a: unknown[]) => { filters.push(a); return ch },
          single: async () => bodyRead(table, cols, filters),
        }
        return ch
      },
    }),
  }),
}))
const tStub = Object.assign((k: string) => k, { rich: (k: string) => k, has: () => true })
vi.mock('next-intl', () => ({ useTranslations: () => tStub, useLocale: () => 'en' }))
vi.mock('@/components/lesson/lesson-view', () => ({ LessonView: ({ content }: { content: string }) => <div data-testid="body">{content}</div> }))

import { loadStudentLessons, STUDENT_LESSONS_PAGE_SIZE } from '@/lib/data/student-lessons'
import { LessonDetails } from '@/components/student/lesson-details'

type Call = [string, ...unknown[]]
let calls: Call[][]
let reply: { data?: unknown[]; count?: number; error?: { code?: string; message: string } | null }[]
function db() {
  return {
    from(table: string) {
      const c: Call[] = [['from', table]]
      calls.push(c)
      const ch: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'in', 'order', 'range']) ch[m] = (...a: unknown[]) => { c.push([m, ...a]); return ch }
      ch.then = (resolve: (v: unknown) => unknown) => {
        const head = c.some(x => x[0] === 'select' && (x[2] as { head?: boolean } | undefined)?.head)
        return Promise.resolve(head ? { count: 120, error: null } : { data: [], count: 0, error: null, ...reply.shift() }).then(resolve)
      }
      return ch
    },
  }
}
const row = (i: number) => ({ id: `l${i}`, title: `Lesson ${i}`, created_at: '2026-10-01T00:00:00Z', group_id: 'g1', groups: { name: 'Physics', is_active: true } })

beforeEach(() => { calls = []; reply = []; bodyRead.mockReset() })

describe('loadStudentLessons', () => {
  it('one page of 50 published lessons of the student\'s active groups — titles only, no body, exact count', async () => {
    reply = [{ data: [row(1), row(2)], count: 300 }]
    const { data, error } = await loadStudentLessons(db() as never, ['g1', 'g2'], '2')
    expect(error).toBeNull()
    const q = calls[0]
    const select = q.find(x => x[0] === 'select')!
    expect(select[1]).toBe('id, title, created_at, group_id, groups!inner(name, is_active)')
    expect(select[1]).not.toContain('content')
    expect(select[2]).toEqual({ count: 'exact' })
    expect(q).toContainEqual(['eq', 'is_published', true])
    expect(q).toContainEqual(['eq', 'groups.is_active', true])
    expect(q).toContainEqual(['in', 'group_id', ['g1', 'g2']])
    expect(q).toContainEqual(['range', STUDENT_LESSONS_PAGE_SIZE, 2 * STUDENT_LESSONS_PAGE_SIZE - 1])
    expect(data).toMatchObject({ total: 300, page: 2, pageCount: 6 })
    expect(data.rows[0]).toEqual({ id: 'l1', title: 'Lesson 1', created_at: '2026-10-01T00:00:00Z', group_id: 'g1', groups: { name: 'Physics' } })
  })

  it('no groups → no query, empty page; past the end → the last page', async () => {
    expect((await loadStudentLessons(db() as never, [], '1')).data).toEqual({ rows: [], total: 0, page: 1, pageCount: 1 })
    expect(calls).toHaveLength(0)
    reply = [{ error: { code: 'PGRST103', message: 'range' } }, { data: [row(9)], count: 120 }]
    expect((await loadStudentLessons(db() as never, ['g1'], '99')).data.page).toBe(3)
  })
})

describe('LessonDetails', () => {
  // jsdom fires `toggle` by itself when `open` changes, like a browser — set the attribute only.
  const open = (el: HTMLElement) => { (el as HTMLDetailsElement).open = true }
  const close = (el: HTMLElement) => { (el as HTMLDetailsElement).open = false }

  it('reads nothing until opened; opening reads THAT lesson once (active group only) and shows its body', async () => {
    bodyRead.mockResolvedValue({ data: { content: 'Body of lesson 1' }, error: null })
    const { container } = render(<LessonDetails lessonId="l1" summary={<summary>Lesson 1</summary>}><p>homework</p></LessonDetails>)
    expect(bodyRead).not.toHaveBeenCalled()
    expect(screen.queryByTestId('body')).toBeNull()
    const details = container.querySelector('details')!
    open(details)
    await waitFor(() => expect(screen.getByTestId('body').textContent).toBe('Body of lesson 1'))
    expect(bodyRead).toHaveBeenCalledWith('lessons', 'content, groups!inner(is_active)', [['id', 'l1'], ['groups.is_active', true]])
    close(details)
    await new Promise(r => setTimeout(r, 20))
    open(details)
    await new Promise(r => setTimeout(r, 20))
    expect(bodyRead).toHaveBeenCalledTimes(1)
    expect(screen.getByText('homework')).toBeTruthy()
  })

  it('a refused read (RLS / archived group) shows the error text and is retried on the next opening', async () => {
    bodyRead.mockResolvedValueOnce({ data: null, error: { message: 'not found' } })
    const { container } = render(<LessonDetails lessonId="l1" summary={<summary>Lesson 1</summary>} />)
    const details = container.querySelector('details')!
    open(details)
    await waitFor(() => expect(screen.getByText('loadFailed')).toBeTruthy())
    bodyRead.mockResolvedValueOnce({ data: { content: 'now ok' }, error: null })
    close(details)
    await new Promise(r => setTimeout(r, 20))
    open(details)
    await waitFor(() => expect(screen.getByTestId('body').textContent).toBe('now ok'))
  })
})
