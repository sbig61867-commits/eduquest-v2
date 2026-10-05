import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

/**
 * Batch 2 / C-T — teacher selector of /center/groups and /center/courses.
 * The pages no longer receive the teaching staff: each row shows its teacher's
 * name (or «—», exactly as before) and one «تغيير» opens ONE picker that
 * searches on demand (≤ 20, /api/teachers/search). Saving still sends the very
 * same PATCH/POST bodies to /api/groups and /api/courses.
 */

const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
  // The groups list's ListPagination (renders nothing on a single page).
  usePathname: () => '/center/groups', useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) =>
    `${ns.split('.').pop()}.${key}${vars ? ':' + Object.values(vars).join('/') : ''}`,
}))
const toastError = vi.fn()
vi.mock('@/components/ui/toast', () => ({ toast: { success: vi.fn(), error: (m: string) => toastError(m) } }))
vi.mock('@/lib/confirm-dialog', () => ({ confirmDialog: () => Promise.resolve(true) }))

import { TeacherPicker } from '@/components/center/teacher-picker'
import { CenterGroupsClient, type CenterGroupRow } from '@/components/center/groups-client'
import { CenterCoursesClient, type CenterCourseRow } from '@/components/center/courses-client'

type Teacher = { id: string; full_name: string }
let searchReply: Teacher[]
let writeOk: boolean
const fetchMock = vi.fn()
const searchCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).startsWith('/api/teachers/search'))

beforeEach(() => {
  refresh.mockReset(); toastError.mockReset()
  searchReply = [{ id: 't2', full_name: 'Huda Saleh' }, { id: 't3', full_name: 'Omar Nasser' }]
  writeOk = true
  fetchMock.mockReset().mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/teachers/search')) return { ok: true, json: async () => ({ teachers: searchReply }) }
    if (url === '/api/groups' || url === '/api/courses') {
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      if (!writeOk) return { ok: false, json: async () => ({ error: 'nope' }) }
      return { ok: true, json: async () => ({ id: body.id ?? 'new-1', name: body.name, title: body.title, teacher_id: body.teacher_id, is_active: true }) }
    }
    return { ok: false, json: async () => ({}) }
  })
  vi.stubGlobal('fetch', fetchMock)
})

// The shared Input renders <label> + <input> side by side without htmlFor.
const fieldOf = (label: string) => screen.getByText(label).parentElement!.querySelector('input')!

const typeIn = (placeholder: string, value: string) =>
  fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } })

describe('TeacherPicker', () => {
  it('lists nothing and asks nothing until the user types', async () => {
    render(<TeacherPicker scope="groups" onPick={vi.fn()} />)
    expect(screen.getByText('teacherPicker.typeToSearch')).toBeTruthy()
    await new Promise(r => setTimeout(r, 400))
    expect(searchCalls()).toHaveLength(0)
  })

  it('ONE request per pause, with the screen and the query; picking returns id + name', async () => {
    const onPick = vi.fn()
    render(<TeacherPicker scope="courses" onPick={onPick} />)
    for (const v of ['h', 'hu', 'hud', 'huda']) typeIn('teacherPicker.search', v)
    await waitFor(() => expect(screen.getByText('Huda Saleh')).toBeTruthy())
    expect(searchCalls()).toHaveLength(1)
    expect(searchCalls()[0][0]).toBe('/api/teachers/search?for=courses&q=huda')
    fireEvent.click(screen.getByText('Huda Saleh'))
    expect(onPick).toHaveBeenCalledWith({ id: 't2', full_name: 'Huda Saleh' })
  })

  it('no match → «no active teacher found»; clearing goes back to «type to search» without a request', async () => {
    searchReply = []
    render(<TeacherPicker scope="groups" onPick={vi.fn()} />)
    typeIn('teacherPicker.search', 'zzz')
    await waitFor(() => expect(screen.getByText('teacherPicker.noResults')).toBeTruthy())
    typeIn('teacherPicker.search', '')
    expect(screen.getByText('teacherPicker.typeToSearch')).toBeTruthy()
    await new Promise(r => setTimeout(r, 400))
    expect(searchCalls()).toHaveLength(1)
  })

  it('a slow older answer never overwrites a newer one', async () => {
    let releaseOld: (v: unknown) => void = () => {}
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('q=ol')) {
        await new Promise(r => { releaseOld = r })
        return { ok: true, json: async () => ({ teachers: [{ id: 'old', full_name: 'Old Answer' }] }) }
      }
      return { ok: true, json: async () => ({ teachers: [{ id: 'new', full_name: 'New Answer' }] }) }
    })
    render(<TeacherPicker scope="groups" onPick={vi.fn()} />)
    typeIn('teacherPicker.search', 'ol')
    await waitFor(() => expect(searchCalls()).toHaveLength(1)) // the old search is in flight
    typeIn('teacherPicker.search', 'new')
    await waitFor(() => expect(screen.getByText('New Answer')).toBeTruthy())
    await act(async () => { releaseOld(null); await new Promise(r => setTimeout(r, 20)) })
    expect(screen.queryByText('Old Answer')).toBeNull()
    expect(screen.getByText('New Answer')).toBeTruthy()
  })
})

