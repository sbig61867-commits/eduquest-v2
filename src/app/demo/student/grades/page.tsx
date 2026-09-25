import { DemoCard } from '@/components/demo/demo-shell'
import { getTranslations, getLocale } from 'next-intl/server'
import type { Locale } from '@/i18n/config'
import { getDemoData } from '@/lib/demo/data'

export default async function DemoStudentGrades() {
  const t = await getTranslations('public.demo')
  const d = getDemoData((await getLocale()) as Locale)
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">{t('student.myGrades')}</h2>
      <DemoCard title={t('student.gradeRecord')}>
        <ul className="space-y-3">
          {d.grades.map((g) => (
            <li key={g.exam} className="flex items-center justify-between">
              <span className="text-white text-sm">{g.exam}</span>
              <span className="text-emerald-400 text-sm font-semibold">{g.score} / {g.outOf}</span>
            </li>
          ))}
        </ul>
      </DemoCard>
    </div>
  )
}
