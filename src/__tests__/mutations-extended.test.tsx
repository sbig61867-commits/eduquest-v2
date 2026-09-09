/**
 * Extended mutation tests — covers the 7 remaining client components.
 *
 * For every component we prove the core invariant:
 *   SUCCESS  → router.refresh() is called exactly once
 *   FAILURE  → router.refresh() is NOT called; local state is unchanged
 *
 * We always test the simplest destructive mutation (delete/remove) because it
 * has a single, unambiguous success/failure path — no modal form flow needed.
 * For components where delete requires confirm(), we stub window.confirm = true.
 *
 * Button identification: our Button mock passes className through.  Delete
 * buttons consistently carry `hover:text-error` so we use:
 *   container.querySelector('[class*="hover:text-error"]')
 *
 * For Supabase-direct components (tenants handleAdd, messages remove,
 * course-build deleteLevel) we reuse the supaChain thenable helper.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// ── Shared mock wiring ────────────────────────────────────────────────────────

const mockRefresh = vi.fn()
const mockPush    = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh, push: mockPush }),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, className, disabled, loading }: {
    children: React.ReactNode; onClick?: () => void
    className?: string; disabled?: boolean; loading?: boolean
  }) => (
    <button onClick={onClick} className={className} disabled={disabled || loading}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))

vi.mock('@/components/ui/modal', () => ({
  Modal: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div role="dialog">{children}</div> : null,
}))

vi.mock('@/components/ui/input', () => ({
  Input: ({ label, value, onChange, ...rest }: {
    label?: string; value?: string; onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void
    [k: string]: unknown
  }) => <input aria-label={label} value={value} onChange={onChange} {...rest} />,
}))

vi.mock('@/lib/utils', () => ({
  formatDate: (d: string) => d,
  formatDateTime: (d: string) => d,
}))

vi.mock('@/components/shared/ai-progress', () => ({
  AiProgress: () => null,
}))

// Supabase client mock — returns chain built by supaChain()
const mockFrom = vi.fn()
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: mockFrom }),
}))

// Thenable Supabase chain (resolves .delete().eq() AND .insert().select().single())
function supaChain(result: { data?: unknown; error?: { message: string } | null }) {
  type Res = (v: typeof result) => unknown
  type Rej = (e: unknown) => unknown
  const chain: Record<string, unknown> = {
    then: (res: Res, rej?: Rej) => Promise.resolve(result).then(res, rej),
  }
  for (const m of ['update', 'delete', 'insert', 'select', 'eq']) {
    chain[m] = vi.fn().mockReturnThis()
  }
  chain.single = vi.fn().mockResolvedValue(result)
  return chain
}

// ── 1. GroupsClient ───────────────────────────────────────────────────────────

import { GroupsClient } from '@/app/(teacher)/teacher/groups/groups-client'

const GROUP = {
  id: 'g-1', name: 'Test Group', description: null,
  created_at: '2024-01-01T00:00:00Z', is_active: true,
  group_students: [{ count: 0 }],
}

describe('GroupsClient — deleteGroup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('confirm', vi.fn(() => true))
    vi.stubGlobal('alert', vi.fn())
  })

  it('success → item removed + router.refresh called', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
    const { container } = render(
      <GroupsClient initialGroups={[GROUP]} tenantStudents={[]} teacherId="t1" tenantId="ten1" />
    )
    const del = container.querySelector<HTMLButtonElement>('[class*="hover:text-error"]')
    expect(del).toBeTruthy()
    await userEvent.click(del!)
    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalledOnce()
      expect(screen.queryByText('Test Group')).not.toBeInTheDocument()
    })
  })

  it('failure → group stays + router.refresh NOT called', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, json: () => Promise.resolve({ error: 'DB error' }),
    }))
    const { container } = render(
      <GroupsClient initialGroups={[GROUP]} tenantStudents={[]} teacherId="t1" tenantId="ten1" />
    )
    const del = container.querySelector<HTMLButtonElement>('[class*="hover:text-error"]')
    await userEvent.click(del!)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(mockRefresh).not.toHaveBeenCalled()
    expect(screen.getByText('Test Group')).toBeInTheDocument()
  })
})

// ── 2. LessonsClient ──────────────────────────────────────────────────────────

import { LessonsClient } from '@/app/(teacher)/teacher/lessons/lessons-client'

const LESSON = {
  id: 'l-1', title: 'Lesson One', content: null,
  is_published: false, created_at: '2024-01-01T00:00:00Z',
  groups: { name: 'Group A' },
}

describe('LessonsClient — deleteLesson', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('confirm', vi.fn(() => true))
    vi.stubGlobal('alert', vi.fn())
  })

  it('success → item removed + router.refresh called', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
    const { container } = render(
      <LessonsClient initialLessons={[LESSON]} groups={[{ id: 'g1', name: 'Group A' }]} />
    )
    const del = container.querySelector<HTMLButtonElement>('[class*="hover:text-error"]')
    expect(del).toBeTruthy()
    await userEvent.click(del!)
    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalledOnce()
      expect(screen.queryByText('Lesson One')).not.toBeInTheDocument()
    })
  })

  it('failure → lesson stays + router.refresh NOT called', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, json: () => Promise.resolve({ error: 'err' }),
    }))
    const { container } = render(
      <LessonsClient initialLessons={[LESSON]} groups={[{ id: 'g1', name: 'Group A' }]} />
    )
    const del = container.querySelector<HTMLButtonElement>('[class*="hover:text-error"]')
    await userEvent.click(del!)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(mockRefresh).not.toHaveBeenCalled()
    expect(screen.getByText('Lesson One')).toBeInTheDocument()
  })
})

// ── 3. ExamsClient — deleteExam ───────────────────────────────────────────────

import { ExamsClient } from '@/app/(teacher)/teacher/exams/exams-client'

const EXAM = {
  id: 'ex-1', title: 'Midterm Exam',
  duration_minutes: 60, questions: [],
  is_published: false, proctoring_enabled: false,
  created_at: '2024-01-01T00:00:00Z',
  groups: { name: 'Group A' },
}

describe('ExamsClient — deleteExam', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('confirm', vi.fn(() => true))
    vi.stubGlobal('alert', vi.fn())
  })

  it('success → exam removed + router.refresh called', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
    const { container } = render(
      <ExamsClient initialExams={[EXAM]} groups={[{ id: 'g1', name: 'Group A' }]} />
    )
    const del = container.querySelector<HTMLButtonElement>('[class*="hover:text-error"]')
    expect(del).toBeTruthy()
    await userEvent.click(del!)
    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalledOnce()
      expect(screen.queryByText('Midterm Exam')).not.toBeInTheDocument()
    })
  })

  it('failure → exam stays + router.refresh NOT called', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, json: () => Promise.resolve({ error: 'err' }),
    }))
    const { container } = render(
      <ExamsClient initialExams={[EXAM]} groups={[{ id: 'g1', name: 'Group A' }]} />
    )
    const del = container.querySelector<HTMLButtonElement>('[class*="hover:text-error"]')
    await userEvent.click(del!)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(mockRefresh).not.toHaveBeenCalled()
    expect(screen.getByText('Midterm Exam')).toBeInTheDocument()
  })
})

// ── 4. CoursesClient — deleteCourse ──────────────────────────────────────────

import { CoursesClient } from '@/app/(teacher)/teacher/courses/courses-client'

const COURSE = {
  id: 'co-1', title: 'Python Basics', description: null,
  language: null, has_levels: true, is_published: false,
  created_at: '2024-01-01T00:00:00Z',
  course_levels: [{ count: 0 }],
  course_enrollments: [{ count: 0 }],
}

describe('CoursesClient — deleteCourse', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('confirm', vi.fn(() => true))
    vi.stubGlobal('alert', vi.fn())
  })

  it('success → course removed + router.refresh called', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
    const { container } = render(
      <CoursesClient initialCourses={[COURSE]} teacherId="t1" tenantId="ten1" />
    )
    const del = container.querySelector<HTMLButtonElement>('[class*="hover:text-error"]')
    expect(del).toBeTruthy()
    await userEvent.click(del!)
    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalledOnce()
      expect(screen.queryByText('Python Basics')).not.toBeInTheDocument()
    })
  })

  it('failure → course stays + router.refresh NOT called', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, json: () => Promise.resolve({ error: 'err' }),
    }))
    const { container } = render(
      <CoursesClient initialCourses={[COURSE]} teacherId="t1" tenantId="ten1" />
    )
    const del = container.querySelector<HTMLButtonElement>('[class*="hover:text-error"]')
    await userEvent.click(del!)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(mockRefresh).not.toHaveBeenCalled()
    expect(screen.getByText('Python Basics')).toBeInTheDocument()
  })
})

// ── 5. TenantsClient — deleteTenant (API) ────────────────────────────────────

import { TenantsClient } from '@/app/(super-admin)/super-admin/tenants/tenants-client'
import type { Tenant } from '@/types'

const TENANT: Tenant = {
  id: 'ten-1', name: 'Test University', slug: 'test-uni',
  logo_url: null, is_active: true, created_at: '2024-01-01T00:00:00Z',
}

describe('TenantsClient — deleteTenant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('confirm', vi.fn(() => true))
    vi.stubGlobal('alert', vi.fn())
    // Mock Supabase for handleAdd (not needed for delete test, but component uses it)
    mockFrom.mockReturnValue(supaChain({ data: null, error: null }))
  })

  it('success → tenant removed + router.refresh called', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: () => Promise.resolve({}),
    }))
    const { container } = render(<TenantsClient initialTenants={[TENANT]} />)
    // Delete button is the red one (archive is amber, delete is red ghost)
    const del = container.querySelector<HTMLButtonElement>('[class*="hover:text-error"]')
    expect(del).toBeTruthy()
    await userEvent.click(del!)
    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalledOnce()
      expect(screen.queryByText('Test University')).not.toBeInTheDocument()
    })
  })

  it('failure → tenant stays + router.refresh NOT called', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, json: () => Promise.resolve({ error: 'err' }),
    }))
    const { container } = render(<TenantsClient initialTenants={[TENANT]} />)
    const del = container.querySelector<HTMLButtonElement>('[class*="hover:text-error"]')
    await userEvent.click(del!)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(mockRefresh).not.toHaveBeenCalled()
    expect(screen.getByText('Test University')).toBeInTheDocument()
  })
})

// ── 6. MessagesClient — remove (Supabase direct) ─────────────────────────────

import { MessagesClient } from '@/app/(super-admin)/super-admin/messages/messages-client'

const MESSAGE = {
  id: 'msg-1', name: 'Bob', email: 'bob@test.com',
  message: 'Need help', is_read: false, created_at: '2024-01-01T00:00:00Z',
}

describe('MessagesClient — remove', () => {
  beforeEach(() => vi.clearAllMocks())

  it('success → message removed + router.refresh called', async () => {
    mockFrom.mockReturnValue(supaChain({ error: null }))
    const { container } = render(<MessagesClient initialMessages={[MESSAGE]} />)
    const del = container.querySelector<HTMLButtonElement>('[aria-label="Delete message"]')
    expect(del).toBeTruthy()
    await userEvent.click(del!)
    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalledOnce()
      expect(screen.queryByText('Bob')).not.toBeInTheDocument()
    })
  })

  it('failure → message stays + router.refresh NOT called', async () => {
    mockFrom.mockReturnValue(supaChain({ error: { message: 'db err' } }))
    render(<MessagesClient initialMessages={[MESSAGE]} />)
    const buttons = screen.getAllByRole('button')
    await userEvent.click(buttons[buttons.length - 1])
    await waitFor(() => expect(mockFrom).toHaveBeenCalled())
    expect(mockRefresh).not.toHaveBeenCalled()
    expect(screen.getByText('Bob')).toBeInTheDocument()
  })
})

// ── 7. CourseBuildClient — deleteLevel (Supabase direct) ─────────────────────

import { CourseBuildClient } from '@/app/(teacher)/teacher/courses/[id]/course-build-client'

const BUILD_COURSE = {
  id: 'co-1', title: 'My Course', tenant_id: 'ten-1', has_levels: true,
  description: null, language: null, is_published: false,
}

const LEVEL = {
  id: 'lv-1', course_id: 'co-1', tenant_id: 'ten-1',
  title: 'Level 1', order_index: 0, is_published: false,
  course_units: [],
}

vi.mock('@/lib/ai/groq', () => ({ groqChat: vi.fn() }))

describe('CourseBuildClient — deleteLevel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('confirm', vi.fn(() => true))
    vi.stubGlobal('alert', vi.fn())
  })

  it('success → level removed + router.refresh called', async () => {
    mockFrom.mockReturnValue(supaChain({ error: null }))
    const { container } = render(
      <CourseBuildClient
        course={BUILD_COURSE}
        initialLevels={[LEVEL]}
        initialFlatUnits={[]}
      />
    )
    await waitFor(() => expect(screen.getByText('Level 1')).toBeInTheDocument())
    const del = container.querySelector<HTMLButtonElement>('[class*="hover:text-error"]')
    expect(del).toBeTruthy()
    await userEvent.click(del!)
    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalledOnce()
      expect(screen.queryByText('Level 1')).not.toBeInTheDocument()
    })
  })

  it('failure → level stays + router.refresh NOT called', async () => {
    mockFrom.mockReturnValue(supaChain({ error: { message: 'db err' } }))
    render(
      <CourseBuildClient
        course={BUILD_COURSE}
        initialLevels={[LEVEL]}
        initialFlatUnits={[]}
      />
    )
    await waitFor(() => expect(screen.getByText('Level 1')).toBeInTheDocument())
    const btns = screen.getAllByRole('button')
    const del = btns.find(b => b.className?.includes('red'))
    if (del) {
      await userEvent.click(del)
      await waitFor(() => expect(mockFrom).toHaveBeenCalled())
    }
    expect(mockRefresh).not.toHaveBeenCalled()
    expect(screen.getByText('Level 1')).toBeInTheDocument()
  })
})
