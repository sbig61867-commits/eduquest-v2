import { getTranslations } from 'next-intl/server'

export default async function Loading() {
  const t = await getTranslations('auth')
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4 animate-pulse" aria-hidden="true">
        <div className="h-10 w-40 bg-surface rounded-lg mx-auto" />
        <div className="h-64 bg-surface rounded-xl" />
      </div>
      <span className="sr-only">{t('loading')}</span>
    </div>
  )
}
