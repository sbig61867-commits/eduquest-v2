#!/usr/bin/env node
// Creates the backup key pair, once. The PRIVATE key opens every backup:
// keep it outside this repository, in two safe places (e.g. a password
// manager and a USB stick). Lose it and the backups cannot be read by anyone.
// The PUBLIC key only locks backups; it goes into the GitHub secret
// BACKUP_PUBLIC_KEY.
//
//   node scripts/backup/keygen.mjs                       → ~/eduquest-backup-key.pem
//   node scripts/backup/keygen.mjs --out D:\keys\eq.pem
//
// Optional: set BACKUP_KEY_PASSPHRASE first to also lock the private key file
// with a passphrase (then the same variable is needed to restore).

import { existsSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { generateKeyPairSync } from 'node:crypto'
import { keyFingerprint } from './lib.mjs'

const { values } = parseArgs({ options: { out: { type: 'string' } } })
const out = resolve(values.out ?? join(homedir(), 'eduquest-backup-key.pem'))
if (existsSync(out)) {
  console.error(`${out} already exists — refusing to overwrite a key that may still be needed.`)
  process.exit(1)
}

const passphrase = process.env.BACKUP_KEY_PASSPHRASE || undefined
const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 4096,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: passphrase
    ? { type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase }
    : { type: 'pkcs8', format: 'pem' },
})

writeFileSync(out, privateKey, { mode: 0o600 })
writeFileSync(`${out}.pub`, publicKey)
console.log(`Private key (keep it safe, never commit it): ${out}${passphrase ? '  [passphrase-protected]' : ''}`)
console.log(`Public key: ${out}.pub   fingerprint ${keyFingerprint(publicKey)}\n`)
console.log('Paste this whole block into the GitHub secret BACKUP_PUBLIC_KEY:\n')
console.log(publicKey)
