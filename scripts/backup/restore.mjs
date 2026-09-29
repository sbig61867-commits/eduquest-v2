#!/usr/bin/env node
// Lists the stored backups, or downloads one, checks it and decrypts it into
// plain SQL files. It never writes to any database — the restore command it
// prints is run by hand, against a database you chose (see README.md).
//
//   node --env-file=.env.local scripts/backup/restore.mjs --list
//   node --env-file=.env.local scripts/backup/restore.mjs --id latest --key ~/eduquest-backup-key.pem
//
// Env: BACKUP_KV_ACCOUNT_ID, BACKUP_KV_NAMESPACE_ID, BACKUP_KV_API_TOKEN
//      (the same values as the GitHub secrets); optional BACKUP_KEY_PASSPHRASE, BACKUP_PREFIX.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { DEFAULT_PREFIX, MANIFEST_NAME, downloadBackup, groupBackups, kvClient, openBackup, readManifest } from './lib.mjs'

/**
 * Complete backups, newest first, with their manifests.
 * @param {import('./lib.mjs').KvStore} kv
 */
export async function listBackups(kv, prefix = DEFAULT_PREFIX) {
  const groups = groupBackups(await kv.list(prefix), prefix).filter(g => g.complete)
  return Promise.all(groups.map(g => readManifest(kv, g.id, prefix)))
}

/**
 * Downloads, verifies and decrypts one backup into `outDir`.
 * @param {{ kv: import('./lib.mjs').KvStore, id?: string, privateKeyPem: string, passphrase?: string,
 *           outDir?: string, prefix?: string, retry?: object }} opts
 * @returns {Promise<{ manifest: any, outDir: string, files: string[] }>}
 */
export async function restoreToFiles({ kv, id = 'latest', privateKeyPem, passphrase, outDir, prefix = DEFAULT_PREFIX, retry }) {
  let backupIdToUse = id
  if (id === 'latest') {
    const newest = groupBackups(await kv.list(prefix), prefix).find(g => g.complete)
    if (!newest) throw new Error('No complete backup found')
    backupIdToUse = newest.id
  }
  const manifest = await readManifest(kv, backupIdToUse, prefix, retry)
  const files = openBackup(await downloadBackup(kv, manifest, retry), privateKeyPem, passphrase)
  const dir = outDir ?? join(homedir(), 'eduquest-restore', manifest.id)
  mkdirSync(dir, { recursive: true })
  for (const f of files) {
    const expected = manifest.files.find(m => m.name === f.name)
    if (!expected || expected.bytes !== f.data.length) throw new Error(`${f.name} does not match the manifest`)
    writeFileSync(join(dir, f.name), f.data)
  }
  writeFileSync(join(dir, MANIFEST_NAME), JSON.stringify(manifest, null, 2))
  return { manifest, outDir: dir, files: files.map(f => f.name) }
}

function requireEnv(name) {
  const v = process.env[name]
  if (!v) throw new Error(`${name} is not set`)
  return v
}

async function main() {
  const { values } = parseArgs({
    options: {
      list: { type: 'boolean', default: false },
      id: { type: 'string', default: 'latest' },
      key: { type: 'string' },
      out: { type: 'string' },
    },
  })
  const kv = kvClient({
    accountId: requireEnv('BACKUP_KV_ACCOUNT_ID'),
    namespaceId: requireEnv('BACKUP_KV_NAMESPACE_ID'),
    token: requireEnv('BACKUP_KV_API_TOKEN'),
  })
  const prefix = process.env.BACKUP_PREFIX || DEFAULT_PREFIX

  if (values.list) {
    const all = await listBackups(kv, prefix)
    if (!all.length) console.log('No backups yet.')
    for (const m of all) {
      console.log(`${m.id}  ${(m.plainBytes / 1024 / 1024).toFixed(1)} MB SQL  ${m.parts.length} part(s)  key ${m.keyFingerprint}  ${m.reason}`)
    }
    return
  }

  if (!values.key) throw new Error('--key <path to the private key .pem> is required')
  const keyPath = resolve(values.key.replace(/^~(?=$|[\\/])/, homedir()))
  const { manifest, outDir } = await restoreToFiles({
    kv,
    id: values.id,
    privateKeyPem: readFileSync(keyPath, 'utf8'),
    passphrase: process.env.BACKUP_KEY_PASSPHRASE || undefined,
    outDir: values.out ? resolve(values.out) : undefined,
    prefix,
  })
  console.log(`Backup ${manifest.id} (${manifest.reason}) decrypted and verified into:\n  ${outDir}\n`)
  console.log('To load it into an EMPTY Supabase project (never the live one), with its Session pooler connection string:\n')
  console.log(`  cd "${outDir}"`)
  console.log('  psql --single-transaction --variable ON_ERROR_STOP=1 --file roles.sql --file schema.sql \\')
  console.log("       --command 'SET session_replication_role = replica' --file data.sql --dbname \"<connection string>\"\n")
  console.log('Then follow "After a restore" in scripts/backup/README.md.')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(err => {
    console.error(`Restore failed: ${err.message}`)
    process.exit(1)
  })
}
