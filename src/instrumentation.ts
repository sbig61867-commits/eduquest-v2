import * as Sentry from '@sentry/nextjs'

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config')
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config')
  }
}

// Captures errors from React Server Components, route handlers, and server
// actions — the server-side counterpart of the client error boundaries.
export const onRequestError = Sentry.captureRequestError
