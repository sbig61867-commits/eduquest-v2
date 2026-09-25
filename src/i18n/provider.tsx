import { NextIntlClientProvider } from 'next-intl'
import { getLocale } from 'next-intl/server'

import { type Namespace, toLocale } from './config'
import { clientMessages } from './messages'

/**
 * The only way a `NextIntlClientProvider` should be created in this app.
 *
 * Taking `namespaces` as a required prop is the whole point: there is no
 * "pass everything" default to fall into, so the client payload of every
 * subtree is a decision someone wrote down. See src/i18n/messages.ts (C1).
 *
 * Nesting is supported and intended — the root layout mounts
 * `['common']`, and a route group re-mounts `['common', 'admin']` for its own
 * subtree. The inner provider *replaces* the context rather than merging into
 * it, which is why each one restates `common`.
 *
 * Server Component. Do not add `'use client'`: the message picking must stay
 * on the server, otherwise the full dictionary crosses the boundary to be
 * filtered, defeating the exercise.
 */
export async function ScopedIntlProvider({
  namespaces,
  children,
}: {
  namespaces: readonly Namespace[]
  children: React.ReactNode
}) {
  const locale = toLocale(await getLocale())

  return (
    <NextIntlClientProvider locale={locale} messages={clientMessages(locale, namespaces)}>
      {children}
    </NextIntlClientProvider>
  )
}
