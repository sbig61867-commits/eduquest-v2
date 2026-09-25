/**
 * Message loading and namespace scoping — this is where C1 lives.
 *
 * Phase 0a proved two things that shape this file:
 *
 *  1. `getTranslations()` in a Server Component reads from
 *     `getRequestConfig().messages` and nothing else. A namespace missing
 *     there renders the raw key path **silently** — no throw, no warning. So
 *     the request config must expose EVERY namespace the server can ask for.
 *
 *  2. Whatever is handed to `<NextIntlClientProvider messages={…}>` is
 *     serialized into the RSC payload of every page under it. Passing the full
 *     dictionary from the root layout would therefore ship the teacher and
 *     student dictionaries to a student's browser — dead weight that grows
 *     with every extraction phase.
 *
 * The resolution is asymmetric on purpose:
 *
 *     getRequestConfig  →  ALL namespaces   (server-side availability)
 *     root provider     →  ['common']       (explicit, minimal)
 *     route-group prov. →  ['common', <group>]
 *
 * `clientMessages()` is the single choke point, and it refuses any namespace
 * that is not in `CLIENT_NAMESPACES` — so a server-only dictionary (emails,
 * reports) cannot reach the browser even by accident.
 */

import ar from '@/messages/ar'
import en from '@/messages/en'
import {
  CLIENT_NAMESPACES,
  type Locale,
  type Namespace,
} from './config'

export type Messages = typeof en
export type MessageTree = Record<string, unknown>

const DICTIONARIES: Record<Locale, Messages> = { en, ar }

/** Every namespace for a locale — for `getRequestConfig` only. */
export function allMessages(locale: Locale): Messages {
  return DICTIONARIES[locale]
}

/**
 * The client payload. Returns ONLY the requested namespaces.
 *
 * Throws on an unknown or server-only namespace rather than silently dropping
 * it: a typo here would otherwise degrade into rendered key paths at runtime,
 * which is exactly the silent failure C3 exists to prevent.
 */
export function clientMessages(
  locale: Locale,
  namespaces: readonly Namespace[]
): MessageTree {
  const dict = DICTIONARIES[locale] as unknown as MessageTree
  const out: MessageTree = {}

  for (const ns of namespaces) {
    if (!CLIENT_NAMESPACES.includes(ns)) {
      throw new Error(
        `[i18n] Namespace "${ns}" is server-only and must not be sent to the client. ` +
          `Allowed: ${CLIENT_NAMESPACES.join(', ')}`
      )
    }
    if (!(ns in dict)) {
      throw new Error(`[i18n] Unknown namespace "${ns}" for locale "${locale}".`)
    }
    out[ns] = dict[ns]
  }

  return out
}
