import { DemoCard } from '@/components/demo/demo-shell'
import { getTranslations, getLocale } from 'next-intl/server'
import type { Locale } from '@/i18n/config'
import { getDemoData } from '@/lib/demo/data'

export default async function DemoCenterAnnouncements() {
  const t = await getTranslations('public.demo')
  const d = getDemoData((await getLocale()) as Locale)
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">{t('nav.announcements')}</h2>
      <DemoCard title={t('center.publishedAnnouncements')}>
        <ul className="space-y-4">
          {d.announcements.map((a) => (
            <li key={a.id}>
              <p className="text-white text-sm font-medium">{a.title}</p>
              <p className="text-slate-400 text-sm">{a.body}</p>
              <p className="text-slate-500 text-xs mt-1">{a.date}</p>
            </li>
          ))}
        </ul>
      </DemoCard>
    </div>
  )
}
