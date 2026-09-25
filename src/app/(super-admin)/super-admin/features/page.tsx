'use client'
export const dynamic = 'force-dynamic'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Flag } from 'lucide-react'

const DEFAULT_FLAGS = ['ai_lesson_generation', 'proctoring', 'file_uploads', 'realtime_updates'] as const

export default function FeaturesPage() {
  const t = useTranslations('superAdmin.features')
  const [flags, setFlags] = useState<Record<string, boolean>>({
    ai_lesson_generation: true,
    proctoring: true,
    file_uploads: true,
    realtime_updates: true,
  })

  function toggle(name: string) {
    setFlags(prev => ({ ...prev, [name]: !prev[name] }))
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">{t('title')}</h2>
        <p className="text-slate-400 mt-1">{t('subtitle')}</p>
      </div>
      <div className="space-y-3">
        {DEFAULT_FLAGS.map(name => (
          <div key={name} className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-violet-500/10 flex items-center justify-center">
                <Flag className="w-5 h-5 text-violet-400" />
              </div>
              <div>
                <p className="text-white font-medium">{t(`items.${name}.label`)}</p>
                <p className="text-slate-400 text-sm">{t(`items.${name}.description`)}</p>
              </div>
            </div>
            <button
              onClick={() => toggle(name)}
              aria-label={t('toggle', { name: t(`items.${name}.label`) })}
              aria-pressed={flags[name]}
              className={`relative w-12 h-6 rounded-full transition-colors focus:outline-none ${flags[name] ? 'bg-blue-600' : 'bg-slate-700'}`}
            >
              <span className={`absolute top-1 start-0 w-4 h-4 rounded-full bg-white transition-transform ${flags[name] ? 'translate-x-7 rtl:-translate-x-7' : 'translate-x-1 rtl:-translate-x-1'}`} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
