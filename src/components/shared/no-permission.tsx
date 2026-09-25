import { ShieldAlert } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import type { Capability } from '@/lib/permissions'

/**
 * Takes the capability KEY, not a display label: the sentence embeds the
 * permission name, and only the message file can decide how that noun is
 * framed per language ("لا تملك صلاحية X" vs "You do not have the “X”
 * permission"). Passing pre-rendered Arabic here is what froze this screen
 * into one language.
 */
export async function NoPermission({ capability }: { capability: Capability }) {
  const t = await getTranslations('staff')
  return (
    <div className="text-center py-20 bg-slate-900 border border-slate-800 rounded-xl">
      <ShieldAlert className="w-12 h-12 text-slate-600 mx-auto mb-3" />
      <p className="text-slate-400">{t('noPermission.body', { capability: t(`capabilities.${capability}.label`) })}</p>
      <p className="text-slate-500 text-sm mt-1">{t('noPermission.hint')}</p>
    </div>
  )
}
