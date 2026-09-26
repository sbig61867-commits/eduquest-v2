export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { PageTitle } from '@/components/shared/page-title'
import { readAiPricing, DEFAULT_AI_PRICING } from '@/lib/ai/pricing'
import { resolveUsageRange, toUsageRange, type AiUsageReport } from '@/lib/ai/usage-report'
import { AiUsageClient } from './ai-usage-client'

// The whole dashboard comes from ONE call: get_ai_usage_report() is SECURITY
// DEFINER and gated to super_admin (supabase/ai_usage_metering_migration.sql).
// Periods are inclusive UTC days; the page is a plain link per period so the
// selected range survives a reload and can be shared.
export default async function AiUsagePage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (profile?.role !== 'super_admin') redirect('/login')

  const range = toUsageRange((await searchParams).range)
  const { from, to } = resolveUsageRange(range)

  const [{ data, error }, pricing, t] = await Promise.all([
    supabase.rpc('get_ai_usage_report', { p_from: from, p_to: to }),
    readAiPricing(supabase),
    getTranslations('superAdmin.aiUsage'),
  ])

  // PGRST202 / 42883: the RPC does not exist yet — the migration is not applied.
  const migrationMissing = error?.code === 'PGRST202' || error?.code === '42883'

  return (
    <>
      <PageTitle title={t('title')} />
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-white">{t('title')}</h2>
          <p className="text-slate-400 mt-1">{t('subtitle')}</p>
        </div>

        {error ? (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-5 text-sm text-amber-300">
            {migrationMissing
              ? t.rich('migrationMissing', { code: chunks => <code className="font-mono text-amber-200">{chunks}</code> })
              : t('loadError')}
          </div>
        ) : (
          <AiUsageClient
            report={data as AiUsageReport}
            range={range}
            pricing={pricing}
            defaultPricing={DEFAULT_AI_PRICING}
          />
        )}
      </div>
    </>
  )
}
