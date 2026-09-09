'use client'

import ErrorFallback from '@/components/shared/error-fallback'

export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="min-h-screen bg-canvas">
      <ErrorFallback error={error} reset={reset} homeHref="/" homeLabel="Go home" />
    </div>
  )
}
