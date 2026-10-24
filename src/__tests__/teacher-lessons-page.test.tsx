import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

/**
 * Batch 3 / P-03 — /teacher/lessons. loadTeacherLessons reads one page of 50
 * lessons (named columns) and turns each body into the same 150-char excerpt
 * the list always showed — the browser never receives lesson bodies. «Edit»
 * opens the lesson's own page (the block builder), reading nothing in the list.
 */

const lessonRead = vi.fn()
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: (cols: string) => ({ eq: (col: string, val: string) => ({ single: async () => lessonRead(table, cols, col, val) }) }),
    }),
  }),
}))
const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push }),
  usePathname: () => '/teacher/lessons',
  useSearchParams: () => new URLSearchParams(),
}))
const tStub = Object.assign((k: string, v?: Record<string, unknown>) => `${k}${v ? ':' + Object.values(v).join('/') : ''}`, { rich: (k: string) => k, has: () => true })
vi.mock('next-intl', () => ({ useTranslations: () => tStub, useLocale: () => 'en' }))
vi.mock('@/components/shared/ai-quota', () => ({ AiQuota: () => null }))
vi.mock('@/components/ui/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { loadTeacherLessons, lessonExcerpt, toLessonRow, TEACHER_LESSONS_PAGE_SIZE } from '@/lib/data/teacher-lessons'
import { LessonsClient } from '@/app/(teacher)/teacher/lessons/lessons-client'

// loadTeacherLessons is ONE statement read as the teacher (step 9); the
// statement clamps the page, so the fake answers with the page it would.
type Q = { text: string; values: unknown[]; ctx: { as: string; userId?: string } }
const db = vi.hoisted(() => ({ calls: [] as Q[], reply: null as null | { total: number; page: number; rows: unknown[] } | Error }))
vi.mock('@/lib/db/sql', async () => (await import('./helpers/fake-sql')).fakeSqlModule(q => {
  db.calls.push(q as Q)
  if (db.reply instanceof Error) return db.reply
  return db.reply ? [db.reply] : []
}))
const raw = (i: number, content: string | null) => ({ id: `l${i}`, title: `Lesson ${i}`, is_published: true, created_at: '2026-10-01T00:00:00Z', content, groups: { name: 'G' } })

beforeEach(() => { db.calls = []; db.reply = null; lessonRead.mockReset() })

describe('lessonExcerpt', () => {
  it('is exactly what the list used to show: markdown marks removed, first 150 characters', () => {
    const body = '# Title\n\n**Bold** `code` ' + 'x'.repeat(400)
    expect(lessonExcerpt(body)).toBe(body.replace(/[#*`]/g, '').slice(0, 150))
    expect(lessonExcerpt(null)).toBe('')
  })
})

describe('loadTeacherLessons', () => {
  it('one page of 50 of the teacher\'s lessons as the teacher, named columns, exact count; rows carry an excerpt, never the body', async () => {
    db.reply = { total: 300, page: 2, rows: [raw(1, 'A'.repeat(20000)), raw(2, null)] }
    const { data, error } = await loadTeacherLessons('teacher-1', '2')
    expect(error).toBeNull()
    expect(db.calls).toHaveLength(1)
    const [q] = db.calls
    expect(q.ctx).toEqual({ as: 'user', userId: 'teacher-1' })
    expect(q.text).toContain('select l.id, l.title, l.is_published, l.created_at, l.content, g.name as group_name')
    expect(q.text).toContain('where l.teacher_id = $')
    expect(q.text).toContain('order by l.created_at desc, l.id')
    expect(q.values).toEqual(['teacher-1', 2, TEACHER_LESSONS_PAGE_SIZE, 'teacher-1', TEACHER_LESSONS_PAGE_SIZE, TEACHER_LESSONS_PAGE_SIZE])
    expect(data).toMatchObject({ total: 300, page: 2, pageCount: 6 })
    expect(Object.keys(data.rows[0]).sort()).toEqual(['created_at', 'excerpt', 'groups', 'id', 'is_published', 'title'])
    expect(data.rows[0].excerpt).toHaveLength(150)
    expect(JSON.stringify(data).length).toBeLessThan(1000)
  })

  it('a page past the end → the statement answers the last page', async () => {
    db.reply = { total: 120, page: 3, rows: [raw(9, 'x')] }
    const { data } = await loadTeacherLessons('teacher-1', '99')
    expect(db.calls[0].text).toContain('least($, greatest(1, ceil(n / $::numeric)::int))')
    expect(data.page).toBe(3)
  })

  it('a failed read is an error with an empty page, never a partial one', async () => {
    db.reply = new Error('boom')
    expect(await loadTeacherLessons('teacher-1', '1')).toEqual({ data: { rows: [], total: 0, page: 1, pageCount: 1 }, error: { message: 'boom' } })
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

  it('«Edit» opens THAT lesson in the block builder and reads no body in the list', () => {
    push.mockReset()
    const { container } = render(<LessonsClient initialLessons={rows} groups={[]} pagination={{ page: 1, pageCount: 1, total: 2 }} />)
    fireEvent.click([...container.querySelectorAll('button')].filter(b => b.querySelector('svg.lucide-pencil'))[0])
    expect(push).toHaveBeenCalledWith('/teacher/lessons/l1')
    expect(lessonRead).not.toHaveBeenCalled()
  })
})
