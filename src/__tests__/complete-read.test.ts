import { describe, it, expect } from 'vitest'
import { pgMock, uid, type Call, type World } from './complete-read-fixture'
import {
  inBatches, readAllByKeyset, readAllPages, rowsOf, IncompleteReadError, ID_BATCH, READ_PAGE, FIRST_ID,
} from '@/lib/data/complete-read'

/**
 * B / C1 — the complete-read helpers: past the API's 1000-row cap nothing is cut,
 * past its URL limit (~640 ids in `.in()`) nothing is refused, and a failed or
 * short read throws instead of returning part of a set.
 */

const things = (count: number): World => ({
  things: Array.from({ length: count }, (_, k) => ({ id: uid(k), k })),
})

describe('readAllByKeyset', () => {
  const read = (db: ReturnType<typeof pgMock>) => readAllByKeyset<{ id: string; k: number }>('things',
    after => db.from('things').select('id, k').gt('id', after).order('id').limit(READ_PAGE) as never,
    () => db.from('things').select('id', { count: 'exact', head: true }) as never)

  it('2 500 rows past the 1000-row cap: every row once, in id order', async () => {
    const rows = await read(pgMock(things(2500)))
    expect(rows.map(r => r.k)).toEqual(Array.from({ length: 2500 }, (_, k) => k))
  })

  it('an empty set: [] with no error', async () => {
    expect(await read(pgMock(things(0)))).toEqual([])
  })

  it('a failed first page, middle page or count throws', async () => {
    await expect(read(pgMock(things(2500), { fail: c => !c.head && c.filters.some(f => f[0] === 'gt' && f[2] === FIRST_ID) }))).rejects.toBeInstanceOf(IncompleteReadError)
    await expect(read(pgMock(things(2500), { fail: c => !c.head && c.filters.some(f => f[0] === 'gt' && f[2] !== FIRST_ID) }))).rejects.toBeInstanceOf(IncompleteReadError)
    await expect(read(pgMock(things(2500), { fail: c => c.head }))).rejects.toThrow(/count failed/)
  })

  it('a lower max_rows (pages cut at 500) throws instead of ending early', async () => {
    await expect(read(pgMock(things(2500), { cap: 500 }))).rejects.toThrow(/500 rows, expected 2500/)
  })
})

describe('readAllPages', () => {
  const read = (db: ReturnType<typeof pgMock>) => readAllPages<{ id: string; k: number }>('things',
    (from, to, withCount) => db.from('things').select('id, k', withCount ? { count: 'exact' } : undefined).order('id').range(from, to) as never)

  it('2 500 rows: exact pages, every row once', async () => {
    const calls: Call[] = []
    const rows = await read(pgMock(things(2500), { calls }))
    expect(rows).toHaveLength(2500)
    expect(calls.map(c => c.range)).toEqual([[0, 999], [1000, 1999], [2000, 2999]])
  })

  it('an empty set is one request and []', async () => {
    const calls: Call[] = []
    expect(await read(pgMock(things(0), { calls }))).toEqual([])
    expect(calls).toHaveLength(1)
  })

  it('a failed page, a missing count, or a cut page throws', async () => {
    await expect(read(pgMock(things(2500), { fail: (_c, n) => n === 1 }))).rejects.toBeInstanceOf(IncompleteReadError)
    await expect(readAllPages('things', () => Promise.resolve({ data: [], count: null, error: null }))).rejects.toThrow(/no count/)
    await expect(read(pgMock(things(2500), { cap: 500 }))).rejects.toThrow(/expected 1000 of 2500/)
  })
})

describe('inBatches', () => {
  const ids = (count: number) => Array.from({ length: count }, (_, k) => uid(k))
  const names = (db: ReturnType<typeof pgMock>, list: string[]) =>
    inBatches(list, async batch => rowsOf(await (db.from('things').select('id, k').in('id', batch) as unknown as Promise<{ data: { id: string }[] | null; error: null }>), 'things'))

  it('640+ ids: never one long request (the live API refuses it) — every id resolved in batches of ≤ 100', async () => {
    const calls: Call[] = []
    const db = pgMock(things(700), { calls })
    // The old single request is refused by the API's URL limit:
    const single = await (db.from('things').select('id').in('id', ids(700)) as unknown as Promise<{ error: unknown }>)
    expect(single.error).toBeTruthy()
    calls.length = 0
    const rows = await names(db, ids(700))
    expect(rows).toHaveLength(700)
    expect(calls).toHaveLength(7)
    expect(Math.max(...calls.map(c => c.inIds))).toBeLessThanOrEqual(ID_BATCH)
  })

  it('an empty list sends no request', async () => {
    const calls: Call[] = []
    expect(await names(pgMock(things(5), { calls }), [])).toEqual([])
    expect(calls).toHaveLength(0)
  })

  it('one failed batch throws: no partial list', async () => {
    await expect(names(pgMock(things(700), { fail: (_c, n) => n === 3 }), ids(700))).rejects.toBeInstanceOf(IncompleteReadError)
  })
})
