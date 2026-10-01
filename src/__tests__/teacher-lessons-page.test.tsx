import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

/**
 * Batch 3 / P-03 — /teacher/lessons. loadTeacherLessons reads one page of 50
 * lessons (named columns) and turns each body into the same 150-char excerpt
 * the list always showed — the browser never receives lesson bodies. «Edit»
 * reads that one lesson's content on demand through the teacher's session.
 */

const lessonRead = vi.fn()
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: (cols: string) => ({ eq: (col: string, val: string) => ({ single: async () => lessonRead(table, cols, col, val) }) }),
    }),
  }),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/teacher/lessons',
  useSearchParams: () => new URLSearchParams(),
}))
const tStub = Object.assign((k: string, v?: Record<string, unknown>) => `${k}${v ? ':' + Object.values(v).join('/') : ''}`, { rich: (k: string) => k, has: () => true })
vi.mock('next-intl', () => ({ useTranslations: () => tStub, useLocale: () => 'en' }))
vi.mock('@/components/shared/ai-quota', () => ({ AiQuota: () => null }))
vi.mock('@/components/ui/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { loadTeacherLessons, lessonExcerpt, toLessonRow, TEACHER_LESSONS_PAGE_SIZE } from '@/lib/data/teacher-lessons'
import { LessonsClient } from '@/app/(teacher)/teacher/lessons/lessons-client'

type Call = [string, ...unknown[]]
let calls: Call[][]
let reply: { data?: unknown[]; count?: number; error?: { code?: string; message: string } | null }[]
function db() {
  return {
    from(table: string) {
      const c: Call[] = [['from', table]]
      calls.push(c)
      const ch: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'order', 'range']) ch[m] = (...a: unknown[]) => { c.push([m, ...a]); return ch }
      ch.then = (resolve: (v: unknown) => unknown) => {
        const head = c.some(x => x[0] === 'select' && (x[2] as { head?: boolean } | undefined)?.head)
        return Promise.resolve(head ? { count: 120, error: null } : { data: [], count: 0, error: null, ...reply.shift() }).then(resolve)
      }
      return ch
    },
  }
}
const raw = (i: number, content: string | null) => ({ id: `l${i}`, title: `Lesson ${i}`, is_published: true, created_at: '2026-10-01T00:00:00Z', content, groups: { name: 'G' } })

beforeEach(() => { calls = []; reply = []; lessonRead.mockReset() })

describe('lessonExcerpt', () => {
  it('is exactly what the list used to show: markdown marks removed, first 150 characters', () => {
    const body = '# Title\n\n**Bold** `code` ' + 'x'.repeat(400)
    expect(lessonExcerpt(body)).toBe(body.replace(/[#*`]/g, '').slice(0, 150))
    expect(lessonExcerpt(null)).toBe('')
  })
})

describe('loadTeacherLessons', () => {
  it('one page of 50 of the teacher\'s lessons, named columns, exact count; rows carry an excerpt, never the body', async () => {
    reply = [{ data: [raw(1, 'A'.repeat(20000)), raw(2, null)], count: 300 }]
    const { data, error } = await loadTeacherLessons(db() as never, 'teacher-1', '2')
    expect(error).toBeNull()
    const q = calls[0]
    expect(q).toContainEqual(['from', 'lessons'])
    expect(q).toContainEqual(['select', 'id, title, is_published, created_at, content, groups(name)', { count: 'exact' }])
    expect(q).toContainEqual(['eq', 'teacher_id', 'teacher-1'])
    expect(q).toContainEqual(['order', 'created_at', { ascending: false }])
    expect(q).toContainEqual(['range', TEACHER_LESSONS_PAGE_SIZE, 2 * TEACHER_LESSONS_PAGE_SIZE - 1])
    expect(data).toMatchObject({ total: 300, page: 2, pageCount: 6 })
    expect(Object.keys(data.rows[0]).sort()).toEqual(['created_at', 'excerpt', 'groups', 'id', 'is_published', 'title'])
    expect(data.rows[0].excerpt).toHaveLength(150)
    expect(JSON.stringify(data).length).toBeLessThan(1000)
  })

  it('a page past the end → the last page', async () => {
    reply = [{ error: { code: 'PGRST103', message: 'range' } }, { data: [raw(9, 'x')], count: 120 }]
    const { data } = await loadTeacherLessons(db() as never, 'teacher-1', '99')
    expect(data.page).toBe(3)
    expect(calls.at(-1)).toContainEqual(['range', 100, 149])
  })
})

describe('LessonsClient', () => {
  const rows = [toLessonRow(raw(1, '# Hello **world**')), toLessonRow(raw(2, null))]

  it('shows the excerpt and the database total; Previous / Next only with more than one page', () => {
    const { rerender, container } = render(<LessonsClient initialLessons={rows} groups={[]} pagination={{ page: 1, pageCount: 1, total: 2 }} />)
    expect(container.textContent).toContain(' Hello world...')
    expect(container.textContent).not.toContain('**')
    expect(screen.getByText('lessons.subtitle:2')).toBeTruthy()
    expect(screen.queryByText(/pageOf/)).toBeNull()
    rerender(<LessonsClient initialLessons={rows} groups={[]} pagination={{ page: 2, pageCount: 6, total: 300 }} />)
    expect(screen.getByText('pageOf:2/6')).toBeTruthy()
    expect(screen.getByText('lessons.subtitle:300')).toBeTruthy()
  })

  it('«Edit» reads THAT lesson\'s content on demand and fills the editor with it', async () => {
    lessonRead.mockResolvedValue({ data: { content: 'Full body of lesson one' }, error: null })
    const { container } = render(<LessonsClient initialLessons={rows} groups={[]} pagination={{ page: 1, pageCount: 1, total: 2 }} />)
    const edit = [...container.querySelectorAll('button')].filter(b => b.querySelector('svg.lucide-pencil'))[0]
    fireEvent.click(edit)
    await waitFor(() => expect(lessonRead).toHaveBeenCalledWith('lessons', 'content', 'id', 'l1'))
    await waitFor(() => expect(screen.getByDisplayValue('Full body of lesson one')).toBeTruthy())
  })

  it('a failed content read does not open the editor', async () => {
    lessonRead.mockResolvedValue({ data: null, error: { message: 'denied' } })
    const { container } = render(<LessonsClient initialLessons={rows} groups={[]} pagination={{ page: 1, pageCount: 1, total: 2 }} />)
    fireEvent.click([...container.querySelectorAll('button')].filter(b => b.querySelector('svg.lucide-pencil'))[0])
    await waitFor(() => expect(lessonRead).toHaveBeenCalled())
    expect(screen.queryByText('lessons.modal.editTitle')).toBeNull()
  })
})
