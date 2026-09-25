'use client'

import { CalendarDays, Bell, Inbox } from 'lucide-react'
import { DemoStatCard, DemoCard } from '@/components/demo/demo-shell'
import { useTranslations, useLocale } from 'next-intl'
import type { Locale } from '@/i18n/config'
import { getDemoData } from '@/lib/demo/data'

export default function DemoCenterDashboard() {
  const t = useTranslations('public.demo')
  const d = getDemoData(useLocale() as Locale)
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">{t('center.title')}</h2>
        <p className="text-slate-400 mt-1">{t('center.subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <DemoStatCard label={t('center.activeSchedules')} value={4} icon={CalendarDays} color="text-blue-400" bg="bg-blue-500/10" />
        <DemoStatCard label={t('center.announcements')} value={d.announcements.length} icon={Bell} color="text-amber-400" bg="bg-amber-500/10" />
        <DemoStatCard label={t('center.openRequests')} value={d.requests.length} icon={Inbox} color="text-violet-400" bg="bg-violet-500/10" />
      </div>

      <DemoCard title={t('center.requests')}>
        <ul className="space-y-3">
          {d.requests.map((r) => (
            <li key={r.id} className="flex items-center justify-between">
              <div>
                <p className="text-white text-sm font-medium">{r.subject}</p>
                <p className="text-slate-500 text-xs">{r.from}</p>
              </div>
              <span className="text-xs text-slate-400">{t(`center.status.${r.status}`)}</span>
            </li>
          ))}
        </ul>
      </DemoCard>
    </div>
  )
}
