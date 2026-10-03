import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { createClient, getAuthUser } from '@/lib/supabase/server'
import { getTranslations } from 'next-intl/server'
import { isScoreVisible } from '@/lib/score-visibility'

interface Notif { id: string; type: string; title: string; subtitle: string; date: string; href: string }

// The sections public.get_my_notifications() returns (supabase/notifications_feed_migration.sql), each already
// bounded and ordered newest first, read as the caller through RLS. Only the sections of the caller's role are present.
interface Feed {
  lessons?: { id: string; title: string; created_at: string; group_name: string | null }[]
  exams?: { id: string; title: string; created_at: string }[]
  grades?: {
    id: string; exam_id: string; score: number; max_score: number | null; submitted_at: string; grading_status: string | null
    /** null when the exam is not in the student's exam list (archived, unenrolled). */
    exam_title: string | null; exam_type: string | null; exam_has_manual_questions: boolean | null
  }[]
  submissions?: { id: string; exam_id: string; submitted_at: string; student_name: string | null; exam_title: string; exam_type: string }[]
  users?: { id: string; full_name: string; role: string; created_at: string }[]
  messages?: { id: string; name: string; message: string | null; created_at: string; is_read: boolean }[]
  tenants?: { id: string; name: string; created_at: string }[]
  ai_alerts?: { id: string; level: 'warning' | 'exceeded'; metric: 'requests' | 'tokens'; created_at: string; tenant_name: string | null; alert_threshold_pct: number | null }[]
}

const FEED_ROLES = new Set(['student', 'teacher', 'university_admin', 'super_admin'])

// GET /api/notifications — recent, role-aware activity for the header bell.
// Reads through the user's session (RLS-scoped); no notifications table —
// items are derived from recent domain activity, newest first. One read:
// get_my_notifications() (P-08); the titles and the score-visibility rule
// stay here.
export async function GET() {
  const supabase = await createClient()
  // Read-only and polled every 5 minutes: verify the JWT locally rather than a
  // round-trip to the Auth server. Every read below is RLS-scoped anyway.
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })

  // Role and tenant are in the verified JWT claims (sync_user_claims trigger);
  // the DB is only read for a legacy session whose claims were never backfilled.
  let profile: { role?: string; tenant_id?: string | null } | null =
    user.role ? { role: user.role, tenant_id: user.tenant_id } : null
  if (!profile) {
    const { data } = await supabase.from('users').select('role, tenant_id').eq('id', user.id).single()
    profile = data
  }
  const role = profile?.role
  const items: Notif[] = []
  // Titles are built here, so they are resolved in the caller's language here.
  const t = await getTranslations('common.notifications.items')
  if (!role || !FEED_ROLES.has(role)) return NextResponse.json({ notifications: items })

  const { data, error } = await supabase.rpc('get_my_notifications')
  if (error) {
    console.error('[notifications] get_my_notifications:', error.message)
    return NextResponse.json({ notifications: items })
  }
  const feed = (data ?? {}) as Feed

  for (const l of feed.lessons ?? []) {
    items.push({ id: `lesson-${l.id}`, type: 'lesson', title: t('newLesson', { title: l.title }), subtitle: l.group_name ?? '', date: l.created_at, href: '/student/lessons' })
  }
  for (const e of feed.exams ?? []) {
    items.push({ id: `exam-${e.id}`, type: 'exam', title: t('newExam', { title: e.title }), subtitle: '', date: e.created_at, href: '/student/exams' })
  }
  // Type / manual flag from the student exam list (students have no exams
  // SELECT); unpublished homework scores are not announced as "published".
  const visibleGrades = (feed.grades ?? [])
    .filter(gr => isScoreVisible(gr.grading_status, gr.exam_type, gr.exam_has_manual_questions))
    .slice(0, 6)
  for (const gr of visibleGrades) {
    items.push({ id: `grade-${gr.id}`, type: 'grade', title: t('gradePublished', { title: gr.exam_title ?? t('examFallback') }), subtitle: `${gr.score}${gr.max_score ? `/${gr.max_score}` : ''}`, date: gr.submitted_at, href: '/student/grades' })
  }
  // New submissions to the teacher's own exams/homework.
  for (const s of feed.submissions ?? []) {
    items.push({ id: `sub-${s.id}`, type: 'submission', title: t('newSubmission', { kind: s.exam_type === 'homework' ? 'homework' : 'exam', title: s.exam_title ?? '' }), subtitle: s.student_name ?? '', date: s.submitted_at, href: '/teacher/exams' })
  }
  // Newly added teachers/students in the tenant.
  for (const u of feed.users ?? []) {
    items.push({ id: `user-${u.id}`, type: 'user', title: t('newUser', { role: u.role, name: u.full_name }), subtitle: '', date: u.created_at, href: u.role === 'teacher' ? '/admin/teachers' : '/admin/students' })
  }
  for (const m of feed.messages ?? []) {
    items.push({ id: `msg-${m.id}`, type: 'message', title: t('contactMessage', { name: m.name }), subtitle: (m.message ?? '').slice(0, 80), date: m.created_at, href: '/super-admin/messages' })
  }
  for (const tn of feed.tenants ?? []) {
    items.push({ id: `tenant-${tn.id}`, type: 'tenant', title: t('newTenant', { name: tn.name }), subtitle: '', date: tn.created_at, href: '/super-admin/tenants' })
  }
  // Monthly AI allowance alerts: RLS shows super_admin every institution's and a
  // university_admin their own.
  const alertHref = role === 'super_admin' ? '/super-admin/ai-usage' : '/admin/dashboard'
  for (const a of feed.ai_alerts ?? []) {
    const name = a.tenant_name ?? ''
    items.push({
      id: `ai-alert-${a.id}`,
      type: 'ai_alert',
      title: a.level === 'exceeded'
        ? t('aiAllowanceExceeded', { name })
        : t('aiAllowanceWarning', { name, pct: a.alert_threshold_pct ?? 80 }),
      subtitle: '',
      date: a.created_at,
      href: alertHref,
    })
  }

  items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  return NextResponse.json({ notifications: items.slice(0, 15) })
}
