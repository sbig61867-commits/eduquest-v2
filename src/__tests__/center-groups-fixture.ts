/**
 * PR-2 (/center/groups) test client: the `groups` reads the page makes, with the
 * live API's behaviour that matters here — a response carries at most `cap`
 * rows (max_rows, 1000), `order(col, { ascending: false })` sorts descending,
 * a counted page that starts past the end is refused with PGRST103 (416), and
 * `fail(call, n)` makes the n-th request fail as PostgREST does. Supports
 * select (count / head), eq, order, range. Separate from PR-1's
 * complete-read-fixture.ts on purpose.
 */

type Row = Record<string, unknown>
export type GroupsWorld = { groups: Row[] }

export interface GroupsCall {
  columns: string; head: boolean; count: boolean
  filters: unknown[][]; range: [number, number] | null
}

export function groupsMock(world: GroupsWorld, opts: {
  cap?: number; calls?: GroupsCall[]; fail?: (call: GroupsCall, n: number) => boolean
} = {}) {
  const cap = opts.cap ?? 1000
  let n = 0
  return {
    from: (table: string) => {
      if (table !== 'groups') throw new Error(`groupsMock: unexpected table ${table}`)
      return {
        select: (columns: string, selectOpts?: { count?: string; head?: boolean }) => {
          const call: GroupsCall = { columns, head: !!selectOpts?.head, count: selectOpts?.count === 'exact', filters: [], range: null }
          opts.calls?.push(call)
          const index = n++
          const preds: ((r: Row) => boolean)[] = []
          const sorts: { c: string; desc: boolean }[] = []
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const chain: any = {}
          chain.eq = (c: string, v: unknown) => { call.filters.push(['eq', c, v]); preds.push(r => r[c] === v); return chain }
          chain.order = (c: string, o?: { ascending?: boolean }) => {
            call.filters.push(['order', c, o ?? null]); sorts.push({ c, desc: o?.ascending === false }); return chain
          }
          chain.range = (from: number, to: number) => { call.range = [from, to]; return chain }
          const run = () => {
            if (opts.fail?.(call, index)) return { data: null, count: null, error: { code: 'PGRST000', message: 'injected failure' } }
            const rows = world.groups.filter(r => preds.every(p => p(r)))
            const cmp = (a: unknown, b: unknown) => (a == null ? (b == null ? 0 : 1) : b == null ? -1 : a < b ? -1 : a > b ? 1 : 0)
            rows.sort((a, b) => { for (const { c, desc } of sorts) { const d = cmp(a[c], b[c]); if (d) return desc ? -d : d } return 0 })
            if (call.head) return { data: null, count: rows.length, error: null }
            if (call.range && call.count && call.range[0] > 0 && call.range[0] >= rows.length) {
              return { data: null, count: null, error: { code: 'PGRST103', message: 'Requested range not satisfiable' } }
            }
            const out = (call.range ? rows.slice(call.range[0], call.range[1] + 1) : rows).slice(0, cap)
            return { data: out, count: call.count ? rows.length : null, error: null }
          }
          chain.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve().then(run).then(res, rej)
          return chain
        },
      }
    },
  }
}

/** Sortable uuid-like ids: `gid(7)` → '00000000-0000-4000-8000-000000000007'. */
export const gid = (k: number) => `00000000-0000-4000-8000-${String(k).padStart(12, '0')}`
