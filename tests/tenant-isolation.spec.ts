/**
 * Tenant isolation & privilege-escalation E2E tests — run against production.
 *
 * This is the suite SECURITY_TEST_MATRIX.md previously flagged as missing:
 * "none of the current tests exercise cross-tenant isolation, since only one
 * real tenant exists in production." It closes that gap by creating two real
 * tenants with real accounts (via the Supabase Admin API), attempting every
 * cross-tenant read/write/forgery this audit could think of, and deleting
 * everything afterward.
 *
 * WHAT THIS PROVES that supabase/tests/rls_isolation_check.sql does not:
 * real Supabase Auth login (not a simulated JWT claim), real network requests
 * to the live PostgREST/RPC endpoints AND to this app's own /api/* route
 * handlers — so it also exercises proxy.ts, the service-role privileged-write
 * pattern, and the app-layer tenant checks documented in CLAUDE.md, not just
 * the RLS policies underneath them.
 *
 * REQUIRES (not committed — export before running, or put in tests/.env and
 * load it yourself; CI should inject these as secrets):
 *   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 * Every test in this file is skipped (not failed) when they are absent, so a
 * normal `npx playwright test` run without them still passes cleanly.
 *
 * ⚠️ WRITES REAL DATA TO WHATEVER PROJECT THE ENV VARS POINT AT (production,
 * unless you override NEXT_PUBLIC_SUPABASE_URL). afterAll() deletes it all —
 * verified empirically on 2026-09-13 (see AUDIT/11-security-isolation-tests.md)
 * — but if a run is killed mid-way (Ctrl+C, CI timeout), fixtures tagged
 * '__audit_isolation_test__' can be left behind. Cleanup query:
 *   delete from tenants where name like '%__audit_isolation_test__%';
 * (auth.users rows cascade-delete everything else when removed via the
 * Admin API — see the cleanup() helper below, which is exactly what to
 * re-run by hand if a run was interrupted.)
 */
import { test, expect } from '@playwright/test'

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON_KEY       = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE_KEY    = process.env.SUPABASE_SERVICE_ROLE_KEY
const HAS_ADMIN_ACCESS = Boolean(SUPABASE_URL && ANON_KEY && SERVICE_KEY)

const PASSWORD = 'AuditIsolation#2026!'
const TAG = '__audit_isolation_test__'

interface Persona { email: string; id: string; token: string }
interface Fixtures {
  tenantA: string; tenantB: string
  adminA: Persona; teacherA: Persona; studentA: Persona
  teacherB: Persona; studentB: Persona
  groupA: string; groupB: string
  lessonA: string; lessonB: string
  examA: string; examB: string
}

async function adminFetch(path: string, init: RequestInit = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY!,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  const text = await res.text()
  if (!res.ok && res.status !== 409) {
    throw new Error(`${init.method ?? 'GET'} ${path} -> ${res.status}: ${text}`)
  }
  // PostgREST returns an empty body (201/204) unless Prefer: return=representation
  // was set — don't assume 204 is the only empty case.
  return text ? JSON.parse(text) : null
}

async function createUser(email: string): Promise<string> {
  const u = await adminFetch('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }),
  })
  return u.id as string
}

async function loginPassword(email: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY!, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  })
  const j = await res.json()
  return j.access_token as string
}

// Tracks every id created so far, independent of whether setupFixtures ever
// returns — a crash partway through (this test file has already hit one
// live: a JSON-parsing bug on an empty-bodied PostgREST response orphaned 4
// tenants + 10 users on 2026-09-13 because cleanup only ran against the
// fully-built Fixtures object, which never got assigned) must still leave
// afterAll() something to delete.
const createdUserIds: string[] = []
const createdTenantIds: string[] = []

