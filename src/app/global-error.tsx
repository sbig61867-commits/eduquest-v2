'use client'

import { useEffect, useState } from 'react'
import * as Sentry from '@sentry/nextjs'
import arCommon from '@/messages/ar/common.json'
import enCommon from '@/messages/en/common.json'
import { LOCALE_COOKIE, dirFor, toLocale, type Locale } from '@/i18n/config'

// Catches errors thrown by the root layout itself. Must render its own
// <html>/<body> because the root layout is what failed. Kept dependency-free
// (no Tailwind classes are guaranteed here if globals.css failed to load).
//
// No intl provider exists here — it lived in the layout that just crashed.
// So the locale is read straight from the eq_locale cookie (deliberately not
// HttpOnly) and only the two small `common` dictionaries are imported.
const COMMON: Record<Locale, typeof enCommon> = { ar: arCommon, en: enCommon }

function cookieLocale(): Locale {
  const match = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE}=([^;]*)`))
  return toLocale(match?.[1])
}

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // Server render has no cookie access here; Arabic is the platform default.
  const [locale, setLocale] = useState<Locale>('ar')
  useEffect(() => {
    Sentry.captureException(error)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time post-hydration cookie read
    setLocale(cookieLocale())
  }, [error])

  const m = COMMON[locale]

  return (
    <html lang={locale} dir={dirFor(locale)}>
      <body style={{ margin: 0, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f172a', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ textAlign: 'center', padding: 24 }}>
          <h1 style={{ fontSize: 20, marginBottom: 8 }}>{m.error.title}</h1>
          <p style={{ color: '#94a3b8', fontSize: 14, marginBottom: 8 }}>
            {m.globalError.body}
          </p>
          {error.digest && (
            <p style={{ color: '#64748b', fontSize: 12, fontFamily: 'monospace', marginBottom: 16 }}>
              Error ID: {error.digest}
            </p>
          )}
          <button
            onClick={reset}
            style={{ padding: '10px 20px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, cursor: 'pointer' }}
          >
            {m.error.retry}
          </button>
        </div>
      </body>
    </html>
  )
}
