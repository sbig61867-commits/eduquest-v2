/**
 * Shared fixture for the report tests (P-07): a deterministic institution and a
 * mock Supabase client that behaves like PostgREST where the reports depend on
 * it — eq / in / is / gt filters (also on an embedded relation, `exams.teacher_id`),
 * `order` (ascending, nulls last), `range` / `limit`, `count: 'exact'` / `head`,
 * `single` / `maybeSingle`, and the
 * project's API cap: a response never carries more than `MAX_ROWS` rows.
 *
 * reports-golden.json holds what the pre-P-07 builders produced from this
 * world with no cap (every row read), so it is the reference for "the same
 * report, read correctly".
 */

export const MAX_ROWS = 1000
export const FIXED_NOW = new Date('2026-10-01T12:00:00Z')

const DAY = 86_400_000
const iso = (ms: number) => new Date(ms).toISOString()
const NOW = FIXED_NOW.getTime()

type Row = Record<string, unknown>
export interface World { [table: string]: Row[] }

/** Two live groups of 42 (one student in both), a deleted group, deleted and unpublished exams, a survey. */
export function buildWorld(): World {
  const tenants = [{ id: 'tn', name: 'Uni' }]
  const teachers = ['t0', 't1'].map(id => ({ id, full_name: `Teacher ${id}`, email: `${id}@x.test`, role: 'teacher', tenant_id: 'tn', created_at: iso(NOW - 400 * DAY), tenants: { name: 'Uni' } }))
  const groupDefs = [
    { id: 'g0', name: 'Group 0', teacher_id: 't0', deleted_at: null },
    { id: 'g1', name: 'Group 1', teacher_id: 't1', deleted_at: null },
    { id: 'g2', name: 'Group 2 (deleted)', teacher_id: 't0', deleted_at: iso(NOW - 10 * DAY) },
  ]
  const teacherName = (t: string) => `Teacher ${t}`
  const groups = groupDefs.map(g => ({ ...g, tenant_id: 'tn', created_at: iso(NOW - 120 * DAY), users: { full_name: teacherName(g.teacher_id) }, tenants: { name: 'Uni' } }))

  const students: Row[] = []
  const memberships: Row[] = []
  const member = (gi: number, sid: string, joinedDaysAgo: number) => {
    const g = groupDefs[gi]
    memberships.push({
      group_id: g.id, student_id: sid, joined_at: iso(NOW - joinedDaysAgo * DAY),
      users: { full_name: `Student ${sid}`, email: `${sid}@x.test` },
      groups: { id: g.id, name: g.name, deleted_at: g.deleted_at, users: { full_name: teacherName(g.teacher_id) }, tenant_id: 'tn', teacher_id: g.teacher_id },
    })
  }
  for (let i = 0; i < 84; i++) {
    const sid = `s${String(i).padStart(2, '0')}`
    students.push({ id: sid, full_name: `Student ${sid}`, email: `${sid}@x.test`, role: 'student', tenant_id: 'tn', created_at: iso(NOW - 200 * DAY), tenants: { name: 'Uni' } })
    member(i < 42 ? 0 : 1, sid, 150 - i)
  }
  member(1, 's00', 30)   // s00 is in both live groups
  member(2, 's01', 40)   // s01 is also in the deleted group

  const exams: Row[] = []
  const questionsFor = (k: number) => Array.from({ length: 5 }, (_, q) => ({ id: `q${q}`, type: 'mcq', text: `Q${q}`, options: ['a', 'b'], correct_answer: 'a', points: 2 + ((k + q) % 3) }))
  const examMax = (k: number) => questionsFor(k).reduce((s, q) => s + q.points, 0)
  for (const g of groupDefs) {
    const count = g.id === 'g2' ? 2 : 30
    for (let k = 0; k < count; k++) {
      exams.push({
        id: `${g.id}-e${String(k).padStart(2, '0')}`, title: `${g.id} exam ${k}`, type: k % 4 === 0 ? 'homework' : 'exam',
        group_id: g.id, teacher_id: g.teacher_id, tenant_id: 'tn', questions: questionsFor(k),
        created_at: iso(NOW - (118 - k * 4) * DAY), proctoring_enabled: k % 2 === 0, is_published: true, deleted_at: null, _max: examMax(k),
      })
    }
  }
  // Filtered out by every report: a deleted exam; and an unpublished one (only the student report filters on it).
  exams.push({ id: 'g0-deleted', title: 'deleted', type: 'exam', group_id: 'g0', teacher_id: 't0', tenant_id: 'tn', questions: questionsFor(1),
    created_at: iso(NOW - 50 * DAY), proctoring_enabled: false, is_published: true, deleted_at: iso(NOW - 5 * DAY), _max: examMax(1) })
  exams.push({ id: 'g0-draft', title: 'draft', type: 'exam', group_id: 'g0', teacher_id: 't0', tenant_id: 'tn', questions: questionsFor(2),
    created_at: iso(NOW - 3 * DAY), proctoring_enabled: true, is_published: false, deleted_at: null, _max: examMax(2) })

  const subs: Row[] = []
  let n = 0
  for (const e of exams) {
    if (e.id === 'g0-draft') continue
    const k = Number(String(e.id).split('-e')[1] ?? 7)
    const roster = memberships.filter(m => m.group_id === e.group_id)
    roster.forEach((m, si) => {
      if ((si + k) % 7 === 0) return                       // not submitted
      const max = e._max as number
      const awaiting = (si + k) % 11 === 0
      subs.push({
        id: `sub${String(n++).padStart(5, '0')}`, exam_id: e.id, student_id: m.student_id, tenant_id: 'tn',
        score: awaiting ? null : (si * 3 + k * 5) % (max + 1), max_score: max,
        is_graded: (si + k) % 13 !== 0, is_flagged: (si + k) % 17 === 0,
        submitted_at: iso(new Date(e.created_at as string).getTime() + (si + 1) * 60_000),
      })
    })
  }

  const lessons: Row[] = [
    { id: 'l1', tenant_id: 'tn', teacher_id: 't0', group_id: 'g0', is_published: true, deleted_at: null },
    { id: 'l2', tenant_id: 'tn', teacher_id: 't0', group_id: 'g0', is_published: false, deleted_at: null },
    { id: 'l3', tenant_id: 'tn', teacher_id: 't1', group_id: 'g1', is_published: true, deleted_at: null },
    { id: 'l4', tenant_id: 'tn', teacher_id: 't0', group_id: 'g0', is_published: true, deleted_at: iso(NOW - DAY) },
  ]
  const surveys = [{ id: 'sv0', group_id: 'g0', title: 'Pilot survey' }]
  const survey_responses = Array.from({ length: 12 }, (_, i) => ({
    id: `r${String(i).padStart(2, '0')}`, survey_id: 'sv0', ease_rating: 1 + (i % 5), prefer_platform: i % 3 !== 0, recommend: i % 4 !== 0,
    best_feature: i % 2 === 0 ? `feature ${i}` : null, problem_faced: i % 5 === 0 ? `problem ${i}` : null, comment: i % 3 === 0 ? `comment ${i}` : null,
  }))

  return { tenants, users: [...teachers, ...students], groups, group_students: memberships, exams, exam_submissions: subs, lessons, surveys, survey_responses }
}

