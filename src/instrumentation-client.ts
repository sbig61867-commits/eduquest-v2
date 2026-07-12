import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: 'https://c20195c54ea2721922589434227cf0b5@o4511721394405376.ingest.de.sentry.io/4511721421471824',
  enabled: process.env.NODE_ENV === 'production',
  tracesSampleRate: 0.1,
  // No session replay: it burns free-tier quota fast and exam pages are
  // privacy-sensitive (proctoring video must never reach a third party).
})

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
