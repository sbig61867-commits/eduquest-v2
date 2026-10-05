// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Archived groups — student surfaces (Option A, owner's decision 2026-10-05).
 * groups.is_active = false hides the group and its operational content from
 * students; membership, records and in-progress attempts stay. The SQL side
 * (schedule, group announcements, the bell's lessons) is checked by
 * supabase/tests/archived_groups_student_surfaces_check.sql.
 *
 * 1. /api/exam/start: no NEW attempt on an archived group's exam; an attempt
 *    already in progress resumes; active groups and course exams unchanged.
 * 2. /api/surveys/respond: an archived group's survey is neither offered nor
 *    accepted.
 * 3. The four student pages read memberships of ACTIVE groups only.
 */

const state = vi.hoisted(() => ({
  user: { id: 'student-a' } as { id: string } | null,
  role: 'student',
  exam: null as Record<string, unknown> | null,
  groupActive: {} as Record<string, boolean>,          // group id → is_active
  members: new Set<string>(),                          // `${group}:${student}`
  inProgress: new Set<string>(),                       // `${exam}:${student}`
  surveys: [] as { id: string; title: string; group_id: string; is_open: boolean }[],
  answered: new Set<string>(),
  inserts: [] as unknown[],
  groupReads: 0,
  rpcCalls: 0,
}))

/** A tiny fake of the PostgREST chain: records eq filters, applies the ones the routes use. */
function table(name: string) {
  const eq: Record<string, unknown> = {}
  let inner = false
  let ids: unknown[] | null = null
  const rows = (): Record<string, unknown>[] => {
    if (name === 'group_students') {
      return [...state.members]
        .map(k => { const [group_id, student_id] = k.split(':'); return { group_id, student_id, groups: { is_active: state.groupActive[group_id] ?? true } } })
        .filter(r => (eq.student_id === undefined || r.student_id === eq.student_id) && (eq.group_id === undefined || r.group_id === eq.group_id))
        // groups!inner(is_active) + .eq('groups.is_active', v): rows whose group does not match drop out
        .filter(r => !inner || eq['groups.is_active'] === undefined || r.groups.is_active === eq['groups.is_active'])
    }
    if (name === 'surveys') {
      return state.surveys
        .filter(s => (ids === null || ids.includes(s.group_id)) && (eq.is_open === undefined || s.is_open === eq.is_open) && (eq.id === undefined || s.id === eq.id))
        .map(s => ({ ...s, groups: { name: 'G', is_active: state.groupActive[s.group_id] ?? true } }))
    }
    if (name === 'survey_responses') return [...state.answered].map(survey_id => ({ survey_id }))
    return []
  }
  const chain: Record<string, unknown> = {
    select: (cols: string) => { inner = /groups!inner/.test(cols ?? ''); return chain },
    eq: (c: string, v: unknown) => { eq[c] = v; return chain },
    in: (c: string, v: unknown[]) => { if (c === 'group_id') ids = v; return chain },
    is: () => chain,
    insert: async (row: unknown) => { state.inserts.push(row); return { error: null } },
    single: async () => {
      if (name === 'users') return { data: { role: state.role, tenant_id: 'tenant-a' } }
      if (name === 'exams') return { data: state.exam }
      return { data: rows()[0] ?? null }
    },
    maybeSingle: async () => {
      if (name === 'groups') { state.groupReads++; return { data: { is_active: state.groupActive[eq.id as string] ?? true } } }
      if (name === 'exam_submissions') {
        if (eq.status === 'in_progress') return { data: state.inProgress.has(`${eq.exam_id}:${eq.student_id}`) ? { id: 'sub-1' } : null }
        return { data: null }
      }
      if (name === 'group_students') return { data: rows()[0] ?? null }
      if (name === 'course_enrollments') return { data: state.members.has(`${eq.course_id}:${eq.student_id}`) ? { student_id: eq.student_id } : null }
      return { data: null }
    },
    then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(resolve),
  }
  return chain
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) }, from: table }),
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: table,
    rpc: async () => { state.rpcCalls++; return { data: { started_at: '2026-10-05T10:00:00.000Z', resumed: state.inProgress.size > 0, answers_draft: {} }, error: null } },
  }),
}))
vi.mock('@/lib/exam-files', () => ({ signFileMap: async () => ({}) }))
vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))

import { POST as startExam } from '@/app/api/exam/start/route'
import { GET as surveyGet, POST as surveyPost } from '@/app/api/surveys/respond/route'

const start = () => startExam(new Request('https://eduquest.test/api/exam/start', { method: 'POST', body: JSON.stringify({ examId: 'exam-1' }) }))
const groupExam = (over: Record<string, unknown> = {}) => ({
  id: 'exam-1', tenant_id: 'tenant-a', group_id: 'group-a', course_id: null, assigned_student_id: null,
  starts_at: null, ends_at: null, seb_config_key: null, questions: [{ id: 'q1', type: 'mcq', text: 'Q', options: ['a'], correct_answer: 'a', points: 1 }],
  is_published: true, deleted_at: null, ...over,
})

