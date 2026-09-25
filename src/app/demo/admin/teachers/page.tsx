import { DemoCard } from '@/components/demo/demo-shell'
import { getTranslations, getLocale } from 'next-intl/server'
import type { Locale } from '@/i18n/config'
import { getDemoData } from '@/lib/demo/data'

export default async function DemoAdminTeachers() {
  const t = await getTranslations('public.demo')
  const d = getDemoData((await getLocale()) as Locale)
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">{t('admin.teachers')}</h2>
      <DemoCard title={t('admin.teachersCount', { count: d.teachers.length })}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-start">
            <thead>
              <tr className="text-slate-400 border-b border-slate-800">
                <th className="py-2 font-medium text-start">{t('common.name')}</th>
                <th className="py-2 font-medium text-start">{t('admin.subject')}</th>
                <th className="py-2 font-medium text-start">{t('admin.groups')}</th>
                <th className="py-2 font-medium text-start">{t('admin.students')}</th>
              </tr>
            </thead>
            <tbody>
              {d.teachers.map((tc) => (
                <tr key={tc.id} className="border-b border-slate-800/60">
                  <td className="py-3 text-white">{tc.name}</td>
                  <td className="py-3 text-slate-400">{tc.subject}</td>
                  <td className="py-3 text-slate-400">{tc.groups}</td>
                  <td className="py-3 text-slate-400">{tc.students}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DemoCard>
    </div>
  )
}
