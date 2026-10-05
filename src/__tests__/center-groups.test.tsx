import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { groupsMock, gid, type GroupsCall as Call, type GroupsWorld as World } from './center-groups-fixture'
import { loadCenterGroupsPage, CENTER_GROUPS_PAGE_SIZE } from '@/lib/data/center-groups'
import { IncompleteReadError } from '@/lib/data/complete-read'

/**
 * B (absorbs F1) — /center/groups past the API's 1000-row cap: the table is one
 * server page of 50 (newest first, stable), the active / archived totals come
 * from the database, and the transfer picker still offers EVERY active group of
 * the institution, read completely — a failed read fails the page.
 */

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

import { CenterGroupsClient } from '@/components/center/groups-client'

const TENANT = 'tn'
function world(active: number, archived: number): World {
  const group = (k: number, isActive: boolean, tenant = TENANT) => ({
    id: gid(k), tenant_id: tenant, name: `Group ${String(k).padStart(4, '0')}`, description: null, is_active: isActive,
    teacher_id: 't1', course_id: k % 2 ? 'c1' : null, image_url: null, max_students: 30, instructions: null,
    // Several groups share a created_at, so `id` must break the tie for stable pages.
    created_at: `2026-0${1 + (k % 9)}-01T00:00:00Z`,
    group_students: [{ count: k % 30 }], teacher: { full_name: 'T', role: 'teacher', is_active: true },
  })
  return {
    groups: [
      ...Array.from({ length: active }, (_, k) => group(k, true)),
      ...Array.from({ length: archived }, (_, k) => group(active + k, false)),
      group(9999, true, 'other-tenant'),
    ],
  }
}

describe('loadCenterGroupsPage: 1 500 active + 300 archived groups', () => {
  const W = world(1500, 300)

  it('one page of 50, totals from the database, and every active group for the picker', async () => {
    const out = await loadCenterGroupsPage(groupsMock(W) as never, TENANT, undefined)
    expect(out.rows).toHaveLength(CENTER_GROUPS_PAGE_SIZE)
    expect(out).toMatchObject({ page: 1, total: 1800, active: 1500, archived: 300, pageCount: 36 })
    expect(out.transferOptions).toHaveLength(1500)                                  // past the 1000-row cap
    expect(out.transferOptions.every(o => W.groups.find(g => g.id === o.id)!.is_active)).toBe(true)
    expect(out.transferOptions.some(o => o.id === gid(9999))).toBe(false)      // another institution
  })

  it('the picker reads only the fields it shows, active groups only', async () => {
    const calls: Call[] = []
    await loadCenterGroupsPage(groupsMock(W, { calls }) as never, TENANT, '1')
    const picker = calls.filter(c => c.columns === 'id, name, course_id, max_students, group_students(count)')
    expect(picker.length).toBeGreaterThan(1)                                       // > 1000 rows: more than one page
    for (const c of picker) expect(c.filters).toContainEqual(['eq', 'is_active', true])
  })

  it('the pages cover every group once, newest first with id breaking ties', async () => {
    const seen: string[] = []
    let last: { created_at: string; id: string } | null = null
    for (let p = 1; p <= 36; p++) {
      const { rows } = await loadCenterGroupsPage(groupsMock(W) as never, TENANT, String(p))
      for (const r of rows as unknown as { id: string; created_at: string }[]) {
        if (last) expect(r.created_at < last.created_at || (r.created_at === last.created_at && r.id > last.id)).toBe(true)
        last = r; seen.push(r.id)
      }
    }
    expect(seen).toHaveLength(1800)
    expect(new Set(seen).size).toBe(1800)
  })

  it('a page past the end serves the last page', async () => {
    const out = await loadCenterGroupsPage(groupsMock(W) as never, TENANT, '99')
    expect(out.page).toBe(36)
    expect(out.rows).toHaveLength(50)
  })

  it('the table page names exactly the columns the table uses (no `*`), with the count and teacher embeds', async () => {
    const calls: Call[] = []
    await loadCenterGroupsPage(groupsMock(W, { calls }) as never, TENANT, '1')
    const table = calls.find(c => c.range && c.columns.startsWith('id, name, description'))!
    expect(table.columns).toBe('id, name, description, is_active, teacher_id, course_id, image_url, max_students, instructions, group_students(count), teacher:users!groups_teacher_id_fkey(full_name, role, is_active)')
    expect(calls.some(c => c.columns.includes('*'))).toBe(false)
    expect(table.filters).toEqual([
      ['eq', 'tenant_id', TENANT], ['order', 'created_at', { ascending: false }], ['order', 'id', { ascending: true }],
    ])
  })

  it('reads stay scoped to the institution (tenant filter on every groups read)', async () => {
    const calls: Call[] = []
    await loadCenterGroupsPage(groupsMock(W, { calls }) as never, TENANT, '1')
    for (const c of calls) expect(c.filters).toContainEqual(['eq', 'tenant_id', TENANT])
  })

  it('any failed read fails the page: picker page, a total, or the table page', async () => {
    const pickerPage2 = (c: Call) => c.columns.startsWith('id, name, course_id') && c.range?.[0] === 1000
    await expect(loadCenterGroupsPage(groupsMock(W, { fail: pickerPage2 }) as never, TENANT, '1')).rejects.toBeInstanceOf(IncompleteReadError)
    await expect(loadCenterGroupsPage(groupsMock(W, { fail: c => c.head && c.filters.some(f => f[1] === 'is_active' && f[2] === false) }) as never, TENANT, '1')).rejects.toBeInstanceOf(IncompleteReadError)
    await expect(loadCenterGroupsPage(groupsMock(W, { fail: c => c.columns.startsWith('id, name, description') }) as never, TENANT, '1')).rejects.toBeInstanceOf(IncompleteReadError)
  })

  it('under the cap: all rows on one page, totals and picker exact', async () => {
    const out = await loadCenterGroupsPage(groupsMock(world(7, 3)) as never, TENANT, undefined)
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
