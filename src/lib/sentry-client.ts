// Browser-side Sentry, loaded on demand (perf audit 2026-09-30). The SDK is
// the largest script the app ships, so nothing imports it statically on the
// client: instrumentation-client.ts schedules its routine load after the page's
// `load` event, then the next idle moment (scheduleSentryLoad), and
// reportClientError() loads it first if an error boundary fires before that.
// Only init / captureException are loaded (./sentry-sdk). No performance
// tracing (free-tier quota) and no session replay (quota, and proctored exam
// pages must never reach a third party).

const SENTRY_DSN = 'https://c20195c54ea2721922589434227cf0b5@o4511721394405376.ingest.de.sentry.io/4511721421471824'

type Sdk = typeof import('./sentry-sdk')
let loading: Promise<Sdk | null> | null = null

export function loadSentry(): Promise<Sdk | null> {
  if (process.env.NODE_ENV !== 'production') return Promise.resolve(null)
  loading ??= import('./sentry-sdk')
    .then(sdk => {
      sdk.init({ dsn: SENTRY_DSN, tracesSampleRate: 0 })
      return sdk
    })
    .catch(() => null)
  return loading
}

/**
 * Schedules the routine load of Sentry (Gate 5, 2026-10-06): after the page's
 * `load` event, then the next idle moment — never inside the critical loading
 * window. requestIdleCallback alone fired at ~0.8 s, before DOMContentLoaded,
 * so the 75.6 KB SDK competed with the page's own files on slow networks.
 * An error boundary still loads it at once through reportClientError().
 */
export function scheduleSentryLoad(): void {
  if (typeof window === 'undefined') return
  const whenIdle = () => {
    const load = () => { void loadSentry() }
    if ('requestIdleCallback' in window) window.requestIdleCallback(load, { timeout: 5000 })
    else setTimeout(load, 3000)
  }
  if (document.readyState === 'complete') whenIdle()
  else window.addEventListener('load', whenIdle, { once: true })
}

/** Report an error caught by an error boundary (loads Sentry if needed). */
export function reportClientError(error: unknown) {
  void loadSentry().then(sdk => { sdk?.captureException(error) })
}