async function setupFixtures(): Promise<Fixtures> {
  const [tenantA, tenantB] = await Promise.all([
    adminFetch('/rest/v1/tenants', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ name: `${TAG}_tenant_a`, slug: `${TAG}-a-${Date.now()}`, is_active: true }),
    }).then(r => r[0].id as string),
    adminFetch('/rest/v1/tenants', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ name: `${TAG}_tenant_b`, slug: `${TAG}-b-${Date.now()}`, is_active: true }),
    }).then(r => r[0].id as string),
  ])
  createdTenantIds.push(tenantA, tenantB)

  const ts = Date.now()
  const [adminAId, teacherAId, studentAId, teacherBId, studentBId] = await Promise.all([
    createUser(`${TAG}-admin-a-${ts}@example.com`),
    createUser(`${TAG}-teacher-a-${ts}@example.com`),
    createUser(`${TAG}-student-a-${ts}@example.com`),
    createUser(`${TAG}-teacher-b-${ts}@example.com`),
    createUser(`${TAG}-student-b-${ts}@example.com`),
  ])
  createdUserIds.push(adminAId, teacherAId, studentAId, teacherBId, studentBId)

  const setProfile = (id: string, role: string, tenant_id: string) =>
    adminFetch(`/rest/v1/users?id=eq.${id}`, {
      method: 'PATCH', body: JSON.stringify({ role, tenant_id, is_active: true }),
    })
  await Promise.all([
    setProfile(adminAId, 'university_admin', tenantA),
    setProfile(teacherAId, 'teacher', tenantA),
    setProfile(studentAId, 'student', tenantA),
    setProfile(teacherBId, 'teacher', tenantB),
    setProfile(studentBId, 'student', tenantB),
  ])

  const [groupA, groupB] = await Promise.all([
    adminFetch('/rest/v1/groups', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ tenant_id: tenantA, teacher_id: teacherAId, name: `${TAG} Group A` }),
    }).then(r => r[0].id as string),
    adminFetch('/rest/v1/groups', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ tenant_id: tenantB, teacher_id: teacherBId, name: `${TAG} Group B` }),
    }).then(r => r[0].id as string),
  ])

  await Promise.all([
    adminFetch('/rest/v1/group_students', { method: 'POST', body: JSON.stringify({ group_id: groupA, student_id: studentAId }) }),
    adminFetch('/rest/v1/group_students', { method: 'POST', body: JSON.stringify({ group_id: groupB, student_id: studentBId }) }),
  ])

  const [lessonA, lessonB] = await Promise.all([
    adminFetch('/rest/v1/lessons', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ tenant_id: tenantA, teacher_id: teacherAId, group_id: groupA, title: `${TAG} Lesson A`, content: 'secret A', is_published: true }),
    }).then(r => r[0].id as string),
    adminFetch('/rest/v1/lessons', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ tenant_id: tenantB, teacher_id: teacherBId, group_id: groupB, title: `${TAG} Lesson B`, content: 'secret B', is_published: true }),
    }).then(r => r[0].id as string),
  ])

  const examBody = (tenant_id: string, teacher_id: string, group_id: string, title: string, answer: string) => ({
    tenant_id, teacher_id, group_id, type: 'exam', title,
    questions: [{ id: 'q1', type: 'mcq', correct_answer: answer, points: 10 }],
    duration_minutes: 30, is_published: true,
  })
  const [examA, examB] = await Promise.all([
    adminFetch('/rest/v1/exams', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify(examBody(tenantA, teacherAId, groupA, `${TAG} Exam A`, 'X')),
    }).then(r => r[0].id as string),
    adminFetch('/rest/v1/exams', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify(examBody(tenantB, teacherBId, groupB, `${TAG} Exam B`, 'Y')),
    }).then(r => r[0].id as string),
  ])

  const [adminAToken, teacherAToken, studentAToken, teacherBToken, studentBToken] = await Promise.all(
    [adminAId, teacherAId, studentAId, teacherBId, studentBId].map((_, i) =>
      loginPassword([`${TAG}-admin-a-${ts}@example.com`, `${TAG}-teacher-a-${ts}@example.com`, `${TAG}-student-a-${ts}@example.com`,
        `${TAG}-teacher-b-${ts}@example.com`, `${TAG}-student-b-${ts}@example.com`][i])
    )
  )

  return {
    tenantA, tenantB,
    adminA: { email: '', id: adminAId, token: adminAToken },
    teacherA: { email: '', id: teacherAId, token: teacherAToken },
    studentA: { email: '', id: studentAId, token: studentAToken },
    teacherB: { email: '', id: teacherBId, token: teacherBToken },
    studentB: { email: '', id: studentBId, token: studentBToken },
    groupA, groupB, lessonA, lessonB, examA, examB,
  }
}

async function cleanup() {
  // Reads from the module-level tracking arrays, NOT from the Fixtures
  // object returned by setupFixtures() — that object only exists if setup
  // completed successfully. A crash partway through still pushed whatever it
  // had created so far onto these arrays, so this still finds it.
  //
  // Deleting the auth user cascades public.users and everything it owns
  // (groups/lessons/exams/group_students) — see CLAUDE.md "every FK into
  // users is CASCADE". Tenants have nothing left referencing them afterward.
  for (const id of createdUserIds) {
    await adminFetch(`/auth/v1/admin/users/${id}`, { method: 'DELETE' }).catch(() => {})
  }
  for (const id of createdTenantIds) {
    await adminFetch(`/rest/v1/tenants?id=eq.${id}`, { method: 'DELETE' }).catch(() => {})
  }
}

function asUser(token: string) {
  return { apikey: ANON_KEY!, Authorization: `Bearer ${token}` }
}