const group = (over: Partial<CenterGroupRow> = {}): CenterGroupRow => ({
  id: 'g1', name: 'Morning Cohort', description: null, is_active: true, teacher_id: 't1', teacher_name: 'Sara Idris',
  student_count: 3, course_id: null, image_url: null, max_students: null, instructions: null, ...over,
})

describe('/center/groups — teacher column and «تغيير»', () => {
  it('rows show the teacher name, or «—» for a disabled teacher; no row renders a list of teachers', () => {
    const { container } = render(<CenterGroupsClient summary={{ active: 0, archived: 0 }} hasTeachers initialGroups={[
      group(), group({ id: 'g2', name: 'Evening', teacher_id: 'tX', teacher_name: null }),
    ]} />)
    expect(screen.getByText('Sara Idris')).toBeTruthy()
    expect(screen.getByText('—')).toBeTruthy()
    expect(container.querySelectorAll('tbody select')).toHaveLength(0)
    expect(container.querySelectorAll('option')).toHaveLength(0)
  })

  it('no active teacher → «New group» disabled and the hint shown (as before)', () => {
    render(<CenterGroupsClient summary={{ active: 0, archived: 0 }} hasTeachers={false} initialGroups={[]} />)
    expect(screen.getByText('groups.needTeacher')).toBeTruthy()
    expect((screen.getByText('groups.newGroup').closest('button') as HTMLButtonElement).disabled).toBe(true)
  })

  it('«تغيير» → search → pick: the same PATCH /api/groups { id, teacher_id } as the old select, then the row shows the name', async () => {
    render(<CenterGroupsClient summary={{ active: 0, archived: 0 }} hasTeachers initialGroups={[group()]} />)
    fireEvent.click(screen.getByText('teacherPicker.change'))
    expect(screen.getByText('teacherPicker.changeTitle:Morning Cohort')).toBeTruthy()
    typeIn('teacherPicker.search', 'huda')
    await waitFor(() => expect(screen.getByText('Huda Saleh')).toBeTruthy())
    fireEvent.click(screen.getByText('Huda Saleh'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/groups', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ id: 'g1', teacher_id: 't2' }),
    })))
    await waitFor(() => expect(screen.queryByText('teacherPicker.changeTitle:Morning Cohort')).toBeNull())
    expect(screen.getByText('Huda Saleh')).toBeTruthy()
    expect(screen.queryByText('Sara Idris')).toBeNull()
    expect(refresh).toHaveBeenCalled()
  })

  it('picking the current teacher sends nothing; a refused PATCH keeps the old name', async () => {
    searchReply = [{ id: 't1', full_name: 'Sara Idris' }, { id: 't2', full_name: 'Huda Saleh' }]
    render(<CenterGroupsClient summary={{ active: 0, archived: 0 }} hasTeachers initialGroups={[group()]} />)
    fireEvent.click(screen.getByText('teacherPicker.change'))
    typeIn('teacherPicker.search', 'a')
    await waitFor(() => expect(screen.getByText('Huda Saleh')).toBeTruthy())
    fireEvent.click(screen.getAllByText('Sara Idris').find(el => el.tagName === 'BUTTON')!)
    expect(fetchMock.mock.calls.some(([u, i]) => u === '/api/groups' && (i as RequestInit)?.method === 'PATCH')).toBe(false)

    writeOk = false
    fireEvent.click(screen.getByText('teacherPicker.change'))
    typeIn('teacherPicker.search', 'h')
    await waitFor(() => expect(screen.getByText('Huda Saleh')).toBeTruthy())
    fireEvent.click(screen.getByText('Huda Saleh'))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('nope'))
    expect(screen.getAllByText('Sara Idris').length).toBeGreaterThan(0)
  })

  it('create: a teacher must be chosen; then the same POST /api/groups body carries teacher_id', async () => {
    render(<CenterGroupsClient summary={{ active: 0, archived: 0 }} hasTeachers initialGroups={[]} />)
    fireEvent.click(screen.getByText('groups.newGroup'))
    fireEvent.change(fieldOf('groups.groupName'), { target: { value: 'New Cohort' } })
    fireEvent.click(screen.getByText('groups.create'))
    expect(toastError).toHaveBeenCalledWith('groups.teacherRequired')
    expect(fetchMock.mock.calls.some(([u]) => u === '/api/groups')).toBe(false)

    typeIn('teacherPicker.search', 'huda')
    await waitFor(() => expect(screen.getByText('Huda Saleh')).toBeTruthy())
    fireEvent.click(screen.getByText('Huda Saleh'))
    expect(screen.getByText('teacherPicker.chosen:Huda Saleh')).toBeTruthy()
    fireEvent.click(screen.getByText('groups.create'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/groups', expect.objectContaining({ method: 'POST' })))
    const body = JSON.parse(String((fetchMock.mock.calls.find(([u]) => u === '/api/groups')![1] as RequestInit).body))
    expect(body).toMatchObject({ name: 'New Cohort', description: '', teacher_id: 't2' })
    await waitFor(() => expect(screen.getByText('New Cohort')).toBeTruthy())
    expect(screen.getByText('Huda Saleh')).toBeTruthy()
  })
})

