import { DemoCard } from '@/components/demo/demo-shell'
import { getTranslations, getLocale } from 'next-intl/server'
import type { Locale } from '@/i18n/config'
import { getDemoData } from '@/lib/demo/data'

export default async function DemoCenterSchedules() {
  const t = await getTranslations('public.demo')
  const tc = await getTranslations('common')
  const d = getDemoData((await getLocale()) as Locale)
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">{t('center.weeklySchedules')}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {d.schedule.map((day) => (
          <DemoCard key={day.day} title={tc(`days.${day.day}`)}>
            <ul className="space-y-2">
              {day.slots.map((s) => (
                <li key={s} className="text-slate-300 text-sm">{s}</li>
              ))}
            </ul>
          </DemoCard>
        ))}
      </div>
    </div>
  )
}
