import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

/**
 * B (absorbs F1) — /center/groups on the SQL layer (step 9): ONE unit read as
 * the centre manager. The table is one server page of 50 (newest first, `id`
 * breaks ties, a page past the end becomes the last page — clamped in the
 * statement), the active / archived totals come from the database, and the
 * transfer picker offers EVERY active group of the institution — not just this
 * page. A failed read fails the page.
 */

type Q = { text: string; values: unknown[]; ctx: { as: string; userId?: string } }
const db = vi.hoisted(() => ({
  calls: [] as Q[],
  page: { active: 0, archived: 0, page: 1, rows: [] as Record<string, unknown>[] },
  picker: [] as unknown[],
  fail: null as null | ((q: Q) => boolean),
}))
vi.mock('@/lib/db/sql', async () => (await import('./helpers/fake-sql')).fakeSqlModule(q => {
  db.calls.push(q as Q)
  if (db.fail?.(q as Q)) return new Error('boom')
  if (q.text.startsWith('with t as')) return [db.page]
  if (q.text.startsWith('select g.id, g.name, g.course_id, g.max_students')) return db.picker
  return new Error('unexpected statement: ' + q.text)
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/center/groups',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, v?: Record<string, unknown>) => (v ? `${key}:${JSON.stringify(v)}` : key),
}))
vi.mock('@/components/ui/toast', () => ({ toast: Object.assign(() => {}, { success: () => {}, error: () => {} }) }))
// The roster modal is not under test: it only hands the client a student to transfer.
vi.mock('@/components/center/roster-modal', () => ({
  RosterModal: ({ open, onTransfer }: { open: boolean; onTransfer: (m: { id: string; full_name: string }) => void }) =>
    open ? <button onClick={() => onTransfer({ id: 'stu', full_name: 'Sara' })}>start-transfer</button> : null,
}))

import { loadCenterGroupsPage, CENTER_GROUPS_PAGE_SIZE } from '@/lib/data/center-groups'
import { CenterGroupsClient } from '@/components/center/groups-client'

const TENANT = 'tn'
const row = (k: number) => ({
  id: `g${k}`, name: `Group ${k}`, description: null, is_active: true, teacher_id: 't1', course_id: null, image_url: null,
  max_students: 30, instructions: null, created_at: '2026-01-01T00:00:00Z', group_students: [{ count: 3 }],
  teacher: { full_name: 'T', role: 'teacher', is_active: true },
})
const pageStatement = () => db.calls.find(q => q.text.startsWith('with t as'))!
const pickerStatement = () => db.calls.find(q => q.text.startsWith('select g.id, g.name, g.course_id'))!

beforeEach(() => {
  db.calls = []
  db.fail = null
  db.page = { active: 1500, archived: 300, page: 1, rows: Array.from({ length: CENTER_GROUPS_PAGE_SIZE }, (_, k) => row(k)) }
  db.picker = Array.from({ length: 1500 }, (_, k) => ({ id: `g${k}`, name: `Group ${k}`, course_id: null, max_students: 30, group_students: [{ count: 1 }] }))
})

