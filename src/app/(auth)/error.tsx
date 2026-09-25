'use client'

import { useTranslations } from 'next-intl'
import ErrorFallback from '@/components/shared/error-fallback'

export default function AuthError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('auth.error')
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900">
      <ErrorFallback error={error} reset={reset} homeHref="/login" homeLabel={t('backToSignIn')} />
    </div>
  )
}
