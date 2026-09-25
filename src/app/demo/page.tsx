import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { GraduationCap, Users, ShieldCheck, Building2 } from 'lucide-react'
import { LocaleSwitcher } from '@/components/shared/locale-switcher'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('public.demo.meta')
  return { title: t('title'), description: t('description') }
}

// Visual config only; labels resolve per request.
const ROLES = [
  { key: 'admin', href: '/demo/admin', icon: ShieldCheck, color: 'text-blue-400', bg: 'bg-blue-500/10' },
  { key: 'teacher', href: '/demo/teacher', icon: GraduationCap, color: 'text-violet-400', bg: 'bg-violet-500/10' },
  { key: 'student', href: '/demo/student', icon: Users, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  { key: 'center', href: '/demo/center', icon: Building2, color: 'text-amber-400', bg: 'bg-amber-500/10' },
] as const

export default async function DemoLanding() {
  const t = await getTranslations('public.demo')
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
      <LocaleSwitcher className="fixed top-4 end-4 z-50" />
      <div className="max-w-3xl w-full text-center">
        <h1 className="text-3xl font-bold text-white mb-3">{t('landing.title')}</h1>
        <p className="text-slate-400 mb-10">{t('landing.subtitle')}</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {ROLES.map((r) => {
            const Icon = r.icon
            return (
              <Link
                key={r.href}
                href={r.href}
                className="bg-slate-900 border border-slate-800 rounded-xl p-6 text-start hover:border-blue-600 transition-colors"
              >
                <div className={`w-11 h-11 rounded-lg ${r.bg} flex items-center justify-center mb-4`}>
                  <Icon className={`w-6 h-6 ${r.color}`} />
                </div>
                <h2 className="text-white font-semibold mb-1">{t(`roles.${r.key}.label`)}</h2>
                <p className="text-slate-400 text-sm">{t(`roles.${r.key}.desc`)}</p>
              </Link>
            )
          })}
        </div>

        <p className="text-slate-500 text-sm mt-10">
          {t('landing.convinced')} <Link href="/contact" className="text-blue-400 hover:underline">{t('landing.contact')}</Link> {t('landing.activate')}
        </p>
      </div>
    </div>
  )
}
