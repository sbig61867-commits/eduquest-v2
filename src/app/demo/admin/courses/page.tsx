import { DemoCard } from '@/components/demo/demo-shell'
import { getTranslations, getLocale } from 'next-intl/server'
import type { Locale } from '@/i18n/config'
import { getDemoData } from '@/lib/demo/data'

export default async function DemoAdminCourses() {
  const t = await getTranslations('public.demo')
  const d = getDemoData((await getLocale()) as Locale)
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">{t('admin.courses')}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {d.courses.map((c) => (
          <DemoCard key={c.id} title={c.title}>
            <p className="text-slate-400 text-sm mb-2">{c.level} · {t('common.units', { count: c.units })}</p>
            <span className={`text-xs px-2 py-1 rounded-full ${c.published ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-800 text-slate-400'}`}>
              {c.published ? t('common.published') : t('common.draft')}
            </span>
          </DemoCard>
        ))}
      </div>
    </div>
  )
}
