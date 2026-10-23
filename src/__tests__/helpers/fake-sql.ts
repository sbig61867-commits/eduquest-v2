// A stand-in for src/lib/db/sql.ts in route tests (step 9). The route builds
// its statements with the real tagged-template calls; each one becomes
// { text, values } — nested fragments (e.g. onRosterSql) are inlined — and is
// answered by the test's `answer` function. Returning an Error (or throwing)
// fails the whole unit, as a failed statement does on the real layer.
//
// Usage inside a test file (vi.mock factories are hoisted, so import lazily):
//   const db = vi.hoisted(() => ({ answer: (_q: SqlCall) => [] as unknown[] | Error }))
//   vi.mock('@/lib/db/sql', async () => (await import('./helpers/fake-sql')).fakeSqlModule(q => db.answer(q)))

export type SqlCall = { text: string; values: unknown[]; ctx: { as: string; userId?: string; tenantId?: string; platform?: true } }

type Fragment = { __fragment: true; text: string; values: unknown[] }

function tag(strings: TemplateStringsArray, ...values: unknown[]): Fragment {
  let text = strings[0]
  const out: unknown[] = []
  values.forEach((v, i) => {
    if (v && typeof v === 'object' && (v as Fragment).__fragment) {
      text += (v as Fragment).text
      out.push(...(v as Fragment).values)
    } else {
      text += '$'
      out.push(v)
    }
    text += strings[i + 1]
  })
  return { __fragment: true, text: text.replace(/\s+/g, ' ').trim(), values: out }
}

// sql.json(value) passes a JSON parameter on the real layer; here it is the value itself.
const sqlTag = Object.assign(tag, { json: (v: unknown) => v })

export function fakeSqlModule(answer: (q: SqlCall) => unknown[] | Error) {
  const calls: SqlCall[] = []
  const unit = async (ctx: SqlCall['ctx'], statements: Fragment[]) => {
    const results: unknown[][] = []
    for (const s of statements) {
      const q = { text: s.text, values: s.values, ctx }
      calls.push(q)
      const r = answer(q)
      if (r instanceof Error) throw r
      results.push(r)
    }
    return results
  }
  return {
    calls,
    run: (ctx: SqlCall['ctx'], build: (sql: typeof sqlTag) => Fragment[]) => unit(ctx, build(sqlTag)),
    transaction: async <T>(ctx: SqlCall['ctx'], work: (tx: (s: TemplateStringsArray, ...v: unknown[]) => Promise<unknown[]>) => Promise<T>) =>
      work(async (s, ...v) => (await unit(ctx, [tag(s, ...v)]))[0]),
    maybeOne: (rows: unknown[]) => {
      if (rows.length > 1) throw new Error(`expected at most one row, got ${rows.length}`)
      return rows[0] ?? null
    },
    one: (rows: unknown[]) => {
      if (rows.length !== 1) throw new Error(`expected one row, got ${rows.length}`)
      return rows[0]
    },
    onWorkers: false,
    dbStats: { units: 0, statements: 0 },
  }
}

/** A Postgres-style error, as the real layer throws it (e.g. a RAISE EXCEPTION). */
export function pgError(message: string, code = 'P0001'): Error {
  return Object.assign(new Error(message), { code })
}
