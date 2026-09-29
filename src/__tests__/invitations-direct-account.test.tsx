/**
 * The invitations screen's third way to add a student: create the account
 * directly with the four-part name and a temporary password (teachers and
 * institution admins, alongside the centre manager's own people screen).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render as rtlRender, screen, fireEvent, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'

import arMessages from '@/messages/ar'
import { InvitationsClient } from '@/components/shared/invitations-client'

const inv = arMessages.staff.invitations
const name = arMessages.common.studentName

const render = (ui: React.ReactElement) =>
  rtlRender(<NextIntlClientProvider locale="ar" messages={arMessages}>{ui}</NextIntlClientProvider>)

const fill = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } })

describe('InvitationsClient — direct student account', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/admin/create-user') {
        return new Response(JSON.stringify({ user: { full_name: 'أحمد الخطيب', email: 's@x.edu' } }), { status: 200 })
      }
      if (!init) return new Response(JSON.stringify({ invitations: [], seats: null }), { status: 200 })
      return new Response('{}', { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  async function openAccountForm(callerRole: 'teacher' | 'university_admin') {
    render(<InvitationsClient callerRole={callerRole} tenants={[]} groups={[{ id: 'g1', name: 'المجموعة أ' }]} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: inv.newInvite }))
    // An admin's role list starts with staff roles; the direct account is for students.
    fireEvent.change(screen.getByRole('combobox', { name: inv.roleLabel }), { target: { value: 'student' } })
    fireEvent.click(screen.getByRole('button', { name: inv.accountDesc }))
  }

  function fillStudent() {
    fill(name.parts.first, 'أحمد')
    fill(name.parts.father, 'محمود')
    fill(name.parts.grandfather, 'صالح')
    fill(name.parts.family, 'الخطيب')
    fill(inv.emailLabel, 's@x.edu')
    fill(inv.passwordLabel, 'secret-123')
  }

  const createCalls = () => fetchMock.mock.calls.filter(c => c[0] === '/api/admin/create-user')

  it('a teacher creates the student into their group with the four parts', async () => {
    await openAccountForm('teacher')
    fillStudent()
    fireEvent.change(screen.getByRole('combobox', { name: inv.groupLabel }), { target: { value: 'g1' } })
    fireEvent.click(screen.getByRole('button', { name: inv.createAccount }))

    await waitFor(() => expect(createCalls()).toHaveLength(1))
    const body = JSON.parse(createCalls()[0][1].body)
    expect(body).toEqual({
      role: 'student',
      email: 's@x.edu',
      password: 'secret-123',
      name_parts: { first: 'أحمد', father: 'محمود', grandfather: 'صالح', family: 'الخطيب' },
      group_id: 'g1',
    })
    // A teacher never sets the university/centre affiliation.
    expect(body).not.toHaveProperty('is_university_student')
    expect(await screen.findByRole('status')).toBeTruthy()
  })

  it('a teacher must pick a group before anything is sent', async () => {
    await openAccountForm('teacher')
    fillStudent()
    fireEvent.submit(screen.getByRole('button', { name: inv.createAccount }).closest('form')!)
    expect(await screen.findByText(inv.accountGroupRequired)).toBeTruthy()
    expect(createCalls()).toHaveLength(0)
  })

  it('an incomplete name is refused before anything is sent', async () => {
    await openAccountForm('university_admin')
    fillStudent()
    fill(name.parts.grandfather, 'x')
    fireEvent.submit(screen.getByRole('button', { name: inv.createAccount }).closest('form')!)
    expect(await screen.findByText(name.incomplete)).toBeTruthy()
    expect(createCalls()).toHaveLength(0)
  })

  it('an institution admin may leave the group empty', async () => {
    await openAccountForm('university_admin')
    fillStudent()
    fireEvent.click(screen.getByRole('button', { name: inv.createAccount }))
    await waitFor(() => expect(createCalls()).toHaveLength(1))
    expect(JSON.parse(createCalls()[0][1].body)).not.toHaveProperty('group_id')
  })

  it('offers the direct account for students only', async () => {
    render(<InvitationsClient callerRole="university_admin" tenants={[]} groups={[]} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: inv.newInvite }))
    // The admin's first role option is not a student.
    expect(screen.queryByRole('button', { name: inv.accountDesc })).toBeNull()
  })
})
