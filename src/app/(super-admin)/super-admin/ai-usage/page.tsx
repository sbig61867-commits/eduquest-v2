export const dynamic = 'force-dynamic'

import { currentUser } from '@/lib/auth/current'
import { run, maybeOne } from '@/lib/db/sql'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { PageTitle } from '@/components/shared/page-title'
import { DEFAULT_AI_PRICING } from '@/lib/ai/pricing'
import { readAiPricingAs } from '@/lib/super-admin-data'
import { resolveUsageRange, toUsageRange, type AiUsageReport } from '@/lib/ai/usage-report'
import { AiUsageClient } from './ai-usage-client'

// The whole dashboard comes from ONE call: get_ai_usage_report() is SECURITY
// DEFINER and gated to super_admin (supabase/ai_usage_metering_migration.sql).
// Periods are inclusive UTC days; the page is a plain link per period so the
// selected range survives a reload and can be shared.
export default async function AiUsagePage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const user = await currentUser()
  if (!user) redirect('/login')

  // The owner's gate is the function itself (super_admin only); the page checks the role too.
  const [profiles] = await run({ as: 'user', userId: user.id }, sql => [sql`select role from public.users where id = ${user.id}`])
  if ((maybeOne<{ role: string }>(profiles))?.role !== 'super_admin') redirect('/login')

  const range = toUsageRange((await searchParams).range)
  const { from, to } = resolveUsageRange(range)

  const [report, pricing, t] = await Promise.all([
    run({ as: 'user', userId: user.id }, sql => [sql`select public.get_ai_usage_report(p_from => ${from}, p_to => ${to}) as data`])
      .then(([rows]) => ({ data: (maybeOne<{ data: unknown }>(rows))?.data ?? null, error: null as null | { code?: string } }))
      .catch((e: unknown) => ({ data: null, error: { code: (e as { code?: string })?.code } })),
    readAiPricingAs(user.id),
    getTranslations('superAdmin.aiUsage'),
  ])
  const { data, error } = report

  // 42883: the function does not exist yet — the migration is not applied.
  const migrationMissing = error?.code === '42883' || error?.code === 'PGRST202'

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
