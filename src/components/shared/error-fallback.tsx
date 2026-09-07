'use client'

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'
import { RefreshCw, Home } from 'lucide-react'

interface ErrorFallbackProps {
  error: Error & { digest?: string }
  reset: () => void
  /** Where "Go back" points; omit to hide the button */
  homeHref?: string
  homeLabel?: string
}

/**
 * Shared UI for all error.tsx boundaries. Logs the error (digest included —
 * that's the ID Vercel shows in its function logs) so production issues are
 * traceable even before a monitoring service is wired in.
 */
export default function ErrorFallback({ error, reset, homeHref, homeLabel = 'Go to dashboard' }: ErrorFallbackProps) {
  useEffect(() => {
    console.error('[error-boundary]', error.digest ?? '', error)
    Sentry.captureException(error)
  }, [error])

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="w-full max-w-md p-8 space-y-5 bg-white/5 backdrop-blur-xl border border-white/10 rounded-lg shadow-2xl text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-lg bg-red-600/20 mb-1">
          <span className="text-red-400 text-3xl">!</span>
        </div>
        <h1 className="text-xl font-bold text-fg">Something went wrong</h1>
        <p className="text-fg-secondary text-sm leading-relaxed">
          An unexpected error occurred. Your data is safe — try again, and if
          the problem persists, contact your administrator.
        </p>
        {error.digest && (
          <p className="text-xs text-fg-muted font-mono">Error ID: {error.digest}</p>
        )}
        <div className="flex items-center justify-center gap-3 pt-1">
          <button
            onClick={reset}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-accent hover:bg-accent-hover text-fg font-medium rounded-lg transition-colors text-sm"
          >
            <RefreshCw className="w-4 h-4" />
            Try again
          </button>
          {homeHref && (
            <a
              href={homeHref}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-white/10 hover:bg-white/15 text-fg font-medium rounded-lg transition-colors text-sm"
            >
              <Home className="w-4 h-4" />
              {homeLabel}
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
