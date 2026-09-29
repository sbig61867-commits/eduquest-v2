#!/usr/bin/env node
// Encrypts the SQL dump in --dir and stores it in Cloudflare Workers KV, then
// keeps only the newest copies. Run by .github/workflows/db-backup.yml right
// after `supabase db dump`; see scripts/backup/README.md.
//
//   node scripts/backup/backup.mjs --dir dump --reason "schedule"
//
// Env: BACKUP_PUBLIC_KEY (PEM), BACKUP_KV_ACCOUNT_ID, BACKUP_KV_NAMESPACE_ID,
//      BACKUP_KV_API_TOKEN; optional BACKUP_KEEP (default 8), BACKUP_PREFIX.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import {
  DEFAULT_KEEP, DEFAULT_PREFIX, buildBackup, downloadBackup, groupBackups, kvClient, planPrune, readManifest, uploadBackup,
} from './lib.mjs'

/** The files `supabase db dump` writes, in restore order. */
export const DUMP_FILES = ['roles.sql', 'schema.sql', 'data.sql']

/**
 * @param {{ dir: string, reason?: string, publicKeyPem: string, kv: import('./lib.mjs').KvStore,
 *           keep?: number, prefix?: string, source?: object, log?: (msg: string) => void, retry?: object }} opts
 */
export async function runBackup({ dir, reason = 'manual', publicKeyPem, kv, keep = DEFAULT_KEEP, prefix = DEFAULT_PREFIX, source = {}, log = console.log, retry }) {
  const files = DUMP_FILES.map(name => ({ name, data: readFileSync(join(dir, name)) }))
  const empty = files.filter(f => f.data.length === 0 && f.name !== 'roles.sql')
  if (empty.length) throw new Error(`Empty dump file(s): ${empty.map(f => f.name).join(', ')}`)

  const backup = buildBackup(files, { publicKeyPem, reason, source, prefix })
  const { manifest } = backup
  log(`Backup ${manifest.id}: ${manifest.plainBytes} bytes → ${manifest.compressedBytes} compressed → ${manifest.parts.length} encrypted part(s)`)

  await uploadBackup(kv, backup, prefix)
  // Read it all back before touching older copies: a backup is only real once it can be downloaded intact.
  const stored = await readManifest(kv, manifest.id, prefix, retry)
  await downloadBackup(kv, stored, retry)
  log(`Verified ${manifest.id} (sha256 ${manifest.sha256.slice(0, 16)}…)`)

  const groups = groupBackups(await kv.list(prefix), prefix)
  // Sizes keep all copies together inside KV's shared 1 GB (see BUDGET_BYTES).
  const sizes = { [manifest.id]: manifest.encryptedBytes }
  for (const g of groups) {
    if (!g.complete || g.id === manifest.id) continue
    try { sizes[g.id] = (await readManifest(kv, g.id, prefix, { attempts: 1 })).encryptedBytes ?? 0 } catch { /* unreadable: counted as 0, still limited by keep */ }
  }
  const doomed = planPrune(groups, keep, manifest.id, { sizes })
  for (const g of doomed) {
    for (const key of g.keys) await kv.delete(key)
    log(`Removed ${g.complete ? 'old' : 'unfinished'} backup ${g.id}`)
  }
  return { manifest, removed: doomed.map(g => g.id) }
}

function requireEnv(name) {
  const v = process.env[name]
  if (!v) throw new Error(`${name} is not set`)
  return v
}

async function main() {
  const { values } = parseArgs({ options: { dir: { type: 'string', default: 'dump' }, reason: { type: 'string', default: 'manual' } } })
  const kv = kvClient({
    accountId: requireEnv('BACKUP_KV_ACCOUNT_ID'),
    namespaceId: requireEnv('BACKUP_KV_NAMESPACE_ID'),
    token: requireEnv('BACKUP_KV_API_TOKEN'),
  })
  const env = process.env
  await runBackup({
    dir: values.dir,
    reason: values.reason,
    publicKeyPem: requireEnv('BACKUP_PUBLIC_KEY'),
    kv,
    keep: env.BACKUP_KEEP ? Number(env.BACKUP_KEEP) : DEFAULT_KEEP,
    prefix: env.BACKUP_PREFIX || DEFAULT_PREFIX,
    source: {
      gitSha: env.GITHUB_SHA,
      runUrl: env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : undefined,
    },
  })
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(err => {
    console.error(`Backup failed: ${err.message}`)
    process.exit(1)
  })
}
