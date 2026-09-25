import { DemoCard } from '@/components/demo/demo-shell'
import { getTranslations, getLocale } from 'next-intl/server'
import type { Locale } from '@/i18n/config'
import { getDemoData } from '@/lib/demo/data'

export default async function DemoStudentCourses() {
  const t = await getTranslations('public.demo')
  const d = getDemoData((await getLocale()) as Locale)
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">{t('student.myCourses')}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {d.courses.filter(c => c.published).map((c) => (
          <DemoCard key={c.id} title={c.title}>
            <p className="text-slate-400 text-sm mb-3">{c.level} · {t('common.units', { count: c.units })}</p>
            <div className="w-full bg-slate-800 rounded-full h-2">
              <div className="bg-blue-600 h-2 rounded-full" style={{ width: '62%' }} />
            </div>
            <p className="text-slate-500 text-xs mt-1">{t('student.completedPct', { pct: 62 })}</p>
          </DemoCard>
        ))}
      </div>
    </div>
  )
}
