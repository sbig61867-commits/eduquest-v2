// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import postgres from 'postgres'
import golden from './reports-golden.json'
import { buildWorld, GOLDEN_CASES, GOLDEN_FALLBACK_CASES, FIXED_NOW, type World } from './reports-fixture'

// The reports on the SQL layer must reproduce reports-golden.json EXACTLY —
// what the original builders produced from the same fixture. Step 9 replaced
// the paged PostgREST reads with one unit of complete reads per report and
// moved the score-without-max_score fallback into SQL; this proves both on
// the Neon trial: the fixture world is loaded into a scratch institution (its
// ids mapped to UUIDs that keep their sort order, since some reads order by
// id), every golden case is built and compared, and everything is removed.
// Runs with `npm run test:neon`.

const READY = !!(process.env.NEON_GATEWAY_DATABASE_URL && process.env.NEON_DATABASE_URL)
// A report unit holds up to eight statements; from a PC far from Frankfurt that
// can pass the 20 s production limit (milliseconds next to the database).
process.env.DB_UNIT_TIMEOUT_MS ??= '120000'

describe.skipIf(!READY)('reports on the SQL layer reproduce the golden reports', () => {
  const owner = postgres(process.env.NEON_DATABASE_URL ?? 'postgres://unused', { max: 1, prepare: false, onnotice: () => {} })
  const tag = `rg${Date.now()}`
  let uuid: Map<string, string>

  /** Fixture id → a UUID; within each id family the lexicographic order is kept. */
  function idMap(world: World): Map<string, string> {
    const ids = new Set<string>()
    for (const rows of Object.values(world)) for (const r of rows) if (typeof r.id === 'string') ids.add(r.id)
    const sorted = [...ids].sort()
    return new Map(sorted.map((id, i) => [id, `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`]))
  }
  const u = (id: unknown) => uuid.get(String(id))!

  // Each table in one statement from a JSON set (row by row over the network
  // took minutes). A flagged submission gets one tab_switch event: is_flagged
  // is generated from proctoring_events.
  const set = (rows: unknown[]) => owner.json(rows as never)

  async function load(world: World) {
    uuid = idMap(world)
    await unload()   // whatever an interrupted run left behind
    const tenantId = u('tn')
    await owner`insert into public.tenants (id, name, slug, code) values (${tenantId}, 'Uni', ${tag + Math.random().toString(36).slice(2, 6)}, ${Math.random().toString(36).slice(2, 7).toUpperCase().padEnd(5, 'X')})`
    const people = world.users.map(p => ({ id: u(p.id), name: p.full_name, email: `${tag}.${p.email}`, real_email: p.email, role: p.role, created_at: p.created_at }))
    await owner`insert into ba."user" (id, name, email, "emailVerified")
                select x.id, x.name, x.email, true from jsonb_to_recordset(${set(people)}) as x(id uuid, name text, email text)`
    await owner`update public.users u set role = x.role, tenant_id = ${tenantId}, full_name = x.name, email = x.real_email, created_at = x.created_at
                  from jsonb_to_recordset(${set(people)}) as x(id uuid, name text, real_email text, role text, created_at timestamptz)
                 where u.id = x.id`
    await owner`insert into public.groups (id, tenant_id, teacher_id, name, created_at, deleted_at)
                select x.id, ${tenantId}, x.teacher_id, x.name, x.created_at, x.deleted_at
                  from jsonb_to_recordset(${set(world.groups.map(g => ({ ...g, id: u(g.id), teacher_id: u(g.teacher_id) })))})
                    as x(id uuid, teacher_id uuid, name text, created_at timestamptz, deleted_at timestamptz)`
    await owner`insert into public.group_students (group_id, student_id, joined_at)
                select x.group_id, x.student_id, x.joined_at
                  from jsonb_to_recordset(${set(world.group_students.map(m => ({ group_id: u(m.group_id), student_id: u(m.student_id), joined_at: m.joined_at })))})
                    as x(group_id uuid, student_id uuid, joined_at timestamptz)`
    await owner`insert into public.exams (id, tenant_id, teacher_id, group_id, title, type, questions, duration_minutes, created_at,
                                          proctoring_enabled, is_published, deleted_at)
                select x.id, ${tenantId}, x.teacher_id, x.group_id, x.title, x.type, x.questions, 60, x.created_at, x.proctoring_enabled, x.is_published, x.deleted_at
                  from jsonb_to_recordset(${set(world.exams.map(e => ({ ...e, id: u(e.id), teacher_id: u(e.teacher_id), group_id: u(e.group_id) })))})
                    as x(id uuid, teacher_id uuid, group_id uuid, title text, type text, questions jsonb, created_at timestamptz,
                         proctoring_enabled boolean, is_published boolean, deleted_at timestamptz)`
    await owner`insert into public.exam_submissions (id, tenant_id, exam_id, student_id, score, max_score, is_graded, submitted_at, status, proctoring_events)
                select x.id, ${tenantId}, x.exam_id, x.student_id, x.score, x.max_score, x.is_graded, x.submitted_at, 'submitted',
                       case when x.is_flagged then '[{"type":"tab_switch"}]'::jsonb else '[]'::jsonb end
                  from jsonb_to_recordset(${set(world.exam_submissions.map(s => ({ ...s, id: u(s.id), exam_id: u(s.exam_id), student_id: u(s.student_id) })))})
                    as x(id uuid, exam_id uuid, student_id uuid, score numeric, max_score numeric, is_graded boolean, is_flagged boolean, submitted_at timestamptz)`
    await owner`insert into public.lessons (id, tenant_id, teacher_id, group_id, title, is_published, deleted_at)
                select x.id, ${tenantId}, x.teacher_id, x.group_id, x.title, x.is_published, x.deleted_at
                  from jsonb_to_recordset(${set(world.lessons.map(l => ({ ...l, title: l.id, id: u(l.id), teacher_id: u(l.teacher_id), group_id: u(l.group_id) })))})
                    as x(id uuid, teacher_id uuid, group_id uuid, title text, is_published boolean, deleted_at timestamptz)`
    for (const sv of world.surveys) {
      const group = world.groups.find(g => g.id === sv.group_id)!
      await owner`insert into public.surveys (id, tenant_id, group_id, teacher_id, title) values (${u(sv.id)}, ${tenantId}, ${u(sv.group_id)}, ${u(group.teacher_id)}, ${String(sv.title)})`
    }
    // The fixture's answers have no student; one distinct member each (one answer per student and survey).
    await owner`insert into public.survey_responses (id, tenant_id, survey_id, student_id, ease_rating, prefer_platform, recommend, best_feature, problem_faced, comment)
                select x.id, ${tenantId}, x.survey_id, x.student_id, x.ease_rating, x.prefer_platform, x.recommend, x.best_feature, x.problem_faced, x.comment
                  from jsonb_to_recordset(${set(world.survey_responses.map((r, i) => ({ ...r, id: u(r.id), survey_id: u(r.survey_id), student_id: u('s' + String(i).padStart(2, '0')) })))})
                    as x(id uuid, survey_id uuid, student_id uuid, ease_rating int, prefer_platform boolean, recommend boolean,
                         best_feature text, problem_faced text, comment text)`
  }

  async function unload() {
    const tenantId = u('tn')
    await owner`delete from public.survey_responses where tenant_id = ${tenantId}`
    await owner`delete from public.surveys where tenant_id = ${tenantId}`
    await owner`delete from public.exam_submissions where tenant_id = ${tenantId}`
    await owner`delete from public.exams where tenant_id = ${tenantId}`
    await owner`delete from public.lessons where tenant_id = ${tenantId}`
    await owner`delete from public.groups where tenant_id = ${tenantId}`
    await owner`delete from ba."user" where email ~ '^rg[0-9]+\\.'`
    await owner`delete from public.tenants where id = ${tenantId}`
  }

  async function build(scope: string, id: string, lang: 'ar' | 'en') {
    const r = await import('@/lib/reports')
    const builders = { university: r.buildUniversityReport, teacher: r.buildTeacherReport, group: r.buildGroupReport, pilot: r.buildPilotReport, student: r.buildStudentReport }
    return builders[scope as keyof typeof builders](u(id), lang)
  }

  beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(FIXED_NOW) })
  afterAll(async () => { vi.useRealTimers(); await owner.end() })

  it('every golden case, from the fixture world', async () => {
    await load(buildWorld())
    try {
      for (const [scope, id, lang] of GOLDEN_CASES) {
        expect(await build(scope, id, lang), `${scope}:${id}:${lang}`).toEqual((golden as Record<string, unknown>)[`${scope}:${id}:${lang}`])
      }
      expect(await build('group', 'tn', 'ar')).toBeNull()   // an unknown subject is null
    } finally {
      await unload()
    }
  }, 600_000)

  it('every golden case with scores without max_score (the fallback computed in SQL)', async () => {
    await load(buildWorld({ missingMax: true }))
    try {
      for (const [scope, id, lang] of GOLDEN_FALLBACK_CASES) {
        expect(await build(scope, id, lang), `fallback ${scope}:${id}:${lang}`)
          .toEqual((golden as Record<string, unknown>)[`missingMax:${scope}:${id}:${lang}`])
      }
    } finally {
      await unload()
    }
  }, 600_000)
})
