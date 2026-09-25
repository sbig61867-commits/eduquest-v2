import { getRequestConfig } from 'next-intl/server'

import { buildRequestConfig } from './runtime'

/**
 * next-intl's server entry point. Deliberately a one-liner: everything with
 * behaviour lives in ./runtime, which is testable under jsdom (this module is
 * not — `next-intl/server` refuses to load outside the `react-server`
 * condition). The wiring itself is verified by the production build and by
 * tests/i18n-locale.spec.ts against localhost.
 */
export default getRequestConfig(async ({ requestLocale }) =>
  buildRequestConfig(await requestLocale)
)
