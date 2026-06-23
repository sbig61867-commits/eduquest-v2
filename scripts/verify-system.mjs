// End-to-end system verification — runs against the real Supabase project
// using the service-role key. Creates temp tenant/teacher/student, exercises
// the full flow, then cleans everything up.
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

// load .env.local manually
const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] })
)

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const log = (ok, msg) => console.log(`${ok ? '✅' : '❌'} ${msg}`)
const created = { users: [], tenants: [], lessons: [], groups: [], courses: [] }
let pass = 0, fail = 0
const check = (cond, msg) => { cond ? pass++ : fail++; log(cond, msg); return cond }

async function main() {
  console.log('\n━━━ 1. SCHEMA / MIGRATION STATE ━━━')

  // Check courses migration ran by probing each new table
  const newTables = ['courses', 'course_levels', 'course_units', 'unit_items',
    'course_enrollments', 'student_progress', 'unit_quiz_submissions', 'exam_retake_permissions']
  for (const t of newTables) {
    const { error } = await admin.from(t).select('id').limit(1)
    check(!error || !/does not exist|schema cache/i.test(error.message),
      `table "${t}" exists${error ? ` — ${error.message}` : ''}`)
  }

  // Check can_create_courses column on users
  {
    const { error } = await admin.from('users').select('can_create_courses').limit(1)
    check(!error, `users.can_create_courses column exists${error ? ` — ${error.message}` : ''}`)
  }
  // Check course_id on exams + invitations
  {
    const { error: e1 } = await admin.from('exams').select('course_id').limit(1)
    check(!e1, `exams.course_id column exists${e1 ? ` — ${e1.message}` : ''}`)
    const { error: e2 } = await admin.from('invitations').select('course_id').limit(1)
    check(!e2, `invitations.course_id column exists${e2 ? ` — ${e2.message}` : ''}`)
    const { error: e3 } = await admin.from('exam_submissions').select('grading_status').limit(1)
    check(!e3, `exam_submissions.grading_status column exists${e3 ? ` — ${e3.message}` : ''}`)
  }

  console.log('\n━━━ 2. CREATE UNIVERSITY (tenant) ━━━')
  const slug = `test-uni-${Date.now()}`
  const { data: tenant, error: tErr } = await admin.from('tenants')
    .insert({ name: 'Test University', slug }).select().single()
  check(!tErr && tenant, `created tenant${tErr ? ` — ${tErr.message}` : ` (${tenant.id})`}`)
  if (tenant) created.tenants.push(tenant.id)
  if (!tenant) return finish()

  console.log('\n━━━ 3. CREATE UNIVERSITY ADMIN ━━━')
  const adminUser = await makeUser('admin', tenant.id, 'university_admin')
  check(!!adminUser, `created university_admin${adminUser ? ` (${adminUser.email})` : ''}`)

  console.log('\n━━━ 4. CREATE TEACHER ━━━')
  const teacher = await makeUser('teacher', tenant.id, 'teacher')
  check(!!teacher, `created teacher${teacher ? ` (${teacher.email})` : ''}`)
  if (!teacher) return finish()

  // verify can_create_courses defaults to false
  {
    const { data } = await admin.from('users').select('can_create_courses').eq('id', teacher.id).single()
    check(data?.can_create_courses === false, `teacher.can_create_courses defaults to FALSE (got ${data?.can_create_courses})`)
  }

  console.log('\n━━━ 5. TEACHER CREATES GROUP ━━━')
  const { data: group, error: gErr } = await admin.from('groups')
    .insert({ tenant_id: tenant.id, teacher_id: teacher.id, name: 'Section A', description: 'test' })
    .select().single()
  check(!gErr && group, `created group${gErr ? ` — ${gErr.message}` : ''}`)
  if (group) created.groups.push(group.id)

  console.log('\n━━━ 6. TEACHER CREATES LESSON ━━━')
  const { data: lesson, error: lErr } = await admin.from('lessons')
    .insert({
      tenant_id: tenant.id, group_id: group.id, teacher_id: teacher.id,
      title: 'Intro Lesson', content: '# Hello\nThis is a test lesson.', is_published: true,
    }).select().single()
  check(!lErr && lesson, `created published lesson${lErr ? ` — ${lErr.message}` : ''}`)
  if (lesson) created.lessons.push(lesson.id)

  console.log('\n━━━ 7. CREATE STUDENT + ENROLL IN GROUP ━━━')
  const student = await makeUser('student', tenant.id, 'student')
  check(!!student, `created student${student ? ` (${student.email})` : ''}`)
  if (student && group) {
    const { error: eErr } = await admin.from('group_students')
      .insert({ group_id: group.id, student_id: student.id })
    check(!eErr, `enrolled student in group${eErr ? ` — ${eErr.message}` : ''}`)
  }

  console.log('\n━━━ 8. RLS: STUDENT SEES ONLY OWN TENANT LESSONS ━━━')
  // Simulate a second tenant + lesson, ensure student cannot see it via RLS
  const { data: tenant2 } = await admin.from('tenants')
    .insert({ name: 'Other Uni', slug: `other-${Date.now()}` }).select().single()
  if (tenant2) {
    created.tenants.push(tenant2.id)
    const teacher2 = await makeUser('teacher2', tenant2.id, 'teacher')
    const { data: g2 } = await admin.from('groups')
      .insert({ tenant_id: tenant2.id, teacher_id: teacher2.id, name: 'Other' }).select().single()
    if (g2) {
      created.groups.push(g2.id)
      const { data: l2 } = await admin.from('lessons').insert({
        tenant_id: tenant2.id, group_id: g2.id, teacher_id: teacher2.id,
        title: 'Secret', content: 'hidden', is_published: true,
      }).select().single()
      if (l2) created.lessons.push(l2.id)
    }
  }
  // Use an anon client authenticated as the student to test RLS
  const studentClient = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  const { data: signIn, error: siErr } = await studentClient.auth.signInWithPassword({
    email: student.email, password: 'TestPass123!',
  })
  if (check(!siErr && signIn?.user, `student can sign in${siErr ? ` — ${siErr.message}` : ''}`)) {
    const { data: visibleLessons } = await studentClient.from('lessons').select('tenant_id, title')
    const ownOnly = (visibleLessons ?? []).every(l => l.tenant_id === tenant.id)
    check(ownOnly, `student sees ONLY own-tenant lessons (saw ${visibleLessons?.length ?? 0}, cross-tenant leak: ${!ownOnly})`)
    await studentClient.auth.signOut()
  }

  finish()
}

