import { DemoCard } from '@/components/demo/demo-shell'
import { getTranslations, getLocale } from 'next-intl/server'
import type { Locale } from '@/i18n/config'
import { getDemoData } from '@/lib/demo/data'

export default async function DemoTeacherExams() {
  const t = await getTranslations('public.demo')
  const d = getDemoData((await getLocale()) as Locale)
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">{t('nav.exams')}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {d.exams.map((e) => (
          <DemoCard key={e.id} title={e.title}>
            <p className="text-slate-400 text-sm">{t('common.date', { date: e.date })}</p>
            <p className="text-slate-400 text-sm">{t('common.duration', { count: e.duration })}</p>
            <p className="text-slate-400 text-sm">{t('common.submissionsLabel', { count: e.submissions })}</p>
          </DemoCard>
        ))}
      </div>
    </div>
  )
}
