/**
 * Shared fixture for the report tests: a deterministic institution (two live
 * groups of 42, a deleted group, deleted and unpublished exams, a survey).
 *
 * reports-golden.json holds what the original builders produced from this
 * world (every row read), so it is the reference for "the same report, read
 * correctly" — reports-golden-trial.test.ts loads the world into the Neon
 * trial and checks the SQL-layer reports against it.
 */

export const FIXED_NOW = new Date('2026-10-01T12:00:00Z')

const DAY = 86_400_000
const iso = (ms: number) => new Date(ms).toISOString()
const NOW = FIXED_NOW.getTime()

type Row = Record<string, unknown>
export interface World { [table: string]: Row[] }

/**
 * Two live groups of 42 (one student in both), a deleted group, deleted and unpublished exams, a survey.
 * `missingMax`: some scored submissions have no max_score (scored before finalisation) — on two
 * listed exams (g0-e03, g1-e05) and on the deleted exam, which no report lists.
 */
export function buildWorld(opts: { missingMax?: boolean } = {}): World {
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
      const noMax = opts.missingMax && !awaiting && si % 5 === 1 && ['g0-e03', 'g1-e05', 'g0-deleted'].includes(e.id as string)
      subs.push({
        id: `sub${String(n++).padStart(5, '0')}`, exam_id: e.id, student_id: m.student_id, tenant_id: 'tn',
        score: awaiting ? null : (si * 3 + k * 5) % (max + 1), max_score: noMax ? null : max,
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

/** The reports the golden file covers: every scope in Arabic, two in English (labels). */
export const GOLDEN_CASES = [
  ['university', 'tn', 'ar'], ['university', 'tn', 'en'], ['teacher', 't0', 'ar'], ['teacher', 't1', 'ar'],
  ['group', 'g0', 'ar'], ['group', 'g1', 'ar'], ['pilot', 'g0', 'ar'], ['pilot', 'g1', 'ar'],
  ['student', 's00', 'ar'], ['student', 's00', 'en'], ['student', 's01', 'ar'], ['student', 's50', 'ar'],
] as const

/** Reports over the `missingMax` world (the score-without-max_score fallback). */
export const GOLDEN_FALLBACK_CASES = [
  ['university', 'tn', 'ar'], ['teacher', 't0', 'ar'], ['teacher', 't1', 'ar'], ['group', 'g0', 'ar'],
  ['pilot', 'g1', 'ar'], ['student', 's01', 'ar'], ['student', 's43', 'ar'],
] as const