async function makeUser(prefix, tenantId, role) {
  const email = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`
  const { data, error } = await admin.auth.admin.createUser({
    email, password: 'TestPass123!', email_confirm: true,
    user_metadata: { full_name: `Test ${role}` },
  })
  if (error || !data.user) { console.log(`   (createUser failed: ${error?.message})`); return null }
  created.users.push(data.user.id)
  // The handle_new_user trigger creates the profile; update role+tenant
  const { error: uErr } = await admin.from('users')
    .update({ role, tenant_id: tenantId, full_name: `Test ${role}` }).eq('id', data.user.id)
  if (uErr) { console.log(`   (profile update failed: ${uErr.message})`) }
  return { id: data.user.id, email }
}

async function finish() {
  console.log('\n━━━ CLEANUP ━━━')
  for (const id of created.lessons) await admin.from('lessons').delete().eq('id', id)
  for (const id of created.groups) await admin.from('groups').delete().eq('id', id)
  for (const id of created.users) await admin.auth.admin.deleteUser(id).catch(() => {})
  for (const id of created.tenants) await admin.from('tenants').delete().eq('id', id)
  console.log('   cleaned up all test data')
  console.log(`\n━━━ RESULT: ${pass} passed, ${fail} failed ━━━\n`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error('FATAL', e); finish() })
