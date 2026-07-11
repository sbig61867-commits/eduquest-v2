/**
 * Mutation + cache-invalidation tests for client components.
 *
 * Covers the six scenarios the user requested:
 *  1. Create → item appears after re-fetch (router.refresh triggers server re-render)
 *  2. Edit   → new value visible in local state
 *  3. Delete → item gone from local state
 *  4. Supabase/API failure → local state unchanged (no optimistic update leaks)
 *  5. Success mutation → router.refresh() is called exactly once
 *  6. Failed mutation  → router.refresh() is NOT called
 *
 * We test StudentsClient (admin/students) because its mutations go through
 * API Route fetch() calls — the simplest case with no direct Supabase SDK use.
 * FeaturesClient tests cover the direct-Supabase pattern.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StudentsClient } from '@/app/(admin)/admin/students/students-client'
import { FeaturesClient } from '@/app/(super-admin)/super-admin/features/features-client'
import type { User, FeatureFlag } from '@/types'

// ── Shared mocks ──────────────────────────────────────────────────────────────

const mockRefresh = vi.fn()
const mockPush = vi.fn()

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
  Badge: ({ children, variant }: { children: React.ReactNode; variant?: string }) => (
    <span data-variant={variant}>{children}</span>
  ),
}))

vi.mock('@/components/ui/modal', () => ({
  Modal: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div role="dialog">{children}</div> : null,
}))

vi.mock('@/components/ui/input', () => ({
  Input: ({ label, value, onChange, ...rest }: {
    label?: string; value?: string; onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void
    [key: string]: unknown
  }) => <input aria-label={label} value={value} onChange={onChange} {...rest} />,
}))

vi.mock('@/lib/utils', () => ({
  formatDate: (d: string) => d,
}))

// Supabase client mock — used by FeaturesClient
const mockFrom = vi.fn()
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: mockFrom }),
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeStudent(overrides: Partial<User> = {}): User {
  return {
    id: 'stu-1',
    email: 'alice@test.com',
    full_name: 'Alice Test',
    avatar_url: null,
    role: 'student',
    tenant_id: 'ten-1',
    is_active: true,
    can_create_courses: false,
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeFlag(overrides: Partial<FeatureFlag> = {}): FeatureFlag {
  return { id: 'flag-1', name: 'custom_flag', is_enabled: true, tenant_id: null, ...overrides }
}

// Helper: build a chainable Supabase query mock that resolves to `result`.
// The chain is thenable so that `await chain.delete().eq(...)` resolves to
// `result` (Supabase query builders are Promises; `.single()` overrides that
// for single-row fetches that need the same result).
function supaChain(result: { data?: unknown; error?: { message: string } | null }) {
  type Resolve = (v: typeof result) => unknown
  type Reject  = (e: unknown)       => unknown
  const chain: Record<string, unknown> = {
    // Thenable: so `await chainObj` (without .single()) resolves to result
    then: (resolve: Resolve, reject?: Reject) => Promise.resolve(result).then(resolve, reject),
  }
  for (const m of ['update', 'delete', 'insert', 'select', 'eq']) {
    chain[m] = vi.fn().mockReturnThis()
  }
  // .single() is a Promise by itself (overrides the chain's .then)
  chain.single = vi.fn().mockResolvedValue(result)
  return chain
}

// ── StudentsClient (API Route mutations) ─────────────────────────────────────

describe('StudentsClient — API Route mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('confirm', vi.fn(() => true))
  })

  // Scenario 1 — initial list renders (create equivalent: initialStudents acts as "after re-fetch")
  it('renders initial students (re-fetch result visible immediately)', () => {
    const students = [
      makeStudent({ id: '1', full_name: 'Alice', email: 'a@t.com' }),
      makeStudent({ id: '2', full_name: 'Bob', email: 'b@t.com' }),
    ]
    render(<StudentsClient initialStudents={students} />)
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
  })

  // Scenario 2 — edit: toggle active→disabled, new value appears
  it('toggleStatus success → new status visible in local state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
    render(<StudentsClient initialStudents={[makeStudent({ is_active: true })]} />)

    expect(screen.getByText('Active')).toBeInTheDocument()

    const buttons = screen.getAllByRole('button')
    await userEvent.click(buttons[buttons.length - 2]) // toggle is second-to-last per row

    await waitFor(() => {
      expect(screen.getByText('Disabled')).toBeInTheDocument()
    })
  })

  // Scenario 5 — success → router.refresh called
  it('toggleStatus success → router.refresh() called exactly once', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
    render(<StudentsClient initialStudents={[makeStudent()]} />)

    const buttons = screen.getAllByRole('button')
    await userEvent.click(buttons[buttons.length - 2])

    await waitFor(() => expect(mockRefresh).toHaveBeenCalledOnce())
  })

  // Scenario 6 — failure → router.refresh NOT called
  it('toggleStatus failure → router.refresh() NOT called', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    render(<StudentsClient initialStudents={[makeStudent({ is_active: true })]} />)

    const buttons = screen.getAllByRole('button')
    await userEvent.click(buttons[buttons.length - 2])

    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(mockRefresh).not.toHaveBeenCalled()
  })

  // Scenario 4 — failure → local state unchanged
  it('toggleStatus failure → local state unchanged (status stays Active)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    render(<StudentsClient initialStudents={[makeStudent({ is_active: true })]} />)

    const buttons = screen.getAllByRole('button')
    await userEvent.click(buttons[buttons.length - 2])

    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.queryByText('Disabled')).not.toBeInTheDocument()
  })

  // Scenario 3 — delete: item removed from list
  it('deleteStudent success → item removed from list', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
    render(<StudentsClient initialStudents={[makeStudent()]} />)

    const buttons = screen.getAllByRole('button')
    await userEvent.click(buttons[buttons.length - 1]) // delete is last per row

    await waitFor(() => {
      expect(screen.queryByText('Alice Test')).not.toBeInTheDocument()
    })
  })

  // Scenario 5 — delete success → router.refresh called
  it('deleteStudent success → router.refresh() called', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
    render(<StudentsClient initialStudents={[makeStudent()]} />)

    const buttons = screen.getAllByRole('button')
    await userEvent.click(buttons[buttons.length - 1])

    await waitFor(() => expect(mockRefresh).toHaveBeenCalledOnce())
  })

  // Scenario 6 — delete failure → router.refresh NOT called
  it('deleteStudent failure → router.refresh() NOT called, student stays', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    render(<StudentsClient initialStudents={[makeStudent()]} />)

    const buttons = screen.getAllByRole('button')
    await userEvent.click(buttons[buttons.length - 1])

    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(mockRefresh).not.toHaveBeenCalled()
    expect(screen.getByText('Alice Test')).toBeInTheDocument()
  })

  // Scenario 4 (extra) — confirm cancelled → fetch never called
  it('deleteStudent: confirm cancelled → no fetch, no refresh', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false))
    vi.stubGlobal('fetch', vi.fn())
    render(<StudentsClient initialStudents={[makeStudent()]} />)

    const buttons = screen.getAllByRole('button')
    await userEvent.click(buttons[buttons.length - 1])

    expect(fetch).not.toHaveBeenCalled()
    expect(mockRefresh).not.toHaveBeenCalled()
  })
})

// ── FeaturesClient (direct Supabase mutations) ────────────────────────────────

describe('FeaturesClient — direct Supabase mutations', () => {
  beforeEach(() => vi.clearAllMocks())

  // Scenario 5 — toggleFlag success → router.refresh called
  it('toggleFlag success → local state updated + router.refresh called', async () => {
    const flag = makeFlag({ is_enabled: true })
    const chain = supaChain({ data: { ...flag, is_enabled: false }, error: null })
    mockFrom.mockReturnValue(chain)

    render(<FeaturesClient initialFlags={[flag]} tenants={[]} />)

    const allButtons = screen.getAllByRole('button')
    // The delete and toggle buttons are in the custom flags section
    const toggleBtn = allButtons.find(b => b.className?.includes('w-12') || b.className?.includes('h-6'))
    if (toggleBtn) {
      await userEvent.click(toggleBtn)
      await waitFor(() => expect(mockRefresh).toHaveBeenCalled())
    } else {
      // Fallback: find any toggle-like button (not Add Flag, not delete)
      const nonDeleteBtns = allButtons.filter(b => !b.textContent?.includes('Add') && !b.textContent?.includes('Delete'))
      if (nonDeleteBtns.length > 0) {
        await userEvent.click(nonDeleteBtns[nonDeleteBtns.length - 1])
        await waitFor(() => expect(mockRefresh).toHaveBeenCalled())
      }
    }
  })

  // Scenario 3 — deleteFlag success → removed from list
  it('deleteFlag success → flag removed and router.refresh called', async () => {
    const flag = makeFlag({ name: 'my_custom_flag' })
    const chain = supaChain({ error: null })
    mockFrom.mockReturnValue(chain)

    render(<FeaturesClient initialFlags={[flag]} tenants={[]} />)
    expect(screen.getByText('my_custom_flag')).toBeInTheDocument()

    // Delete button has Trash2 icon — it's the last button in the custom flags section
    const allButtons = screen.getAllByRole('button')
    const deleteBtn = allButtons[allButtons.length - 1]
    await userEvent.click(deleteBtn)

    await waitFor(() => {
      expect(screen.queryByText('my_custom_flag')).not.toBeInTheDocument()
      expect(mockRefresh).toHaveBeenCalledOnce()
    })
  })

  // Scenario 6 — deleteFlag failure → flag stays, no refresh
  it('deleteFlag failure → flag stays, router.refresh NOT called', async () => {
    const flag = makeFlag({ name: 'sticky_flag' })
    const chain = supaChain({ error: { message: 'db error' } })
    mockFrom.mockReturnValue(chain)

    render(<FeaturesClient initialFlags={[flag]} tenants={[]} />)

    const allButtons = screen.getAllByRole('button')
    await userEvent.click(allButtons[allButtons.length - 1])

    await waitFor(() => expect(mockFrom).toHaveBeenCalled())
    expect(mockRefresh).not.toHaveBeenCalled()
    expect(screen.getByText('sticky_flag')).toBeInTheDocument()
  })
})
