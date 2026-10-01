import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

/**
 * Batch 2 / R1 — the entity picker of /super-admin/reports. The page sends only
 * the institutions; a teacher / student / group is found on demand inside ONE
 * chosen institution (/api/admin/report-targets, ≤ 20). The whole-institution
 * report still picks from the institutions, and «View report» still calls
 * /api/reports with the same scope / id / format / lang.
 */

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) =>
    `${ns.split('.').pop()}.${key}${vars ? ':' + Object.values(vars).join('/') : ''}`,
}))
vi.mock('@/components/shared/brand-mark', () => ({ BrandMark: () => null }))

import { ReportsClient } from '@/app/(super-admin)/super-admin/reports/reports-client'

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const TENANTS = [{ id: A, name: 'Alpha University' }, { id: B, name: 'Beta Institute' }]

type Reply = { status?: number; body: unknown; delay?: number }
let replies: Record<string, Reply>
const fetchMock = vi.fn()
const searchCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).startsWith('/api/admin/report-targets'))
const reportCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).startsWith('/api/reports'))

beforeEach(() => {
  replies = {}
  fetchMock.mockReset().mockImplementation(async (url: string) => {
    if (url.startsWith('/api/reports')) {
      return { ok: true, json: async () => ({ title: 'R', subtitle: 's', generatedAt: '2026-10-01T10:00:00Z', lang: 'en', tables: [], chrome: { tagline: '', refLabel: '', dateLabel: '', timeLabel: '', uniLabel: '', noData: '', sigTitle: '', sigName: '', sigSignature: '', sigDate: '', footerAuto: '', footerConf: '' } }) }
    }
    const q = new URL(url, 'http://x').searchParams.get('q') ?? ''
    const r = replies[q] ?? { body: { results: [] } }
    if (r.delay) await new Promise(res => setTimeout(res, r.delay))
    return { ok: (r.status ?? 200) < 400, json: async () => r.body }
  })
  vi.stubGlobal('fetch', fetchMock)
})

const selects = () => screen.getAllByRole('combobox') as HTMLSelectElement[]
const entitySelect = () => selects().at(-1)!
const optionTexts = (s: HTMLSelectElement) => [...s.options].map(o => o.textContent)
const pause = (ms = 400) => act(() => new Promise(r => setTimeout(r, ms)))