beforeEach(() => {
  state.user = { id: 'student-a' }
  state.role = 'student'
  state.exam = groupExam()
  state.groupActive = { 'group-a': true, 'group-b': true }
  state.members = new Set(['group-a:student-a'])
  state.inProgress = new Set()
  state.surveys = []
  state.answered = new Set()
  state.inserts = []
  state.groupReads = 0
  state.rpcCalls = 0
})

describe('/api/exam/start — archived group', () => {
  it('refuses a NEW attempt on an archived group\'s exam (403 examGroupArchived), without starting anything', async () => {
    state.groupActive['group-a'] = false
    const res = await start()
    expect(res.status).toBe(403)
    const text = await res.text()
    expect(JSON.parse(text)).toMatchObject({ code: 'examGroupArchived' })
    expect(text).not.toContain('questions')
    expect(state.rpcCalls).toBe(0)
  })

  it('resumes an attempt already in progress when the group is archived afterwards', async () => {
    state.groupActive['group-a'] = false
    state.inProgress.add('exam-1:student-a')
    const res = await start()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ resumed: true })
    expect(state.rpcCalls).toBe(1)
  })

  it('an active group\'s exam starts exactly as before', async () => {
    const res = await start()
    expect(res.status).toBe(200)
    expect(state.rpcCalls).toBe(1)
  })

  it('a course exam (group_id = null) never reads a group and starts as before', async () => {
    state.exam = groupExam({ group_id: null, course_id: 'course-a' })
    state.members.add('course-a:student-a')
    const res = await start()
    expect(res.status).toBe(200)
    expect(state.groupReads).toBe(0)
    expect(state.rpcCalls).toBe(1)
  })

  it('a non-member is still refused as not enrolled, before the archive check', async () => {
    state.groupActive['group-a'] = false
    state.members = new Set()
    const res = await start()
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'notEnrolledInExam' })
  })
})

describe('/api/surveys/respond — archived group', () => {
  it('GET offers no survey of an archived group', async () => {
    state.groupActive['group-a'] = false
    state.surveys = [{ id: 's1', title: 'Pilot', group_id: 'group-a', is_open: true }]
    const res = await surveyGet()
    expect(await res.json()).toEqual({ survey: null })
  })

  it('GET still offers an active group\'s survey', async () => {
    state.groupActive['group-a'] = false
    state.members.add('group-b:student-a')
    state.surveys = [
      { id: 's1', title: 'Archived', group_id: 'group-a', is_open: true },
      { id: 's2', title: 'Active', group_id: 'group-b', is_open: true },
    ]
    const res = await surveyGet()
    expect(await res.json()).toMatchObject({ survey: { id: 's2', title: 'Active' } })
  })

  const answer = (survey_id: string) => surveyPost(new Request('https://eduquest.test/api/surveys/respond', {
    method: 'POST', body: JSON.stringify({ survey_id, ease_rating: 4, prefer_platform: true, recommend: true }),
  }))

  it('POST refuses an answer to an archived group\'s survey (404 surveyNotOpen) and writes nothing', async () => {
    state.groupActive['group-a'] = false
    state.surveys = [{ id: 's1', title: 'Pilot', group_id: 'group-a', is_open: true }]
    const res = await answer('s1')
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ code: 'surveyNotOpen' })
    expect(state.inserts).toHaveLength(0)
  })

  it('POST accepts an answer to an active group\'s survey as before', async () => {
    state.surveys = [{ id: 's1', title: 'Pilot', group_id: 'group-a', is_open: true }]
    const res = await answer('s1')
    expect(res.status).toBe(201)
    expect(state.inserts).toHaveLength(1)
  })
})

describe('student pages read memberships of active groups only', () => {
  // Static check of the membership read in each page — the !inner join on groups plus the
  // is_active filter is what drops an archived group (PostgREST semantics, mirrored by the SQL check).
  const SRC = join(__dirname, '..')
  const files = [
    'app/(student)/student/dashboard/page.tsx',
    'app/(student)/student/notifications/page.tsx',
    'components/student/quick-access-panel.tsx',
    'app/(student)/student/profile/page.tsx',
  ]
  for (const f of files) {
    it(f, () => {
      const src = readFileSync(join(SRC, f), 'utf8')
      const at = src.indexOf(".from('group_students')")
      expect(at).toBeGreaterThan(-1)
      const read = src.slice(at, src.indexOf('\n\n', at))
      expect(read).toMatch(/groups!inner\([^)]*is_active/)
      expect(read).toContain(".eq('groups.is_active', true)")
    })
  }
})
