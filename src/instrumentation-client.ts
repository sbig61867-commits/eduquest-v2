// Error monitoring off the critical path (perf audit 2026-09-30): the Sentry
// SDK was the largest script on every page and delayed first paint, public
// pages included. It now loads once the browser is idle (src/lib/sentry-client.ts);
// an error boundary that fires earlier loads it on the spot.
import { loadSentry } from '@/lib/sentry-client'

if (typeof window !== 'undefined') {
  const load = () => { void loadSentry() }
  if ('requestIdleCallback' in window) window.requestIdleCallback(load, { timeout: 5000 })
  else setTimeout(load, 3000)
}