// Embedded-relation lookups the reports filter through (`<relation>.<column>`).
const RELATIONS: Record<string, Record<string, (w: World, row: Row) => Row | undefined>> = {
  group_students: { groups: (w, r) => w.groups.find(g => g.id === r.group_id) },
  exam_submissions: { exams: (w, r) => w.exams.find(e => e.id === r.exam_id) },
  survey_responses: { surveys: (w, r) => w.surveys.find(s => s.id === r.survey_id) },
}

export interface MockCall { table: string; columns: string; filters: unknown[][]; range: [number, number] | null; limit: number | null; head: boolean; count: boolean }

/** A Supabase-like client over `world`. With `cap`, a response carries at most MAX_ROWS rows, as the live API does. */
export function mockAdmin(world: World, opts: { cap?: boolean; calls?: MockCall[]; gate?: (call: MockCall) => Promise<void> } = {}) {
  return {
    from: (table: string) => ({
      select: (columns: string, selectOpts?: { count?: string; head?: boolean }) => {
        const call: MockCall = { table, columns, filters: [], range: null, limit: null, head: !!selectOpts?.head, count: selectOpts?.count === 'exact' }
        opts.calls?.push(call)
        const preds: ((r: Row) => boolean)[] = []
        const sorts: string[] = []
        let single = false
        const value = (r: Row, col: string) => {
          if (!col.includes('.')) return r[col]
          const [rel, field] = col.split('.')
          const parent = RELATIONS[table]?.[rel]?.(world, r)
          return parent ? parent[field] : Symbol.for('no-parent')   // an inner join drops the row
        }
        const chain: Record<string, unknown> = {}
        chain.eq = (c: string, v: unknown) => { call.filters.push(['eq', c, v]); preds.push(r => value(r, c) === v); return chain }
        chain.in = (c: string, v: unknown[]) => { call.filters.push(['in', c, v]); preds.push(r => v.includes(value(r, c))); return chain }
        chain.is = (c: string, v: unknown) => { call.filters.push(['is', c, v]); preds.push(r => { const x = value(r, c); return v === null ? x === null || x === undefined : x === v }); return chain }
        chain.gt = (c: string, v: string) => { call.filters.push(['gt', c, v]); preds.push(r => String(value(r, c)) > v); return chain }
        chain.order = (c: string, o?: unknown) => { call.filters.push(['order', c, o ?? null]); sorts.push(c); return chain }
        chain.range = (from: number, to: number) => { call.range = [from, to]; return chain }
        chain.limit = (n: number) => { call.limit = n; return chain }
        chain.single = () => { single = true; return chain }
        chain.maybeSingle = () => { single = true; return chain }
        const run = () => {
          const rows = (world[table] ?? []).filter(r => preds.every(p => p(r)))
          // ORDER BY as the database applies it: ascending, nulls last, stable.
          const cmp = (a: unknown, b: unknown) => (a == null ? (b == null ? 0 : 1) : b == null ? -1 : a < b ? -1 : a > b ? 1 : 0)
          if (sorts.length) rows.sort((a, b) => { for (const c of sorts) { const d = cmp(a[c], b[c]); if (d) return d } return 0 })
          if (call.head) return { data: null, count: rows.length, error: null }
          if (single) return { data: rows[0] ?? null, error: null }
          let out = call.range ? rows.slice(call.range[0], call.range[1] + 1) : rows
          if (call.limit != null) out = out.slice(0, call.limit)
          if (opts.cap) out = out.slice(0, MAX_ROWS)
          return { data: out, count: call.count ? rows.length : null, error: null }
        }
        chain.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
          (opts.gate ? opts.gate(call) : Promise.resolve()).then(run).then(res, rej)
        return chain
      },
    }),
  } as never
}

/** The reports the golden file covers: every scope in Arabic, two in English (labels). */
export const GOLDEN_CASES = [
  ['university', 'tn', 'ar'], ['university', 'tn', 'en'], ['teacher', 't0', 'ar'], ['teacher', 't1', 'ar'],
  ['group', 'g0', 'ar'], ['group', 'g1', 'ar'], ['pilot', 'g0', 'ar'], ['pilot', 'g1', 'ar'],
  ['student', 's00', 'ar'], ['student', 's00', 'en'], ['student', 's01', 'ar'], ['student', 's50', 'ar'],
] as const
