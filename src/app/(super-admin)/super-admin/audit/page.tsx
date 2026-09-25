export const dynamic = 'force-dynamic'
import { ShieldCheck } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

export default async function AuditPage() {
  const t = await getTranslations('superAdmin.audit')
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">{t('title')}</h2>
        <p className="text-slate-400 mt-1">{t('subtitle')}</p>
      </div>
      <div className="text-center py-20 bg-slate-900 border border-slate-800 rounded-xl">
        <ShieldCheck className="w-12 h-12 text-slate-600 mx-auto mb-3" />
        <p className="text-slate-400">{t('comingSoon')}</p>
      </div>
    </div>
  )
}
