import { DemoCard } from '@/components/demo/demo-shell'
import { getTranslations, getLocale } from 'next-intl/server'
import type { Locale } from '@/i18n/config'
import { getDemoData } from '@/lib/demo/data'

export default async function DemoAdminStudents() {
  const t = await getTranslations('public.demo')
  const d = getDemoData((await getLocale()) as Locale)
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">{t('admin.students')}</h2>
      <DemoCard title={t('common.sample')}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-start">
            <thead>
              <tr className="text-slate-400 border-b border-slate-800">
                <th className="py-2 font-medium text-start">{t('common.name')}</th>
                <th className="py-2 font-medium text-start">{t('common.group')}</th>
                <th className="py-2 font-medium text-start">{t('admin.avg')}</th>
              </tr>
            </thead>
            <tbody>
              {d.students.map((s) => (
                <tr key={s.id} className="border-b border-slate-800/60">
                  <td className="py-3 text-white">{s.name}</td>
                  <td className="py-3 text-slate-400">{s.group}</td>
                  <td className="py-3 text-emerald-400">{s.avgGrade}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DemoCard>
    </div>
  )
}
