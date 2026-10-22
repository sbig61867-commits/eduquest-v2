import postgres from 'postgres'

// Step 9.2: the only way the app talks SQL to Postgres (Neon). Every unit of
// work runs in its own transaction, on one reserved connection, as exactly one
// runtime role (neon/migrations/0003_roles.sql):
//   user     app_user: RLS as the signed-in user (auth.uid() = userId)
//   service  app_service: privileged writes AFTER the route authorized the
//            caller; rows are pinned to one institution (or platform scope for
//            a verified super_admin)
//   system   app_system: rate limiting only
// Identity, role and scope are set with set_config(..., true), so they end
// with the transaction and never reach the next request on a pooled
// connection. The statements of a unit are queued back to back (pipelined),
// which phase 9.0 measured at ~2 round trips instead of ~5.

export type Sql = postgres.Sql
export type Row = Record<string, unknown>
type Pending = postgres.PendingQuery<postgres.Row[]>

export type DbContext =
  | { as: 'user'; userId: string }
  | { as: 'service'; tenantId: string }
  | { as: 'service'; platform: true }
  | { as: 'system' }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Statements and units sent since start, for query-count checks (perf contract). */
export const dbStats = { units: 0, statements: 0 }

// Postgres returns timestamps as 'YYYY-MM-DD HH:MM:SS.ffffff+00'; the app was
// written against PostgREST's ISO form and JSON numbers, so keep that shape.
const isoTimestamp = (x: string) => x.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00')
const TYPES = {
  timestamptz: { to: 1184, from: [1184], serialize: (x: unknown) => String(x), parse: isoTimestamp },
  timestamp: { to: 1114, from: [1114], serialize: (x: unknown) => String(x), parse: (x: string) => x.replace(' ', 'T') },
  numeric: { to: 1700, from: [1700, 20], serialize: (x: unknown) => String(x), parse: (x: string) => Number(x) },
}

const onWorkers = typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers'

async function connectionString(): Promise<string> {
  if (onWorkers) {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare')
    const { env } = await getCloudflareContext({ async: true })
    const hd = (env as unknown as { HYPERDRIVE?: { connectionString: string } }).HYPERDRIVE
    if (hd?.connectionString) return hd.connectionString
  }
  // next dev / tests on Node: the same app_gateway role, directly
  const url = process.env.NEON_GATEWAY_DATABASE_URL
  if (!url) throw new Error('database connection is not configured')
  return url
}

// A connection used by one unit only, start to end.
//  - Workers may not share a socket between requests: a fresh one-connection
//    client per unit is exclusive by itself; the pool lives in Hyperdrive.
//    fetch_types stays off, or every request would pay one more round trip.
//  - Node (next dev, tests) keeps one pool for the process and reserves a
//    connection per unit. fetch_types stays on there: with it off, the first
//    reserve() on a new pool never resolves (measured, postgres 3.4.5).
let nodePool: Sql | null = null
const workerClient = async () =>
  postgres(await connectionString(), { max: 1, prepare: true, fetch_types: false, types: TYPES, onnotice: () => {} })
const pool = async () =>
  (nodePool ??= postgres(await connectionString(), { max: 10, prepare: true, types: TYPES, onnotice: () => {} }))

async function exclusive(): Promise<{ conn: postgres.Sql; done: () => Promise<void> }> {
  if (onWorkers) {
    const sql = await workerClient()
    return { conn: sql, done: () => sql.end({ timeout: 1 }) }
  }
  const conn = await (await pool()).reserve()
  return { conn, done: async () => conn.release() }
}

// Checked before a connection is taken: a statement built on a reserved
// connection but never sent would leave that connection stuck.
function validate(ctx: DbContext): void {
  if (ctx.as === 'user' && !UUID.test(ctx.userId)) throw new Error('db: user context needs a user id')
  if (ctx.as === 'service' && !('platform' in ctx) && !UUID.test(ctx.tenantId)) throw new Error('db: service context needs an institution id')
}

function contextStatement(sql: postgres.Sql, ctx: DbContext): Pending {
  if (ctx.as === 'user') {
    const claims = JSON.stringify({ sub: ctx.userId, role: 'authenticated' })
    return sql`select set_config('request.jwt.claims', ${claims}, true), set_config('app.tenant_id', '', true), set_config('app.scope', '', true), set_config('role', 'app_user', true)`
  }
  if (ctx.as === 'service') {
    const platform = 'platform' in ctx
    // never a user identity here: user policies must not apply to the service role
    return sql`select set_config('request.jwt.claims', '', true), set_config('app.tenant_id', ${platform ? '' : ctx.tenantId}, true), set_config('app.scope', ${platform ? 'platform' : ''}, true), set_config('role', 'app_service', true)`
  }
  return sql`select set_config('request.jwt.claims', '', true), set_config('app.tenant_id', '', true), set_config('app.scope', '', true), set_config('role', 'app_system', true)`
}

/**
 * Runs independent statements as one unit of work and returns each one's rows,
 * in order. Use it for reads and for writes that do not need each other's
 * results. Any failure rolls the whole unit back and is rethrown.
 */
export async function run(ctx: DbContext, build: (sql: postgres.Sql) => Pending[]): Promise<Row[][]> {
  validate(ctx)
  const { conn, done } = await exclusive()
  try {
    // begin and context first: nothing may be built before them on this connection
    const head = [conn`begin`, contextStatement(conn, ctx)]
    let queries: Pending[]
    try {
      queries = build(conn)
    } catch (e) {
      // send what was built, then undo it, so the connection is clean for the next unit
      await Promise.all(head.map(q => q.catch(() => {})))
      await conn`rollback`.catch(() => {})
      throw e
    }
    const all = [...head, ...queries, conn`commit`]
    dbStats.units++
    dbStats.statements += queries.length
    // attaching the handlers in this order is what sends the statements, in this order
    const results = await Promise.all(all.map(q => q.catch((e: unknown) => (e instanceof Error ? e : new Error(String(e))))))
    const failed = results.find((r): r is Error => r instanceof Error)
    if (failed) {
      await conn`rollback`.catch(() => {})
      throw failed
    }
    return results.slice(2, 2 + queries.length) as unknown as Row[][]
  } finally {
    await done()
  }
}

/**
 * A unit of work whose steps depend on each other (read, decide, write). Each
 * awaited statement is its own round trip, so prefer run() when the steps are
 * independent.
 */
export async function transaction<T>(ctx: DbContext, work: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  validate(ctx)
  // begin() takes its own connection for the whole transaction (on Node it
  // reserves one from the pool), so no extra reservation is needed here
  const sql = onWorkers ? await workerClient() : await pool()
  try {
    dbStats.units++
    return (await sql.begin(async tx => {
      // TransactionSql has the same tagged-template call shape as Sql
      await contextStatement(tx as unknown as postgres.Sql, ctx)
      return work(tx)
    })) as T
  } finally {
    if (onWorkers) await sql.end({ timeout: 1 })
  }
}

export class NotFoundError extends Error {
  constructor() { super('no row found'); this.name = 'NotFoundError' }
}

/** Exactly one row (like PostgREST .single()); throws NotFoundError when there is none. */
export function one<T = Row>(rows: Row[]): T {
  if (rows.length !== 1) throw rows.length === 0 ? new NotFoundError() : new Error(`expected one row, got ${rows.length}`)
  return rows[0] as unknown as T
}

/** At most one row (like PostgREST .maybeSingle()). */
export function maybeOne<T = Row>(rows: Row[]): T | null {
  if (rows.length > 1) throw new Error(`expected at most one row, got ${rows.length}`)
  return (rows[0] as unknown as T) ?? null
}
