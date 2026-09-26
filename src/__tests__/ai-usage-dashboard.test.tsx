/**
 * The super_admin AI usage dashboard renders a realistic report in both
 * languages: every section, the allowance states, and no mixed-language text.
 * The page itself can only be opened by the platform owner's account, so this
 * is the standing proof that it renders from the report shape the SQL returns.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'

import ar from '@/messages/ar'
import en from '@/messages/en'
import { DEFAULT_AI_PRICING } from '@/lib/ai/pricing'
import type { AiUsageReport } from '@/lib/ai/usage-report'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/super-admin/ai-usage',
}))

import { AiUsageClient } from '@/app/(super-admin)/super-admin/ai-usage/ai-usage-client'

const MESSAGES = { ar, en } as Record<'ar' | 'en', unknown>
const ARABIC = /[؀-ۿ]/

// Shaped exactly like get_ai_usage_report()'s JSON (numeric sums arrive as numbers).
const report: AiUsageReport = {
  from: '2026-09-20', to: '2026-09-26', month: '2026-09-01',
  metering_started_at: '2026-09-22T10:00:00Z',
  totals: { requests: 42, failed: 3, blocked: 2, provider_calls: 51, input_tokens: 120000, output_tokens: 64000, list_cost_usd: 0.1936, billed_cost_usd: 0 },
  month_totals: { requests: 60, tokens: 250000, list_cost_usd: 0.25, billed_cost_usd: 0 },
  latency: { avg_ms: 2400, p95_ms: 7100 },
  series: [
    { day: '2026-09-22', feature: 'lesson', requests: 10, failed: 1, tokens: 50000, list_cost_usd: 0.05 },
    { day: '2026-09-23', feature: 'exam', requests: 20, failed: 2, tokens: 90000, list_cost_usd: 0.09 },
    { day: '2026-09-26', feature: 'announcement_copy', requests: 12, failed: 0, tokens: 44000, list_cost_usd: 0.0536 },
  ],
  by_feature: [
    { feature: 'exam', requests: 20, failed: 2, blocked: 2, input_tokens: 60000, output_tokens: 30000, list_cost_usd: 0.09 },
    { feature: 'announcement_copy', requests: 12, failed: 0, blocked: 0, input_tokens: 24000, output_tokens: 20000, list_cost_usd: 0.0536 },
    { feature: 'lesson', requests: 10, failed: 1, blocked: 0, input_tokens: 36000, output_tokens: 14000, list_cost_usd: 0.05 },
  ],
  by_tenant: [
    {
      tenant_id: 't1', tenant_name: 'North University', is_active: true,
      requests: 40, failed: 3, blocked: 2, input_tokens: 110000, output_tokens: 60000, list_cost_usd: 0.18, billed_cost_usd: 0,
      last_used_at: '2026-09-26T11:38:00Z', month_requests: 55, month_tokens: 230000, month_list_cost_usd: 0.23,
      request_limit: 50, token_limit: null, limit_action: 'block', alert_threshold_pct: 80,
      alerts: [{ metric: 'requests', level: 'warning', created_at: '2026-09-24T00:00:00Z' }, { metric: 'requests', level: 'exceeded', created_at: '2026-09-25T00:00:00Z' }],
    },
    {
      tenant_id: 't2', tenant_name: 'South Institute', is_active: false,
      requests: 2, failed: 0, blocked: 0, input_tokens: 10000, output_tokens: 4000, list_cost_usd: 0.0136, billed_cost_usd: 0,
      last_used_at: null, month_requests: 5, month_tokens: 20000, month_list_cost_usd: 0.02,
      request_limit: null, token_limit: null, limit_action: 'block', alert_threshold_pct: 80, alerts: [],
    },
  ],
  platform: { requests: 1, input_tokens: 100, output_tokens: 100, list_cost_usd: 0.0003 },
  providers: [
    { provider: 'groq', model: 'openai/gpt-oss-120b', attempts: 45, failures: 6, input_tokens: 100000, output_tokens: 50000, list_cost_usd: 0.045, avg_ms: 1800, estimated: false, unpriced: false },
    { provider: 'openrouter', model: 'someone/new-model:free', attempts: 6, failures: 0, input_tokens: 20000, output_tokens: 14000, list_cost_usd: 0, avg_ms: 5200, estimated: true, unpriced: true },
  ],
  top_users: [
    { user_id: 'u1', full_name: 'Sara Idris', email: 'sara@example.edu', role: 'teacher', tenant_name: 'North University', requests: 30, tokens: 150000, list_cost_usd: 0.15 },
  ],
  recent_failures: [
    { created_at: '2026-09-25T09:00:00Z', feature: 'exam', status: 'blocked', tenant_name: 'North University', errors: [] },
    { created_at: '2026-09-23T09:00:00Z', feature: 'exam', status: 'failed', tenant_name: 'North University', errors: ['429', 'timeout'] },
  ],
}

function renderIn(locale: 'ar' | 'en', r: AiUsageReport = report) {
  return render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale] as never} timeZone="UTC">
      <AiUsageClient report={r} range="7" pricing={DEFAULT_AI_PRICING} defaultPricing={DEFAULT_AI_PRICING} />
    </NextIntlClientProvider>
  )
}

describe('AI usage dashboard', () => {
  it('renders every section with the report figures (English)', () => {
    const { container } = renderIn('en')
    for (const title of ['Daily usage', 'Institutions', 'By feature', 'Providers and models', 'Top users', 'Recent failed and blocked requests', 'Model prices']) {
      expect(screen.getByText(title)).toBeInTheDocument()
    }
    expect(screen.getByText('Every AI provider runs on its free tier')).toBeInTheDocument()
    expect(screen.getAllByText('North University').length).toBeGreaterThan(0)
    // Allowance: 55 of 50 requests, limit reached, block mode.
    expect(screen.getByText('Requests: 55 of 50')).toBeInTheDocument()
    expect(screen.getByText('Limit reached')).toBeInTheDocument()
    expect(screen.getByText('Blocks at the limit')).toBeInTheDocument()
    expect(screen.getAllByText('Unlimited').length).toBeGreaterThan(0)
    // Cost figures: nothing billed, equivalent cost shown.
    expect(screen.getByText('$0.194')).toBeInTheDocument()
    expect(screen.getAllByText('$0.00').length).toBeGreaterThan(0)
    // Provider health flags.
    expect(screen.getByText('No price')).toBeInTheDocument()
    expect(screen.getByText(/Codes: 429, timeout/)).toBeInTheDocument()
    // Metering began after the start of the range.
    expect(container.textContent).toMatch(/counted only, with no token or cost data/)
    // Feature ids resolve to labels.
    expect(screen.getAllByText('Announcement wording').length).toBeGreaterThan(0)
  })

  it('has no Arabic in the English render and no untranslated English section titles in Arabic', () => {
    const { container, unmount } = renderIn('en')
    expect(container.textContent).not.toMatch(ARABIC)
    unmount()
    const { container: arContainer } = renderIn('ar')
    expect(arContainer.textContent).toMatch(/المؤسسات/)
    expect(arContainer.textContent).toMatch(/أسعار النماذج/)
    expect(arContainer.textContent).not.toMatch(/Daily usage|Institutions|Model prices/)
  })

  it('switches the chart to a table and between metrics', () => {
    renderIn('en')
    fireEvent.click(screen.getByText('Show as table'))
    const table = screen.getByText('Day').closest('table')!
    expect(within(table).getAllByRole('row')).toHaveLength(1 + 3) // header + 3 active days
    fireEvent.click(screen.getByRole('tab', { name: 'Equivalent cost' }))
    expect(within(table).getByText('$0.09')).toBeInTheDocument()
  })

  it('opens the allowance editor for an institution', () => {
    renderIn('en')
    fireEvent.click(screen.getAllByText('Set allowance')[0])
    expect(screen.getByText('Monthly AI allowance: North University')).toBeInTheDocument()
    expect(screen.getByDisplayValue('50')).toBeInTheDocument()
    expect(screen.getByDisplayValue('80')).toBeInTheDocument()
  })

  it('shows an empty state instead of a blank chart', () => {
    renderIn('en', { ...report, series: [], by_feature: [], providers: [], top_users: [], recent_failures: [] })
    expect(screen.getByText('No AI usage in this period.')).toBeInTheDocument()
  })
})
