// ── Complete reads (B / C1) ─────────────────────────────────────────────────
//
// The API answers at most `max_rows` (1000 on this project) rows per request and
// says nothing when it cuts a result short, and it refuses a request URL longer
// than ~25 KB (≈ 640 uuids in one `.in()` list) with a 400 that callers used to
// treat as "no rows". The helpers here read a set completely or fail loudly:
//
//   readAllPages()   counted, ordered pages (for tables without an `id` key);
//   readAllByKeyset() keyset pages on `id` + a head-only count of the same read;
//   inBatches()      an id list split into short `.in()` requests.
//
// A failed read, a missing count, or rows that do not add up to the count throw
// IncompleteReadError — never a partial result. Independent of the report
// helpers in ./reports.ts (D1) on purpose. No server-only imports: the browser
// uses inBatches() too.

/** The API's max_rows: a larger page would be cut to this anyway. */
export const READ_PAGE = 1000
/** Ids per `.in()` request: ~4 KB of URL, far below the ~25 KB the API accepts. */
export const ID_BATCH = 100
/** Requests in flight at once for the pages / batches after the first. */
const CONCURRENCY = 4

export interface ReadFailure { message: string; code?: string }
export interface ReadResult<T = unknown> { data: T[] | null; count?: number | null; error?: ReadFailure | null }
type Read<T> = PromiseLike<ReadResult<T>>

/** A read failed or came back incomplete; nothing partial is returned. */
export class IncompleteReadError extends Error {
  constructor(message: string, readonly detail?: ReadFailure | null) {
    super(message)
    this.name = 'IncompleteReadError'
  }
}

/** The rows of one plain read; a failed read throws instead of reading as empty. */
export function rowsOf<T>(r: ReadResult<T>, what: string): T[] {
  if (r.error) throw new IncompleteReadError(`${what}: read failed`, r.error)
  return r.data ?? []
}

function countOf(r: ReadResult, what: string): number {
  if (r.error) throw new IncompleteReadError(`${what}: count failed`, r.error)
  if (r.count == null) throw new IncompleteReadError(`${what}: no count returned`)
  return r.count
}

/**
 * Every row of a read in counted pages. `page(from, to, withCount)` must order
 * by a unique key; the first page carries the exact count and every page must
 * hold exactly min(READ_PAGE, count − from) rows.
 */
export async function readAllPages<T>(what: string, page: (from: number, to: number, withCount: boolean) => Read<T>): Promise<T[]> {
  const first = await page(0, READ_PAGE - 1, true)
  const total = countOf(first, what)
  const take = (r: ReadResult<T>, from: number): T[] => {
    const rows = rowsOf(r, `${what} (page at ${from})`)
    const expected = Math.min(READ_PAGE, Math.max(total - from, 0))
    if (rows.length !== expected) throw new IncompleteReadError(`${what}: page at ${from} has ${rows.length} rows, expected ${expected} of ${total}`)
    return rows
  }
  const rows = [...take(first, 0)]
  const starts: number[] = []
  for (let from = READ_PAGE; from < total; from += READ_PAGE) starts.push(from)
  for (let i = 0; i < starts.length; i += CONCURRENCY) {
    const slice = starts.slice(i, i + CONCURRENCY)
    const pages = await Promise.all(slice.map(from => page(from, from + READ_PAGE - 1, false)))
    pages.forEach((r, k) => rows.push(...take(r, slice[k])))
  }
  return rows
}

/** Every uuid sorts after the nil uuid, so `id > FIRST_ID` is the first keyset page. */
export const FIRST_ID = '00000000-0000-0000-0000-000000000000'

/**
 * Every row of a read by keyset on `id`: `page(afterId)` filters `id > afterId`,
 * orders by id and limits to READ_PAGE; `count()` is the same read as a
 * head-only exact count, run alongside the first page. The rows read must equal
 * the count (a short page from a lower max_rows, or rows changing mid-read, fail).
 */
export async function readAllByKeyset<T extends { id: string }>(
  what: string, page: (afterId: string) => Read<T>, count: () => Read<unknown>,
): Promise<T[]> {
  const [firstPage, counted] = await Promise.all([page(FIRST_ID), count()])
  const expected = countOf(counted, what)
  const rows: T[] = []
  let res = firstPage
  for (;;) {
    const batch = rowsOf(res, `${what} (after ${rows.length} rows)`)
    rows.push(...batch)
    if (batch.length < READ_PAGE) break
    res = await page(batch[batch.length - 1].id)
  }
  if (rows.length !== expected) throw new IncompleteReadError(`${what}: ${rows.length} rows, expected ${expected}`)
  return rows
}

/**
 * `read(batch)` for every ID_BATCH ids (a few at a time), results concatenated in
 * batch order. An empty list sends no request; any failed batch throws (the
 * other batches' rows are discarded, never returned on their own).
 */
export async function inBatches<T>(ids: readonly string[], read: (batch: string[]) => PromiseLike<T[]>): Promise<T[]> {
  const batches: string[][] = []
  for (let i = 0; i < ids.length; i += ID_BATCH) batches.push(ids.slice(i, i + ID_BATCH))
  const out: T[] = []
  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    const results = await Promise.all(batches.slice(i, i + CONCURRENCY).map(b => read(b)))
    for (const rows of results) out.push(...rows)
  }
  return out
}
