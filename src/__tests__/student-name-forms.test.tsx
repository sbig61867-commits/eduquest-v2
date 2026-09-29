/**
 * The four-part name on the screens a student meets: the invitation join form
 * (fields, client-side refusal, what is posted, Google gate) and the profile,
 * where the name is shown but can no longer be edited.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render as rtlRender, screen, fireEvent, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'

import arMessages from '@/messages/ar'
import { JOIN_NAME_COOKIE } from '@/lib/person-name'

const signInWithOAuth = vi.fn().mockResolvedValue({ error: null })
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { signInWithOAuth, signInWithPassword: vi.fn().mockResolvedValue({ data: {}, error: { message: 'x' } }) } }),
}))

import { JoinForm } from '@/app/(auth)/join/[token]/join-form'
import { StudentProfileClient } from '@/app/(student)/student/profile/profile-client'

const render = (ui: React.ReactElement) =>
  rtlRender(<NextIntlClientProvider locale="ar" messages={arMessages}>{ui}</NextIntlClientProvider>)

const name = arMessages.common.studentName
const fill = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
const fillValidName = () => {
  fill(name.parts.first, 'أحمد')
  fill(name.parts.father, 'محمود')
  fill(name.parts.grandfather, 'صالح')
  fill(name.parts.family, 'الخطيب')
}
const fillPasswords = () => {
  fireEvent.change(screen.getByLabelText(arMessages.auth.join.password), { target: { value: 'secret-pass-1' } })
  fireEvent.change(screen.getByLabelText(arMessages.auth.join.confirmPassword), { target: { value: 'secret-pass-1' } })
}
const submit = () => fireEvent.click(screen.getByRole('button', { name: arMessages.auth.join.submit }))

describe('JoinForm — student invitation', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue(new Response(JSON.stringify({ error: 'stop' }), { status: 400 }))
    vi.stubGlobal('fetch', fetchMock)
    signInWithOAuth.mockClear()
    document.cookie = `${JOIN_NAME_COOKIE}=; path=/auth/callback; max-age=0`
  })
  afterEach(() => vi.unstubAllGlobals())

  it('asks for the four parts instead of one full-name field', () => {
    render(<JoinForm token="tok" invitedEmail="s@x.edu" isPublic={false} role="student" />)
    for (const label of Object.values(name.parts)) expect(screen.getByLabelText(label)).toBeTruthy()
    expect(screen.queryByLabelText(arMessages.auth.join.fullName)).toBeNull()
  })

  // Every field filled, so the browser's own `required` check lets it through
  // (an empty field is stopped there first) and the four-part rules decide.
  it('refuses a junk name before anything is sent', () => {
    render(<JoinForm token="tok" invitedEmail="s@x.edu" isPublic={false} role="student" />)
    fill(name.parts.first, 'a')
    fill(name.parts.father, 'محمود')
    fill(name.parts.grandfather, '123')
    fill(name.parts.family, 'ااا')
    fillPasswords()
    submit()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toBe(name.incomplete)
    expect(screen.getByText('حرفان على الأقل')).toBeTruthy()     // tooShort, min = 2
    expect(screen.getByText(name.errors.invalidChars)).toBeTruthy()
    expect(screen.getByText(name.errors.repeated)).toBeTruthy()
  })

  it('posts the four parts, never a free-text name', async () => {
    render(<JoinForm token="tok" invitedEmail="s@x.edu" isPublic={false} role="student" />)
    fillValidName()
    fillPasswords()
    submit()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.nameParts).toEqual({ first: 'أحمد', father: 'محمود', grandfather: 'صالح', family: 'الخطيب' })
    expect(body.fullName).toBeUndefined()
  })

  it('does not start Google until the name is complete, then carries it to the callback', () => {
    render(<JoinForm token="tok" invitedEmail="s@x.edu" isPublic={false} role="student" />)
    const google = screen.getByRole('button', { name: arMessages.auth.join.google })
    fireEvent.click(google)
    expect(signInWithOAuth).not.toHaveBeenCalled()

    // path=/auth/callback hides the cookie from this page's own document.cookie,
    // so assert the write itself.
    const spy = vi.spyOn(document, 'cookie', 'set')
    fillValidName()
    fireEvent.click(google)
    expect(signInWithOAuth).toHaveBeenCalledTimes(1)
    const written = String(spy.mock.calls.at(-1)?.[0])
    spy.mockRestore()
    expect(written).toContain(`${JOIN_NAME_COOKIE}=`)
    expect(written).toContain('path=/auth/callback')
    expect(JSON.parse(decodeURIComponent(written.split(';')[0].split('=')[1])).family).toBe('الخطيب')
  })

  it('explains why when Google came back without a name', () => {
    render(<JoinForm token="tok" invitedEmail="s@x.edu" isPublic={false} role="student" nameRequired />)
    expect(screen.getByRole('alert').textContent).toBe(arMessages.auth.join.googleNameRequired)
  })
})

describe('JoinForm — other roles', () => {
  it('keeps the single full-name field for a teacher', () => {
    render(<JoinForm token="tok" invitedEmail="t@x.edu" isPublic={false} role="teacher" />)
    expect(screen.getByLabelText(arMessages.auth.join.fullName)).toBeTruthy()
    expect(screen.queryByLabelText(name.parts.grandfather)).toBeNull()
  })
})

describe('StudentProfileClient', () => {
  const profile = {
    id: 's1', full_name: 'أحمد الخطيب', email: 's@x', role: 'student', is_active: true,
    created_at: '2026-09-01T00:00:00Z', tenants: { name: 'QOU', slug: 'qou' },
  }

  it('shows the student their own four-part name, read-only, with who can correct it', () => {
    render(<StudentProfileClient profile={profile} fourPartName="أحمد محمود صالح الخطيب" groups={[]} />)
    const input = screen.getByLabelText(arMessages.student.profile.fullName) as HTMLInputElement
    expect(input.value).toBe('أحمد محمود صالح الخطيب')
    expect(input.readOnly).toBe(true)
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('أحمد محمود صالح الخطيب')
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText(arMessages.student.profile.nameLocked.replace('{institution}', 'QOU'))).toBeTruthy()
  })

  it('falls back to the stored name for an account without four parts on file', () => {
    render(<StudentProfileClient profile={profile} groups={[]} />)
    expect((screen.getByLabelText(arMessages.student.profile.fullName) as HTMLInputElement).value).toBe('أحمد الخطيب')
  })
})
