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

export const onWorkers = typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers'

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

// One connection per unit of work, used by that unit only, start to end.
//  - Workers: a fresh one-connection client per unit (Workers may not share a
//    socket between requests; the pool lives in Hyperdrive).
//  - Node (next dev, tests): up to NODE_POOL_SIZE one-connection clients, each
//    lent to one unit at a time. postgres.js reserve() is not used: under
//    contention it left 71 of 72 units waiting forever (measured, 3.4.5).
// fetch_types stays off: no extra round trip when a connection opens.
// A unit that takes longer than UNIT_TIMEOUT_MS fails and its connection is
// closed (Postgres rolls the open transaction back); the next unit gets a new
// one. Ending a one-connection client mid-query rejects the pending
// statements cleanly (measured).
// DB_UNIT_TIMEOUT_MS overrides it for the trial tests run from a PC far from
// the database (each statement crosses the link; a many-statement report unit
// can pass 20 s there, while the same unit takes milliseconds next to it).
const UNIT_TIMEOUT_MS = Number(process.env.DB_UNIT_TIMEOUT_MS) > 0 ? Number(process.env.DB_UNIT_TIMEOUT_MS) : 20_000
const NODE_POOL_SIZE = 10

export class DbTimeoutError extends Error {
  constructor() { super(`db: unit of work took longer than ${UNIT_TIMEOUT_MS} ms`); this.name = 'DbTimeoutError' }
}

const newClient = async (): Promise<Sql> =>
  postgres(await connectionString(), { max: 1, prepare: true, fetch_types: false, types: TYPES, onnotice: () => {} })

const idle: Sql[] = []
const waiting: ((c: Sql) => void)[] = []
let open = 0

function giveBack(c: Sql | null): void {
  const next = waiting.shift()
  if (!next) { if (c) idle.push(c); return }
  if (c) { next(c); return }
  // the broken connection was dropped: open a replacement for the waiter
  open++
  newClient().then(next, () => { open--; waiting.unshift(next) })
}

async function borrow(): Promise<{ conn: Sql; release: (broken: boolean) => Promise<void> }> {
  if (onWorkers) {
    const conn = await newClient()
    return { conn, release: broken => conn.end({ timeout: broken ? 0 : 1 }) }
  }
  let conn = idle.pop()
  if (!conn && open < NODE_POOL_SIZE) {
    open++
    try { conn = await newClient() } catch (e) { open--; throw e }
  }
  conn ??= await new Promise<Sql>(resolve => waiting.push(resolve))
  const lent = conn
  return {
    conn: lent,
    release: async broken => {
      if (broken) { open--; await lent.end({ timeout: 0 }).catch(() => {}); giveBack(null) }
      else giveBack(lent)
    },
  }
}

async function withinLimit<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const limit = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new DbTimeoutError()), UNIT_TIMEOUT_MS) })
  try { return await Promise.race([work, limit]) } finally { clearTimeout(timer) }
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
  const { conn, release } = await borrow()
  let broken = false
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
    const results = await withinLimit(Promise.all(all.map(q => q.catch((e: unknown) => (e instanceof Error ? e : new Error(String(e)))))))
    const failed = results.find((r): r is Error => r instanceof Error)
    if (failed) {
      await withinLimit(conn`rollback`).catch(() => { broken = true })
      throw failed
    }
    return results.slice(2, 2 + queries.length) as unknown as Row[][]
  } catch (e) {
    if (e instanceof DbTimeoutError) broken = true
    throw e
  } finally {
    await release(broken)
  }
}

/**
 * A unit of work whose steps depend on each other (read, decide, write). Each
 * awaited statement is its own round trip, so prefer run() when the steps are
 * independent.
 */
export async function transaction<T>(ctx: DbContext, work: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  validate(ctx)
  const { conn, release } = await borrow()
  let broken = false
  try {
    dbStats.units++
    return (await withinLimit(conn.begin(async tx => {
      // TransactionSql has the same tagged-template call shape as Sql
      await contextStatement(tx as unknown as postgres.Sql, ctx)
      return work(tx)
    }))) as T
  } catch (e) {
    if (e instanceof DbTimeoutError) broken = true
    throw e
  } finally {
    await release(broken)
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
