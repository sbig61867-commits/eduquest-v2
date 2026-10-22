import { getTranslations, getLocale } from 'next-intl/server'
import { Sparkles, AlertTriangle, Ban } from 'lucide-react'
import type { SupabaseClient } from '@/lib/db'
import type { Locale } from '@/i18n/config'
import { cn } from '@/lib/utils'
import { usageFormatters } from '@/lib/ai/usage-format'
import { usageShare } from '@/lib/ai/usage-report'

interface MyAllowance {
  request_limit: number | null
  token_limit: number | null
  limit_action: 'block' | 'warn'
  alert_threshold_pct: number
  requests_used: number
  tokens_used: number
  by_feature: Record<string, number>
}

// The institution's own AI month (get_my_ai_allowance): counts and limits
// only — never cost, never other institutions, never who asked what. Renders
// nothing when the feed is unavailable (migration not applied, wrong role),
// so a dashboard never breaks because of it.
export async function AiAllowanceCard({ supabase }: { supabase: SupabaseClient }) {
  const { data, error } = await supabase.rpc('get_my_ai_allowance')
  if (error || !data) return null
  const a = data as MyAllowance

  const [t, tf, locale] = await Promise.all([
    getTranslations('common.aiAllowance'),
    getTranslations('common.aiFeatures'),
    getLocale() as Promise<Locale>,
  ])
  const fmt = usageFormatters(locale)

  const reqShare = usageShare(Number(a.requests_used), a.request_limit)
  const tokShare = usageShare(Number(a.tokens_used), a.token_limit)
  const shares = [reqShare, tokShare].filter((s): s is number => s != null)
  const worst = shares.length ? Math.max(...shares) : null
  const aiOff = a.request_limit === 0 || a.token_limit === 0

  const status = aiOff ? { tone: 'red', icon: Ban, text: t('aiOff') }
    : worst != null && worst >= 1 ? { tone: 'red', icon: AlertTriangle, text: a.limit_action === 'warn' ? t('reachedWarn') : t('reached') }
    : worst != null && worst * 100 >= a.alert_threshold_pct ? { tone: 'amber', icon: AlertTriangle, text: t('nearing', { pct: Math.floor(worst * 100) }) }
    : null

  const top = Object.entries(a.by_feature ?? {}).sort((x, y) => y[1] - x[1]).slice(0, 4)

  const meters = [
    { label: t('requests'), used: Number(a.requests_used), limit: a.request_limit, share: reqShare, show: fmt.int },
    { label: t('tokens'), used: Number(a.tokens_used), limit: a.token_limit, share: tokShare, show: fmt.compact },
  ]

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
      <div className="flex items-start gap-3 mb-4">
        <div className="p-2 rounded-lg bg-blue-500/10"><Sparkles className="w-5 h-5 text-blue-400" /></div>
        <div>
          <h3 className="text-white font-semibold">{t('title')}</h3>
          <p className="text-slate-400 text-sm">{t('subtitle')}</p>
        </div>
      </div>

      {status && (
        <div className={cn(
          'flex items-start gap-2 rounded-lg border px-3 py-2 text-sm mb-4',
          status.tone === 'red' ? 'bg-red-500/10 border-red-500/30 text-red-300' : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
        )}>
          <status.icon className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{status.text}</span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {meters.map(m => (
          <div key={m.label}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-slate-400 text-sm">{m.label}</span>
              <span className="text-white text-sm font-medium tabular-nums">
                {m.limit == null ? fmt.int(m.used) : t('ofLimit', { used: m.show(m.used), limit: m.show(m.limit) })}
              </span>
            </div>
            {m.share != null ? (
              <div className="h-1.5 mt-2 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className={cn('h-full rounded-full', m.share >= 1 ? 'bg-red-500' : m.share * 100 >= a.alert_threshold_pct ? 'bg-amber-500' : 'bg-blue-500')}
                  style={{ width: `${Math.min(m.share, 1) * 100}%` }}
                />
              </div>
            ) : (
              <p className="text-slate-500 text-xs mt-1">{t('unlimited')}</p>
            )}
          </div>
        ))}
      </div>

      {top.length > 0 && (
        <div className="mt-4 pt-4 border-t border-slate-800">
          <p className="text-slate-400 text-xs mb-2">{t('byFeature')}</p>
          <ul className="flex flex-wrap gap-2">
            {top.map(([f, count]) => (
              <li key={f} className="text-xs text-slate-300 bg-slate-800 rounded-full px-2.5 py-1 tabular-nums">
                {tf.has(f) ? tf(f) : f} · {fmt.int(Number(count))}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-slate-500 text-xs mt-4">{t('renews')}</p>
    </div>
  )
}
