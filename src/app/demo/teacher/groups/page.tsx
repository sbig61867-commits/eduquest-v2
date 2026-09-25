import { DemoCard } from '@/components/demo/demo-shell'
import { getTranslations, getLocale } from 'next-intl/server'
import type { Locale } from '@/i18n/config'
import { getDemoData } from '@/lib/demo/data'

export default async function DemoTeacherGroups() {
  const t = await getTranslations('public.demo')
  const d = getDemoData((await getLocale()) as Locale)
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">{t('nav.groups')}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        {d.teacherGroups.map((g) => (
          <DemoCard key={g.name} title={g.name}>
            <p className="text-slate-400 text-sm">{t('common.students', { count: g.count })}</p>
          </DemoCard>
        ))}
      </div>
      <DemoCard title={t('common.sample')}>
        <ul className="space-y-3">
          {d.students.map((s) => (
            <li key={s.id} className="flex items-center justify-between">
              <span className="text-white text-sm">{s.name}</span>
              <span className="text-slate-400 text-sm">{s.group}</span>
            </li>
          ))}
        </ul>
      </DemoCard>
    </div>
  )
}
