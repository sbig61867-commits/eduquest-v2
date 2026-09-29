#!/usr/bin/env node
// Repairs the pasted SUPABASE_DB_URL before `supabase db dump` sees it, and
// masks the password in the (public) workflow log. A password with @ # / ? :
// must be percent-encoded inside a link, which is easy to get wrong by hand.
//
//   node scripts/backup/db-url.mjs <output file>
//
// Writes the normalized link to the output file (never to the log) and prints
// only ::add-mask:: commands on stdout.

import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { normalizeDbUrl } from './lib.mjs'

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const out = process.argv[2]
  try {
    if (!out) throw new Error('usage: db-url.mjs <output file>')
    const { url, masks } = normalizeDbUrl(process.env.SUPABASE_DB_URL ?? '')
    for (const m of masks) console.log(`::add-mask::${m}`)
    writeFileSync(out, url, { mode: 0o600 })
  } catch (err) {
    console.error(`::error::${err.message}`)
    process.exit(1)
  }
}