test.describe('Tenant isolation & forgery — live cross-tenant attempts', () => {
  test.skip(!HAS_ADMIN_ACCESS, 'requires NEXT_PUBLIC_SUPABASE_URL / ANON_KEY / SUPABASE_SERVICE_ROLE_KEY in the environment')

  let f: Fixtures

  test.beforeAll(async () => { f = await setupFixtures() })
  test.afterAll(async () => { await cleanup() })

  test('student A cannot read tenant B users via an explicit tenant_id filter', async ({ request }) => {
    const res = await request.get(`${SUPABASE_URL}/rest/v1/users?tenant_id=eq.${f.tenantB}`, { headers: asUser(f.studentA.token) })
    expect(await res.json()).toEqual([])
  })

  test('student A sees only tenant A\'s lesson, never tenant B\'s', async (
    { request }
  ) => {
    const res = await request.get(`${SUPABASE_URL}/rest/v1/lessons?select=title`, { headers: asUser(f.studentA.token) })
    const titles = (await res.json()).map((r: { title: string }) => r.title)
    expect(titles).toContain(`${TAG} Lesson A`)
    expect(titles).not.toContain(`${TAG} Lesson B`)
  })

  test('teacher A cannot read tenant B\'s exam by direct id', async ({ request }) => {
    const res = await request.get(`${SUPABASE_URL}/rest/v1/exams?id=eq.${f.examB}&select=title,questions`, { headers: asUser(f.teacherA.token) })
    expect(await res.json()).toEqual([])
  })

  test('university_admin A gets nothing back asking get_tenant_archive for tenant B', async ({ request }) => {
    const res = await request.post(`${SUPABASE_URL}/rest/v1/rpc/get_tenant_archive`, {
      headers: { ...asUser(f.adminA.token), 'Content-Type': 'application/json' },
      data: { p_tenant_id: f.tenantB },
    })
    expect(await res.json()).toEqual([])
  })

  // PostgREST maps a Postgres 42501 (permission denied — EXECUTE/INSERT
  // revoked from `authenticated`) to HTTP 403 with that code in the body.
  // Assert on the actual error code, not a guessed status, so this doesn't
  // silently start passing for the wrong reason if PostgREST's status
  // mapping ever changes.
  async function expectPermissionDenied(res: { status(): number; json(): Promise<unknown> }) {
    expect(res.status()).toBeGreaterThanOrEqual(400)
    const body = (await res.json()) as { code?: string }
    expect(body.code).toBe('42501')
  }

  test('a student cannot start an exam attempt for another tenant\'s exam (RPC EXECUTE revoked)', async ({ request }) => {
    const res = await request.post(`${SUPABASE_URL}/rest/v1/rpc/start_exam_attempt`, {
      headers: { ...asUser(f.studentA.token), 'Content-Type': 'application/json' },
      data: { p_exam_id: f.examB, p_student_id: f.studentA.id, p_tenant_id: f.tenantB },
    })
    await expectPermissionDenied(res)
  })

  test('a student cannot forge their own exam score via finalize_exam_submission', async ({ request }) => {
    const res = await request.post(`${SUPABASE_URL}/rest/v1/rpc/finalize_exam_submission`, {
      headers: { ...asUser(f.studentA.token), 'Content-Type': 'application/json' },
      data: { p_exam_id: f.examA, p_student_id: f.studentA.id, p_answers: {}, p_client_events: [], p_score: 9999, p_max_score: 10 },
    })
    await expectPermissionDenied(res)
  })

  test('a student cannot forge a grade via a direct exam_submissions INSERT', async ({ request }) => {
    const res = await request.post(`${SUPABASE_URL}/rest/v1/exam_submissions`, {
      headers: { ...asUser(f.studentA.token), 'Content-Type': 'application/json', Prefer: 'return=representation' },
      data: {
        exam_id: f.examA, student_id: f.studentA.id, tenant_id: f.tenantA,
        score: 9999, max_score: 10, grading_status: 'published', status: 'submitted',
      },
    })
    await expectPermissionDenied(res) // table INSERT grant revoked — see fix_submission_insert_grade_forgery_migration.sql
  })

  test('a teacher cannot forge proctoring events for a student they don\'t own', async ({ request }) => {
    const res = await request.post(`${SUPABASE_URL}/rest/v1/rpc/append_proctoring_events`, {
      headers: { ...asUser(f.teacherA.token), 'Content-Type': 'application/json' },
      data: { p_exam_id: f.examB, p_student_id: f.studentB.id, p_events: [{ type: 'fake' }] },
    })
    await expectPermissionDenied(res)
  })

  // ── Fixed 2026-09-13 by fix_student_pii_overexposure_migration.sql ──────
  // Originally a live-exploit-verified finding: `users_select` had no role
  // check beyond tenant_id match, so a student could enumerate every user's
  // email in their tenant (see AUDIT/11-security-isolation-tests.md). This
  // test used to assert that leak on purpose (documenting the gap); it now
  // asserts the fix — a student sees only themselves and the teacher of a
  // group/course they're actually enrolled in, never the tenant's admin or
  // students outside their own groups.
  test('a student cannot enumerate other users\' emails outside their own group/course', async ({ request }) => {
    const res = await request.get(`${SUPABASE_URL}/rest/v1/users?select=email,role&tenant_id=eq.${f.tenantA}`, { headers: asUser(f.studentA.token) })
    const rows = (await res.json()) as Array<{ email: string; role: string }>
    const roles = rows.map(r => r.role)
    expect(roles).not.toContain('university_admin') // the tenant admin is not this student's group teacher
    expect(rows.length).toBeLessThanOrEqual(2) // at most: self + their own group's teacher
  })
})
