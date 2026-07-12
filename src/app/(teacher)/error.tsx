'use client'

import ErrorFallback from '@/components/shared/error-fallback'

export default function TeacherError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorFallback error={error} reset={reset} homeHref="/teacher/dashboard" />
}
