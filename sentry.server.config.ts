import * as Sentry from '@sentry/nextjs'

// DSN is not a secret — it only allows sending events, and ships in client
// bundles anyway. Hardcoded so a missing env var can never silently disable
// error reporting in production.
Sentry.init({
  dsn: 'https://c20195c54ea2721922589434227cf0b5@o4511721394405376.ingest.de.sentry.io/4511721421471824',
  enabled: process.env.NODE_ENV === 'production',
  // Errors are the priority; keep performance tracing light to protect the
  // free-tier quota.
  tracesSampleRate: 0.1,
})