const course = (over: Partial<CenterCourseRow> = {}): CenterCourseRow => ({
  id: 'c1', title: 'Arabic A1', description: null, is_published: false, teacher_id: 't1', teacher_name: 'Sara Idris',
  units: 0, enrollments: 0, ...over,
})

describe('/center/courses — teacher column and «تغيير»', () => {
  it('rows show the name or «—»; no teacher list in the rows; no active teacher disables «New course»', () => {
    const { container } = render(<CenterCoursesClient hasTeachers={false} initialCourses={[
      course(), course({ id: 'c2', title: 'French', teacher_name: null }),
    ]} />)
    expect(screen.getByText('Sara Idris')).toBeTruthy()
    expect(screen.getByText('—')).toBeTruthy()
    expect(container.querySelectorAll('option')).toHaveLength(0)
    expect(screen.getByText('courses.needTeacher')).toBeTruthy()
    expect((screen.getByText('courses.newCourse').closest('button') as HTMLButtonElement).disabled).toBe(true)
  })

  it('«تغيير» → pick: the same PATCH /api/courses { id, teacher_id }, searching with for=courses', async () => {
    render(<CenterCoursesClient hasTeachers initialCourses={[course()]} />)
    fireEvent.click(screen.getByText('teacherPicker.change'))
    typeIn('teacherPicker.search', 'omar')
    await waitFor(() => expect(screen.getByText('Omar Nasser')).toBeTruthy())
    expect(searchCalls()[0][0]).toBe('/api/teachers/search?for=courses&q=omar')
    fireEvent.click(screen.getByText('Omar Nasser'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/courses', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ id: 'c1', teacher_id: 't3' }),
    })))
    await waitFor(() => expect(screen.getByText('Omar Nasser')).toBeTruthy())
    expect(screen.queryByText('Sara Idris')).toBeNull()
  })

  it('create: POST /api/courses carries the picked teacher_id, as the old select did', async () => {
    render(<CenterCoursesClient hasTeachers initialCourses={[]} />)
    fireEvent.click(screen.getByText('courses.newCourse'))
    fireEvent.change(fieldOf('courses.courseTitle'), { target: { value: 'Spanish' } })
    typeIn('teacherPicker.search', 'huda')
    await waitFor(() => expect(screen.getByText('Huda Saleh')).toBeTruthy())
    fireEvent.click(screen.getByText('Huda Saleh'))
    fireEvent.click(screen.getByText('courses.create'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/courses', expect.objectContaining({ method: 'POST' })))
    const body = JSON.parse(String((fetchMock.mock.calls.find(([u]) => u === '/api/courses')![1] as RequestInit).body))
    expect(body).toEqual({ title: 'Spanish', description: '', language: '', has_levels: false, teacher_id: 't2' })
  })
})
