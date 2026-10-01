import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

/**
 * Batch 2 / T1 — /teacher/groups «إدارة الطلاب»: the page no longer receives the
 * institution's students. Nothing is listed until the teacher types; then ONE
 * search per pause goes to /api/students/search (≤ 20 results), members of the
 * group never appear as candidates, and adding / removing still go through the
 * unchanged /api/group-students POST / DELETE.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }))
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${Object.values(vars).join('/')}` : key,
}))
vi.mock('@/lib/confirm-dialog', () => ({ confirmDialog: () => Promise.resolve(true) }))
vi.mock('@/components/ui/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { GroupsClient } from '@/app/(teacher)/teacher/groups/groups-client'

const GROUP = { id: 'g1', name: 'Group One', description: null, created_at: '2026-09-01T00:00:00Z', is_active: true, group_students: [{ count: 1 }] }
const MEMBER = { id: 'm1', full_name: 'Member Mona', email: 'mona@x.test' }

let searchReply: { id: string; full_name: string; email: string }[]
const fetchMock = vi.fn()
const searchCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/students/search'))

beforeEach(() => {
  searchReply = [{ id: 's1', full_name: 'Sara Ali', email: 'sara@x.test' }]
  fetchMock.mockReset().mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/group-students?group_id=')) return { ok: true, json: async () => ({ students: [MEMBER] }) }
    if (url.startsWith('/api/students/search')) return { ok: true, json: async () => ({ students: searchReply }) }
    if (url === '/api/group-students' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body))
      return { ok: true, json: async () => ({ student: { id: body.student_id } }) }
    }
    if (url === '/api/group-students' && init?.method === 'DELETE') return { ok: true, json: async () => ({ ok: true }) }
    return { ok: false, json: async () => ({}) }
  })
  vi.stubGlobal('fetch', fetchMock)
})

async function openManage() {
  render(<GroupsClient initialGroups={[GROUP]} teacherId="t1" tenantId="ten1" />)
  fireEvent.click(screen.getByText(/groups\.manageStudents/))
  await waitFor(() => expect(screen.getByText('Member Mona')).toBeTruthy())
}

describe('teacher groups — student selector (T1)', () => {
  it('opening the modal lists no candidates and sends no search: «type to search»', async () => {
    await openManage()
    expect(screen.getByText('groups.studentsModal.typeToSearch')).toBeTruthy()
    await new Promise(r => setTimeout(r, 400))
    expect(searchCalls()).toHaveLength(0)
  })

  it('typing sends ONE search per pause, with the group, and shows the results', async () => {
    await openManage()
    const box = screen.getByPlaceholderText('groups.studentsModal.searchPlaceholder')
    for (const v of ['s', 'sa', 'sar', 'sara']) fireEvent.change(box, { target: { value: v } })
    await waitFor(() => expect(screen.getByText('Sara Ali')).toBeTruthy())
    expect(searchCalls()).toHaveLength(1)
    expect(searchCalls()[0][0]).toBe('/api/students/search?q=sara&group_id=g1')
  })

  it('a group member is never offered as a candidate, even if a result contains them', async () => {
    searchReply = [MEMBER, { id: 's1', full_name: 'Sara Ali', email: 'sara@x.test' }]
    await openManage()
    fireEvent.change(screen.getByPlaceholderText('groups.studentsModal.searchPlaceholder'), { target: { value: 'a' } })
    await waitFor(() => expect(screen.getByText('Sara Ali')).toBeTruthy())
    // Mona appears once — in the enrolled list — never among the students to add.
    expect(screen.getAllByText('Member Mona')).toHaveLength(1)
    expect(screen.getByText('groups.studentsModal.available:1')).toBeTruthy()
  })

  it('adding goes through the unchanged POST /api/group-students, then leaves the candidates', async () => {
    await openManage()
    fireEvent.change(screen.getByPlaceholderText('groups.studentsModal.searchPlaceholder'), { target: { value: 'sara' } })
    await waitFor(() => expect(screen.getByText('Sara Ali')).toBeTruthy())
    const addButton = screen.getByText('Sara Ali').closest('div')!.parentElement!.querySelector('button')!
    fireEvent.click(addButton)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/group-students', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ group_id: 'g1', student_id: 's1' }),
    })))
    await waitFor(() => expect(screen.getByText('groups.studentsModal.noneAvailable')).toBeTruthy())
    expect(screen.getByText('groups.studentsModal.enrolled:2')).toBeTruthy()
  })

  it('clearing the box goes back to «type to search» without another request', async () => {
    await openManage()
    const box = screen.getByPlaceholderText('groups.studentsModal.searchPlaceholder')
    fireEvent.change(box, { target: { value: 'sara' } })
    await waitFor(() => expect(screen.getByText('Sara Ali')).toBeTruthy())
    fireEvent.change(box, { target: { value: '' } })
    expect(screen.getByText('groups.studentsModal.typeToSearch')).toBeTruthy()
    await new Promise(r => setTimeout(r, 400))
    expect(searchCalls()).toHaveLength(1)
  })
})