describe('R1 report picker — on demand inside one institution', () => {
  it('a whole-institution report still picks from the institutions; no search, no extra field', async () => {
    render(<ReportsClient tenants={TENANTS} />)
    expect(selects()).toHaveLength(1)
    expect(optionTexts(entitySelect())).toEqual(['reports.chooseOption', 'Alpha University', 'Beta Institute'])
    fireEvent.change(entitySelect(), { target: { value: B } })
    fireEvent.click(screen.getByText('reports.view'))
    await waitFor(() => expect(reportCalls()).toHaveLength(1))
    expect(reportCalls()[0][0]).toBe(`/api/reports?scope=university&id=${B}&format=json&lang=ar`)
    expect(searchCalls()).toHaveLength(0)
  })

  it('student: nothing listed and nothing asked until an institution is chosen AND text typed', async () => {
    render(<ReportsClient tenants={TENANTS} />)
    fireEvent.click(screen.getByText('reports.scopes.student'))
    const search = screen.getByPlaceholderText('reports.searchPeople') as HTMLInputElement
    expect(search.disabled).toBe(true)
    expect(entitySelect().disabled).toBe(true)
    expect(optionTexts(entitySelect())).toEqual(['reports.typeToSearch'])
    // the institution list is the same one the page always had
    expect(optionTexts(selects()[0])).toEqual(['reports.chooseInstitution', 'Alpha University', 'Beta Institute'])
    fireEvent.change(selects()[0], { target: { value: A } })
    expect(search.disabled).toBe(false)
    await pause()
    expect(searchCalls()).toHaveLength(0)
  })

  it('ONE request per pause with kind + institution + text; labels «name — email»; the report call is unchanged', async () => {
    replies.huda = { body: { results: [{ id: 's1', label: 'Huda Saleh', email: 'huda@a.edu' }, { id: 's2', label: 'Huda Omar', email: 'ho@a.edu' }] } }
    render(<ReportsClient tenants={TENANTS} />)
    fireEvent.click(screen.getByText('reports.scopes.student'))
    fireEvent.change(selects()[0], { target: { value: A } })
    for (const v of ['h', 'hu', 'hud', 'huda']) fireEvent.change(screen.getByPlaceholderText('reports.searchPeople'), { target: { value: v } })
    await waitFor(() => expect(optionTexts(entitySelect())).toContain('Huda Saleh — huda@a.edu'))
    expect(searchCalls()).toHaveLength(1)
    expect(searchCalls()[0][0]).toBe(`/api/admin/report-targets?kind=student&tenant_id=${A}&q=huda`)
    fireEvent.change(entitySelect(), { target: { value: 's2' } })
    fireEvent.click(screen.getByText('reports.view'))
    await waitFor(() => expect(reportCalls()).toHaveLength(1))
    expect(reportCalls()[0][0]).toBe('/api/reports?scope=student&id=s2&format=json&lang=ar')
  })

  it('teacher → kind=teacher; group and pilot → kind=group (name only, «Type a group name»)', async () => {
    render(<ReportsClient tenants={TENANTS} />)
    for (const [scope, kind, placeholder] of [
      ['teacher', 'teacher', 'reports.searchPeople'], ['group', 'group', 'reports.searchGroups'], ['pilot', 'group', 'reports.searchGroups'],
    ] as const) {
      fireEvent.click(screen.getByText(`reports.scopes.${scope}`))
      fireEvent.change(selects()[0], { target: { value: B } })
      fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value: 'x' + scope } })
      await waitFor(() => expect(searchCalls().at(-1)![0]).toBe(`/api/admin/report-targets?kind=${kind}&tenant_id=${B}&q=x${scope}`))
    }
  })

  it('no match → «no results», nothing pickable', async () => {
    render(<ReportsClient tenants={TENANTS} />)
    fireEvent.click(screen.getByText('reports.scopes.teacher'))
    fireEvent.change(selects()[0], { target: { value: A } })
    fireEvent.change(screen.getByPlaceholderText('reports.searchPeople'), { target: { value: 'nobody' } })
    await waitFor(() => expect(optionTexts(entitySelect())).toEqual(['reports.noResults']))
    expect((screen.getByText('reports.view').closest('button') as HTMLButtonElement).disabled).toBe(true)
  })

  it('changing the institution or the text clears the results AND the pick (no stale row, nothing from another institution)', async () => {
    replies.ali = { body: { results: [{ id: 'a1', label: 'Ali', email: 'ali@a.edu' }] } }
    render(<ReportsClient tenants={TENANTS} />)
    fireEvent.click(screen.getByText('reports.scopes.student'))
    fireEvent.change(selects()[0], { target: { value: A } })
    fireEvent.change(screen.getByPlaceholderText('reports.searchPeople'), { target: { value: 'ali' } })
    await waitFor(() => expect(optionTexts(entitySelect())).toContain('Ali — ali@a.edu'))
    fireEvent.change(entitySelect(), { target: { value: 'a1' } })
    const view = () => screen.getByText('reports.view').closest('button') as HTMLButtonElement
    expect(view().disabled).toBe(false)

    fireEvent.change(selects()[0], { target: { value: B } })        // another institution
    expect(optionTexts(entitySelect())).toEqual(['reports.typeToSearch'])
    expect(view().disabled).toBe(true)

    fireEvent.change(selects()[0], { target: { value: A } })
    await waitFor(() => expect(optionTexts(entitySelect())).toContain('Ali — ali@a.edu'))
    fireEvent.change(entitySelect(), { target: { value: 'a1' } })
    fireEvent.change(screen.getByPlaceholderText('reports.searchPeople'), { target: { value: 'alia' } })  // refine
    expect(optionTexts(entitySelect())).toEqual(['reports.typeToSearch'])
    expect(view().disabled).toBe(true)
  })

  it('an older, slower answer never overwrites a newer one', async () => {
    replies.old = { delay: 600, body: { results: [{ id: 'o', label: 'Old Row', email: 'o@a.edu' }] } }
    replies.new = { body: { results: [{ id: 'n', label: 'New Row', email: 'n@a.edu' }] } }
    render(<ReportsClient tenants={TENANTS} />)
    fireEvent.click(screen.getByText('reports.scopes.student'))
    fireEvent.change(selects()[0], { target: { value: A } })
    fireEvent.change(screen.getByPlaceholderText('reports.searchPeople'), { target: { value: 'old' } })
    await pause(350)                                            // «old» is in flight
    fireEvent.change(screen.getByPlaceholderText('reports.searchPeople'), { target: { value: 'new' } })
    await waitFor(() => expect(optionTexts(entitySelect())).toContain('New Row — n@a.edu'))
    await pause(700)
    expect(optionTexts(entitySelect())).not.toContain('Old Row — o@a.edu')
  })

  it('a refused search (e.g. 403) lists nothing', async () => {
    replies.x = { status: 403, body: { error: 'Forbidden' } }
    render(<ReportsClient tenants={TENANTS} />)
    fireEvent.click(screen.getByText('reports.scopes.group'))
    fireEvent.change(selects()[0], { target: { value: A } })
    fireEvent.change(screen.getByPlaceholderText('reports.searchGroups'), { target: { value: 'x' } })
    await waitFor(() => expect(optionTexts(entitySelect())).toEqual(['reports.noResults']))
  })
})
