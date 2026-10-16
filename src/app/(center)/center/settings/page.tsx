import { getTranslations } from 'next-intl/server'
import { PreferencesCard } from '@/components/shared/preferences-card'

// Account settings for this role: language and appearance. The role layout
// already requires a signed-in user.
export default async function CenterSettingsPage() {
  const t = await getTranslations('common.account')
  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-h1 text-fg">{t('settings')}</h1>
      <PreferencesCard />
    </div>
  )
}
