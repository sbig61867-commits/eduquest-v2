/**
 * A PostgREST-like client over in-memory tables, with the two limits B / C1 are
 * about: a response carries at most `cap` rows (max_rows, 1000 on the project)
 * and a request whose `.in()` lists hold more than `urlIds` ids together is
 * refused with a 400, as the live API refuses a URL past ~25 KB (≈ 640 uuids,
 * measured 2026-10-04). Supports select (count / head), eq, neq, in, is, gt,
 * or (also on a referenced table), match, order, range, limit, single /
 * maybeSingle, filters on an embedded relation (`rel.col`, through `relations`),
 * and `fail(call)` to make a given request fail like PostgREST does.
 */

type Row = Record<string, unknown>
export type World = Record<string, Row[]>
export type Relations = Record<string, Record<string, (world: World, row: Row) => Row | undefined>>

export interface Call {
  table: string; columns: string; head: boolean; count: boolean
  filters: unknown[][]; inIds: number; range: [number, number] | null; limit: number | null
}

/** A query builder: any chain of the supported calls, awaited for { data, count, error }. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Chain = any

const FAILURE = { code: 'PGRST000', message: 'injected failure' }

export function pgMock(world: World, opts: {
  relations?: Relations; cap?: number; urlIds?: number; calls?: Call[]
  fail?: (call: Call, n: number) => false | { code: string; message: string } | true
} = {}) {
  const cap = opts.cap ?? 1000
  const urlIds = opts.urlIds ?? 640
  let n = 0
  return {
    from: (table: string) => ({
      select: (columns = '*', selectOpts?: { count?: string; head?: boolean }): Chain => {
        const call: Call = { table, columns, head: !!selectOpts?.head, count: selectOpts?.count === 'exact', filters: [], inIds: 0, range: null, limit: null }
        opts.calls?.push(call)
        const index = n++
        const preds: ((r: Row) => boolean)[] = []
        const sorts: string[] = []
        let single: false | 'single' | 'maybe' = false
        const value = (r: Row, col: string) => {
          if (!col.includes('.')) return r[col]
          const [rel, field] = col.split('.')
          const parent = opts.relations?.[table]?.[rel]?.(world, r)
          return parent ? parent[field] : Symbol.for('no-parent')
        }
        /** `a.eq.x,b.is.null,…` → a predicate on `target(row)`. */
        const orOf = (expr: string, target: (r: Row) => Row | undefined) => {
          const terms = expr.split(',').map(t => t.split('.'))
          return (r: Row) => {
            const row = target(r)
            if (!row) return false
            return terms.some(([col, op, ...rest]) => {
              const v = rest.join('.')
              if (op === 'eq') return String(row[col]) === v
              if (op === 'is' && v === 'null') return row[col] == null
              if (op === 'not' && rest[0] === 'is' && rest[1] === 'null') return row[col] != null
              throw new Error(`or: unsupported ${op}`)
            })
          }
        }
        const chain: Record<string, unknown> = {}
        const add = (f: unknown[], p: (r: Row) => boolean) => { call.filters.push(f); preds.push(p); return chain }
        chain.eq = (c: string, v: unknown) => add(['eq', c, v], r => value(r, c) === v)
        chain.neq = (c: string, v: unknown) => add(['neq', c, v], r => value(r, c) !== v)
        chain.in = (c: string, v: unknown[]) => { call.inIds += v.length; return add(['in', c, v], r => v.includes(value(r, c))) }
        chain.is = (c: string, v: unknown) => add(['is', c, v], r => { const x = value(r, c); return v === null ? x === null || x === undefined : x === v })
        chain.gt = (c: string, v: string) => add(['gt', c, v], r => String(value(r, c)) > v)
        chain.match = (o: Record<string, unknown>) => { for (const [c, v] of Object.entries(o)) (chain.eq as (c: string, v: unknown) => unknown)(c, v); return chain }
        chain.or = (expr: string, o?: { referencedTable?: string }) => {
          const rel = o?.referencedTable
          return add(['or', expr, rel ?? null], orOf(expr, r => (rel ? opts.relations?.[table]?.[rel]?.(world, r) : r)))
        }
        chain.order = (c: string, o?: unknown) => { call.filters.push(['order', c, o ?? null]); sorts.push(c); return chain }
        chain.range = (from: number, to: number) => { call.range = [from, to]; return chain }
        chain.limit = (k: number) => { call.limit = k; return chain }
        chain.single = () => { single = 'single'; return chain }
        chain.maybeSingle = () => { single = 'maybe'; return chain }
        const run = () => {
          const injected = opts.fail?.(call, index)
          if (injected) return { data: null, count: null, error: injected === true ? FAILURE : injected }
          if (call.inIds > urlIds) return { data: null, count: null, error: { code: '400', message: 'Bad Request (URL too long)' } }
          const rows = (world[table] ?? []).filter(r => preds.every(p => p(r)))
          const cmp = (a: unknown, b: unknown) => (a == null ? (b == null ? 0 : 1) : b == null ? -1 : a < b ? -1 : a > b ? 1 : 0)
          if (sorts.length) rows.sort((a, b) => { for (const c of sorts) { const d = cmp(a[c], b[c]); if (d) return d } return 0 })
          if (call.head) return { data: null, count: rows.length, error: null }
          if (single === 'single' && !rows.length) return { data: null, error: { code: 'PGRST116', message: 'no rows' } }
          if (single) return { data: rows[0] ?? null, error: null }
          let out = call.range ? rows.slice(call.range[0], call.range[1] + 1) : rows
          if (call.limit != null) out = out.slice(0, call.limit)
          out = out.slice(0, cap)
          return { data: out, count: call.count ? rows.length : null, error: null }
        }
        chain.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve().then(run).then(res, rej)
        return chain
      },
    }),
  }
}

/** Sortable uuid-like ids: `id(7, 'm')` → '0000000m-…-000000000007'. */
export const uid = (k: number, tag = 'a') => `0000000${tag}-0000-4000-8000-${String(k).padStart(12, '0')}`
