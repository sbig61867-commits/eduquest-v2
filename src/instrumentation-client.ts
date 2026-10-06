// Error monitoring off the critical path (perf audit 2026-09-30): the Sentry
// SDK was the largest script on every page and delayed first paint, public
// pages included. It now loads after the page's `load` event, at the next idle
// moment (src/lib/sentry-client.ts, Gate 5 2026-10-06); an error boundary that
// fires earlier loads it on the spot.
import { scheduleSentryLoad } from '@/lib/sentry-client'

scheduleSentryLoad()
