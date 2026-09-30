// The only Sentry functions the browser needs, as named re-exports.
// sentry-client.ts loads THIS module with import() — importing
// '@sentry/nextjs' itself that way pulls in the whole SDK namespace, which the
// bundler cannot trim (measured 2026-09-30: ~596 KB parsed vs ~227 KB).
export { init, captureException } from '@sentry/nextjs'