describe('loadCenterGroupsPage: 1 500 active + 300 archived groups', () => {
  it('ONE unit as the centre manager: one page of 50, totals from the database, and every active group for the picker', async () => {
    const out = await loadCenterGroupsPage('mgr-1', TENANT, undefined)
    expect(db.calls).toHaveLength(2)
    expect(db.calls.every(q => q.ctx.as === 'user' && q.ctx.userId === 'mgr-1')).toBe(true)
    expect(out.rows).toHaveLength(CENTER_GROUPS_PAGE_SIZE)
    expect(out).toMatchObject({ page: 1, total: 1800, active: 1500, archived: 300, pageCount: 36 })
    expect(out.transferOptions).toHaveLength(1500)
  })

  it('the picker reads only the fields it shows, active groups of the institution only, unbounded by the page', async () => {
    await loadCenterGroupsPage('mgr-1', TENANT, '1')
    const q = pickerStatement()
    expect(q.text).toMatch(/^select g\.id, g\.name, g\.course_id, g\.max_students, json_build_array\(/)
    expect(q.text).toContain('where g.tenant_id = $ and g.is_active order by g.name, g.id')
    expect(q.text).not.toContain('limit')
    expect(q.values).toEqual([TENANT])
  })

  it('the table page: newest first with id breaking ties; the requested page and size are parameters, clamped in the statement', async () => {
    await loadCenterGroupsPage('mgr-1', TENANT, '7')
    const q = pageStatement()
    expect(q.text).toContain('order by g.created_at desc, g.id')
    expect(q.text).toContain('least($, greatest(1, ceil((active + archived) / $::numeric)::int))')
    expect(q.values).toEqual([TENANT, 7, CENTER_GROUPS_PAGE_SIZE, TENANT, CENTER_GROUPS_PAGE_SIZE, CENTER_GROUPS_PAGE_SIZE])
  })

  it('a page past the end serves the page the statement answers (the last one)', async () => {
    db.page = { ...db.page, page: 36 }
    const out = await loadCenterGroupsPage('mgr-1', TENANT, '99')
    expect(out.page).toBe(36)
  })

  it('the table page names exactly the columns the table uses (no `*`), with the count and teacher embeds; created_at stays on the server', async () => {
    const out = await loadCenterGroupsPage('mgr-1', TENANT, '1')
    const q = pageStatement()
    expect(q.text).toContain('select g.id, g.name, g.description, g.is_active, g.teacher_id, g.course_id, g.image_url, g.max_students, g.instructions')
    expect(q.text).not.toMatch(/select \*|g\.\*/)
    expect(q.text).toContain("json_build_object('full_name', u.full_name, 'role', u.role, 'is_active', u.is_active) end as teacher")
    expect(out.rows[0]).not.toHaveProperty('created_at')
  })

  it('reads stay scoped to the institution (tenant filter on every groups read)', async () => {
    await loadCenterGroupsPage('mgr-1', TENANT, '1')
    expect(pageStatement().text).toContain('from public.groups where tenant_id = $')
    expect(pageStatement().text).toContain('where g.tenant_id = $')
    expect(pickerStatement().text).toContain('where g.tenant_id = $')
  })

  it('any failed read fails the page: the picker or the table page', async () => {
    db.fail = q => q.text.startsWith('select g.id, g.name, g.course_id')
    await expect(loadCenterGroupsPage('mgr-1', TENANT, '1')).rejects.toThrow('boom')
    db.fail = q => q.text.startsWith('with t as')
    await expect(loadCenterGroupsPage('mgr-1', TENANT, '1')).rejects.toThrow('boom')
  })

  it('under the cap: all rows on one page, totals and picker exact', async () => {
    db.page = { active: 7, archived: 3, page: 1, rows: Array.from({ length: 10 }, (_, k) => row(k)) }
    db.picker = db.picker.slice(0, 7)
    const out = await loadCenterGroupsPage('mgr-1', TENANT, undefined)
    expect(out).toMatchObject({ total: 10, active: 7, archived: 3, pageCount: 1 })
    expect(out.rows).toHaveLength(10)
    expect(out.transferOptions).toHaveLength(7)
  })
})

describe('CenterGroupsClient: the transfer picker offers every active group, not just this page', () => {
  const row = (id: string, name: string, course: string | null) => ({
    id, name, description: null, is_active: true, teacher_id: 't1', teacher_name: 'T', student_count: 3,
    course_id: course, image_url: null, max_students: null, instructions: null,
  })

  it('options come from the full list (minus the source group); the summary from the database counts', () => {
    render(<CenterGroupsClient
      hasTeachers
      initialGroups={[row('g-src', 'Source', 'c1')]}
      summary={{ active: 1500, archived: 300 }}
      page={1} pageCount={36}
      courses={[{ id: 'c1', name: 'Course 1' }, { id: 'c2', name: 'Course 2' }]}
      transferOptions={[
        { id: 'g-src', name: 'Source', course_id: 'c1', max_students: null, student_count: 3 },
        { id: 'g-far', name: 'Far page group', course_id: 'c2', max_students: 30, student_count: 12 },
      ]}
    />)
    expect(screen.getByText('summary:{"active":1500,"archived":300}')).toBeTruthy()
    fireEvent.click(screen.getByText('students'))
    fireEvent.click(screen.getByText('start-transfer'))
    const options = Array.from(document.querySelectorAll('option')).map(o => o.textContent)
    expect(options).toEqual(['pickGroup', 'Far page group — Course 2 (12/30)'])
    // Picking a group of another course still shows the course-change warning.
    fireEvent.change(document.querySelector('select')!, { target: { value: 'g-far' } })
    expect(screen.getByText(/courseChangeWarning/)).toBeTruthy()
  })
})
