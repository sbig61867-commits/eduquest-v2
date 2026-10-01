import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

/**
 * Batch 2 / C-S — RosterModal (/center/groups and /center/courses): the pages
 * no longer send the student body. Nothing is offered until the user types;
 * then ONE search per pause goes to /api/roster/candidates for THIS target
 * (≤ 20, members already left out on the server). The member list, add,
 * remove and transfer still use the same endpoints and bodies.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }))
// One translator per namespace, stable across renders — like next-intl's own
// (useMemo). RosterModal's member-list effect depends on `t`; a new function per
// render would reload the members forever (a mock artefact, not app behaviour).
vi.mock('next-intl', () => {
  const cache = new Map<string, (key: string, vars?: Record<string, unknown>) => string>()
  return {
    useTranslations: (ns: string) => {
      if (!cache.has(ns)) {
        cache.set(ns, (key, vars) => `${ns.split('.').pop()}.${key}${vars ? ':' + Object.values(vars).join('/') : ''}`)
      }
      return cache.get(ns)!
    },
  }
})
vi.mock('@/components/ui/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/confirm-dialog', () => ({ confirmDialog: () => Promise.resolve(true) }))

import { RosterModal } from '@/components/center/roster-modal'
import { CenterCoursesClient } from '@/components/center/courses-client'

const MEMBER = { id: 'm1', full_name: 'Member Mona', email: 'mona@x.test' }
let candidatesReply: { id: string; full_name: string }[]
// A stateful roster: GET answers one page of 50 from it (C-M), POST/DELETE change it.
let roster: { id: string; full_name: string; email: string }[]
const rosterPage = (url: string) => {
  const page = Number(new URL(url, 'http://x').searchParams.get('page') ?? '1')
  const pageCount = Math.max(1, Math.ceil(roster.length / 50))
  const p = Math.min(page, pageCount)
  return { students: roster.slice((p - 1) * 50, p * 50), total: roster.length, page: p, pageCount }
}
const memberReads = () => fetchMock.mock.calls.filter(([u]) => /^\/api\/(group-students|course-enrollments)\?/.test(String(u)))
const fetchMock = vi.fn()
const searchCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).startsWith('/api/roster/candidates'))

beforeEach(() => {
  candidatesReply = [{ id: 's1', full_name: 'Sara Ali' }, { id: 's2', full_name: 'Salem Odeh' }]
  roster = [MEMBER]
  fetchMock.mockReset().mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/roster/candidates')) return { ok: true, json: async () => ({ students: candidatesReply }) }
    if (/^\/api\/(group-students|course-enrollments)\?/.test(url)) return { ok: true, json: async () => rosterPage(url) }
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body))
      const student = { id: body.student_id, full_name: 'Sara Ali', email: 'sara@x.test' }
      if (!roster.some(m => m.id === student.id)) roster = [student, ...roster]
      return { ok: true, json: async () => ({ student }) }
    }
    if (init?.method === 'DELETE') {
      const body = JSON.parse(String(init.body))
      roster = roster.filter(m => m.id !== body.student_id)
    }
    return { ok: true, json: async () => ({ ok: true }) }
  })
  vi.stubGlobal('fetch', fetchMock)
})

const modal = (idKey: 'group_id' | 'course_id', onChanged = vi.fn()) => render(
  <RosterModal open onClose={vi.fn()} title="Roster" idKey={idKey} targetId="target-1" onChanged={onChanged}
    endpoint={idKey === 'group_id' ? '/api/group-students' : '/api/course-enrollments'} />,
)
const typeIn = (v: string) => fireEvent.change(screen.getByPlaceholderText('roster.search'), { target: { value: v } })
const select = () => screen.getByRole('combobox') as HTMLSelectElement

describe.each(['group_id', 'course_id'] as const)('RosterModal (%s)', idKey => {
  it('offers nothing and asks nothing until the user types; the member list loads as before', async () => {
    modal(idKey)
    await waitFor(() => expect(screen.getByText('Member Mona')).toBeTruthy())
    expect(fetchMock).toHaveBeenCalledWith(`/api/${idKey === 'group_id' ? 'group-students' : 'course-enrollments'}?${idKey}=target-1&page=1`)
    expect(select().disabled).toBe(true)
    expect(screen.getByText('roster.typeToSearch')).toBeTruthy()
    expect(select().options).toHaveLength(1)
    await new Promise(r => setTimeout(r, 400))
    expect(searchCalls()).toHaveLength(0)
  })

  it('ONE search per pause, for THIS target; options are the results (≤ 20)', async () => {
    modal(idKey)
    for (const v of ['s', 'sa', 'sar']) typeIn(v)
    await waitFor(() => expect(screen.getByText('Sara Ali')).toBeTruthy())
    expect(searchCalls()).toHaveLength(1)
    expect(searchCalls()[0][0]).toBe(`/api/roster/candidates?${idKey}=target-1&q=sar`)
    expect(select().disabled).toBe(false)
    expect(select().options).toHaveLength(3) // label + 2 results
    expect(screen.getByText('roster.pick:2')).toBeTruthy()
  })

  it('a current member is never offered, even if a result contains them', async () => {
    candidatesReply = [{ id: 'm1', full_name: 'Member Mona' }, { id: 's1', full_name: 'Sara Ali' }]
    modal(idKey)
    await waitFor(() => expect(screen.getByText('Member Mona')).toBeTruthy())
    typeIn('a')
    await waitFor(() => expect(screen.getByText('Sara Ali')).toBeTruthy())
    expect([...select().options].map(o => o.value)).toEqual(['', 's1'])
  })

  it('add uses the same endpoint and body as before, then the student leaves the candidates', async () => {
    const onChanged = vi.fn()
    modal(idKey, onChanged)
    await waitFor(() => expect(screen.getByText('Member Mona')).toBeTruthy())
    typeIn('sara')
    await waitFor(() => expect(screen.getByText('Sara Ali')).toBeTruthy())
    fireEvent.change(select(), { target: { value: 's1' } })
    fireEvent.click(screen.getByText('roster.add'))
    const endpoint = idKey === 'group_id' ? '/api/group-students' : '/api/course-enrollments'
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(endpoint, expect.objectContaining({
      method: 'POST', body: JSON.stringify({ [idKey]: 'target-1', student_id: 's1' }),
    })))
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(2))
    await waitFor(() => expect([...select().options].map(o => o.value)).toEqual(['', 's2']))
    // C-M: the page is re-read once after the add — the server's total is what the parent gets.
    expect(memberReads()).toHaveLength(2)
  })

  it('clearing the box goes back to «type to search» without another request', async () => {
    modal(idKey)
    typeIn('sara')
    await waitFor(() => expect(screen.getByText('Sara Ali')).toBeTruthy())
    typeIn('')
    expect(screen.getByText('roster.typeToSearch')).toBeTruthy()
    expect(select().disabled).toBe(true)
    await new Promise(r => setTimeout(r, 400))
    expect(searchCalls()).toHaveLength(1)
  })
})

describe('RosterModal — robustness', () => {
  it('a slow older answer never overwrites a newer one', async () => {
    let releaseOld: (v: unknown) => void = () => {}
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('q=ol')) {
        await new Promise(r => { releaseOld = r })
        return { ok: true, json: async () => ({ students: [{ id: 'old', full_name: 'Old Answer' }] }) }
      }
      if (url.startsWith('/api/roster/candidates')) return { ok: true, json: async () => ({ students: [{ id: 'new', full_name: 'New Answer' }] }) }
      return { ok: true, json: async () => ({ students: [] }) }
    })
    modal('course_id')
    typeIn('ol')
    await waitFor(() => expect(searchCalls()).toHaveLength(1))
    typeIn('new')
    await waitFor(() => expect(screen.getByText('New Answer')).toBeTruthy())
    await act(async () => { releaseOld(null); await new Promise(r => setTimeout(r, 20)) })
    expect(screen.queryByText('Old Answer')).toBeNull()
  })

  it('/center/courses opens the roster for the course and searches with course_id', async () => {
    render(<CenterCoursesClient hasTeachers initialCourses={[{ id: 'c9', title: 'Arabic', description: null, is_published: true,
      teacher_id: 't1', teacher_name: 'Sara Idris', units: 1, enrollments: 1 }]} />)
    fireEvent.click(screen.getByText('courses.enrollments'))
    typeIn('sa')
    await waitFor(() => expect(searchCalls()).toHaveLength(1))
    expect(searchCalls()[0][0]).toBe('/api/roster/candidates?course_id=c9&q=sa')
  })
})

describe('RosterModal — member list one page at a time (C-M)', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `m${i}`, full_name: `Member ${i}`, email: `m${i}@x.test` }))
  const memberRows = () => [...document.querySelectorAll('.divide-y > div')]

  it('120 members: 50 rows, «page 1 of 3», the total from the server; Next / Previous re-read that page', async () => {
    roster = many(120)
    modal('course_id')
    await waitFor(() => expect(memberRows()).toHaveLength(50))
    expect(screen.getByText('roster.count:120')).toBeTruthy()
    expect(screen.getByText('pagination.pageOf:1/3')).toBeTruthy()
    expect((screen.getByText('pagination.prev').closest('button') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByText('pagination.next'))
    await waitFor(() => expect(screen.getByText('Member 50')).toBeTruthy())
    expect(memberReads().at(-1)![0]).toBe('/api/course-enrollments?course_id=target-1&page=2')
    fireEvent.click(screen.getByText('pagination.next'))
    await waitFor(() => expect(memberRows()).toHaveLength(20))
    expect((screen.getByText('pagination.next').closest('button') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByText('pagination.prev'))
    await waitFor(() => expect(screen.getByText('pagination.pageOf:2/3')).toBeTruthy())
  })

  it('a small roster shows no paging controls', async () => {
    roster = many(3)
    modal('group_id')
    await waitFor(() => expect(memberRows()).toHaveLength(3))
    expect(screen.queryByText('pagination.next')).toBeNull()
  })

  it('removing the only member of the last page lands on the new last page; the parent gets the server total', async () => {
    roster = many(51)
    const onChanged = vi.fn()
    modal('group_id', onChanged)
    await waitFor(() => expect(memberRows()).toHaveLength(50))
    fireEvent.click(screen.getByText('pagination.next'))
    await waitFor(() => expect(screen.getByText('Member 50')).toBeTruthy())
    fireEvent.click(screen.getByText('roster.remove'))
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(50))
    await waitFor(() => expect(memberRows()).toHaveLength(50))
    expect(screen.queryByText('pagination.next')).toBeNull()
    expect(fetchMock).toHaveBeenCalledWith('/api/group-students', expect.objectContaining({
      method: 'DELETE', body: JSON.stringify({ group_id: 'target-1', student_id: 'm50' }),
    }))
  })

  it('a member on the loaded page is never offered, even from a stale result; nothing is reported without a change', async () => {
    roster = [MEMBER, { id: 's1', full_name: 'Sara Ali', email: 'sara@x.test' }]
    candidatesReply = [{ id: 's1', full_name: 'Sara Ali' }] // e.g. a stale search result
    const onChanged = vi.fn()
    render(<RosterModal open onClose={vi.fn()} title="R" idKey="group_id" targetId="target-1" endpoint="/api/group-students" onChanged={onChanged} />)
    await waitFor(() => expect(memberRows()).toHaveLength(2))
    fetchMock.mockClear()
    typeIn('sa')
    await waitFor(() => expect(searchCalls()).toHaveLength(1))
    expect([...select().options].map(o => o.value)).toEqual(['']) // s1 is a member → not offered
    expect(onChanged).not.toHaveBeenCalled()
  })
})
