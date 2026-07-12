import type { Instrumentation } from 'next'

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config')
  }
  // Deliberately NOT initializing Sentry in the edge runtime: it wraps the
  // proxy (auth gate) on EVERY request and inflated middleware latency from
  // ~10-55ms to 500ms+ platform-wide. Server + client coverage is enough.
}

// Captures errors from React Server Components, route handlers, and server
// actions. Sentry is imported dynamically so the edge bundle (which also
// loads this file) never pulls in the SDK.
export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { captureRequestError } = await import('@sentry/nextjs')
    captureRequestError(...args)
  }
}
