/**
 * Migration runner — uses pg to connect directly to Supabase PostgreSQL
 * Run: node scripts/run-migration.mjs
 */

import { createRequire } from 'module'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))

// Dynamically require pg (installed in temp step)
let Client
try {
  Client = require('pg').Client
} catch {
  console.error('❌ pg not found. Run: npm install pg --no-save')
  process.exit(1)
}

const sql = readFileSync(
  join(__dirname, '..', 'supabase', 'invitations_migration.sql'),
  'utf8'
)

// Split on statement boundaries (semicolons not inside strings/blocks)
// We use a simpler approach: split by double-newline between statements
// and execute each non-empty statement individually.
function splitStatements(sql) {
  // Split on $$ boundaries for PLpgSQL blocks, then on semicolons
  const statements = []
  let current = ''
  let inDollar = false

  const lines = sql.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('--')) { continue } // skip comment-only lines

    // Track $$ for PLpgSQL blocks
    const dollarCount = (line.match(/\$\$/g) || []).length
    if (dollarCount % 2 !== 0) inDollar = !inDollar

    current += line + '\n'

    // A statement ends at semicolon outside of a dollar block
    if (!inDollar && trimmed.endsWith(';')) {
      const stmt = current.trim()
      if (stmt && stmt !== ';') statements.push(stmt)
      current = ''
    }
  }

  return statements
}

async function run() {
  // SECURITY: never hardcode the DB password here — it previously was,
  // committed in plaintext to git history (found by gitleaks). Rotate the
  // password in Supabase (Project Settings > Database) and set it via env
  // var before running this script.
  const password = process.env.SUPABASE_DB_PASSWORD
  if (!password) {
    console.error('❌ Set SUPABASE_DB_PASSWORD before running this script.')
    process.exit(1)
  }
  const client = new Client({
    host:     'db.ubngpsdzjoeqfxfbdtxc.supabase.co',
    port:     5432,
    database: 'postgres',
    user:     'postgres',
    password,
    ssl:      { rejectUnauthorized: false },
  })

  await client.connect()
  console.log('✅ Connected to Supabase PostgreSQL\n')

  const statements = splitStatements(sql)
  console.log(`📋 Found ${statements.length} statements to execute\n`)

  let success = 0
  let skipped = 0

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i]
    const preview = stmt.slice(0, 80).replace(/\n/g, ' ')
    process.stdout.write(`[${i + 1}/${statements.length}] ${preview}… `)

    try {
      await client.query(stmt)
      console.log('✅')
      success++
    } catch (err) {
      // "already exists" errors are OK (idempotent migration)
      if (
        err.message.includes('already exists') ||
        err.message.includes('does not exist') && err.message.includes('constraint') ||
        err.code === '42P07' || // duplicate table
        err.code === '42710' || // duplicate object
        err.code === '42P16'    // duplicate constraint
      ) {
        console.log(`⚠️  already exists (skipped)`)
        skipped++
      } else {
        console.log(`❌ FAILED`)
        console.error(`   Error: ${err.message}\n`)
        // Continue — don't abort on non-critical errors
      }
    }
  }

  await client.end()

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
  console.log(`✅ Done: ${success} executed, ${skipped} skipped`)
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`)
}

run().catch(err => {
  console.error('Fatal error:', err.message)
  process.exit(1)
})
