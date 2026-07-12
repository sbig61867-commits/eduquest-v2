'use client'

import ErrorFallback from '@/components/shared/error-fallback'

export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900">
      <ErrorFallback error={error} reset={reset} homeHref="/" homeLabel="Go home" />
    </div>
  )
}
