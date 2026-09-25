import type { SupabaseClient } from '@supabase/supabase-js'

// Platform engagement ("الحضور على المنصة") — how much a student actually
// works on what their teacher set, as opposed to attending a session in
// person (attendance_sessions / attendance_records).
//
// Both feeds come from SECURITY DEFINER RPCs added in
// supabase/engagement_metrics_migration.sql, which derive the caller's
// identity/tenant from auth.uid() and authorize internally. Until that
// migration is applied the RPC is missing and both loaders return null, so
// callers must render an "apply the migration" state rather than crash.

export interface EngagementStudent {
  student_id: string
  full_name: string
  is_active: boolean
  submitted: number
  assigned: number
  task_pct: number | null
  items_done: number
  quizzes_done: number
  course_done: number
  course_total: number
  course_pct: number | null
  active_days: number
  last_active_at: string | null
  engagement_pct: number | null
}

export interface GroupEngagement {
  generated_at: string
  period_days: number
  group: { id: string; name: string; course_id: string | null }
  summary: {
    students: number
    assigned: number
    submitted: number
    avg_engagement: number | null
    avg_task_pct: number | null
    avg_course_pct: number | null
    inactive: number
    at_risk: number
    thriving: number
  }
  students: EngagementStudent[]
}

export interface TenantEngagementRow {
  group_id: string
  name: string
  course_id: string | null
  teacher: string | null
  students: number
  assigned: number
  submitted: number
  task_pct: number | null
  active_students: number
  active_pct: number | null
  items_done: number
}

export interface TenantEngagement {
  generated_at: string
  period_days: number
  groups: TenantEngagementRow[]
}

export async function loadGroupEngagement(
  supabase: SupabaseClient,
  groupId: string,
  days = 30,
): Promise<GroupEngagement | null> {
  const { data, error } = await supabase.rpc('get_group_engagement', { p_group_id: groupId, p_days: days })
  if (error || !data) return null
  return data as unknown as GroupEngagement
}

export async function loadTenantEngagement(
  supabase: SupabaseClient,
  days = 30,
): Promise<TenantEngagement | null> {
  const { data, error } = await supabase.rpc('get_tenant_engagement', { p_days: days })
  if (error || !data) return null
  return data as unknown as TenantEngagement
}

/** Shared colour thresholds so every engagement view reads the same way. */
export function engagementTone(pct: number | null): string {
  if (pct === null) return 'text-slate-400'
  if (pct >= 85) return 'text-emerald-400'
  if (pct >= 50) return 'text-amber-400'
  return 'text-rose-400'
}

// ── Course analytics (centre / admin) ─────────────────────────────

export interface CourseGroupRow {
  group_id: string
  name: string
  teacher: string | null
  students: number
  avg_progress: number | null
  active_pct: number | null
  attendance_rate: number | null
  sessions: number
}

export interface CourseAnalyticsRow {
  course_id: string
  title: string
  is_published: boolean
  teacher: string | null
  items_total: number
  enrollments: number
  avg_progress: number | null
  completed_students: number
  active_students: number
  groups: CourseGroupRow[]
}

export interface CourseAnalytics {
  generated_at: string
  period_days: number
  courses: CourseAnalyticsRow[]
}

export async function loadCourseAnalytics(
  supabase: SupabaseClient,
  days = 30,
): Promise<CourseAnalytics | null> {
  const { data, error } = await supabase.rpc('get_course_analytics', { p_days: days })
  if (error || !data) return null
  return data as unknown as CourseAnalytics
}

/**
 * A rule-based finding about a course. Locale-free on purpose: `key` names a
 * sentence in `center.insights`, and the consumer renders it in the viewer's
 * language with formatInsight(). Group-name lists stay arrays until then, so
 * each language joins them with its own separator.
 */
export interface Insight {
  kind: 'strength' | 'weakness' | 'suggestion'
  key: string
  params?: Record<string, string | number | string[]>
}

export function courseInsights(c: CourseAnalyticsRow): Insight[] {
  const out: Insight[] = []
  const activePct = c.enrollments > 0 ? Math.round((100 * c.active_students) / c.enrollments) : null

  if (c.items_total === 0) {
    out.push({ kind: 'weakness', key: 'noItemsWeak' })
    out.push({ kind: 'suggestion', key: 'noItemsSuggest' })
    return out
  }
  if (c.enrollments === 0) {
    out.push({ kind: 'weakness', key: 'noEnrollWeak' })
    out.push({ kind: 'suggestion', key: 'noEnrollSuggest' })
    return out
  }

  if ((c.avg_progress ?? 0) >= 70) out.push({ kind: 'strength', key: 'progressGood', params: { pct: c.avg_progress ?? 0 } })
  else if ((c.avg_progress ?? 0) < 35) out.push({ kind: 'weakness', key: 'progressLow', params: { pct: c.avg_progress ?? 0 } })

  if (activePct !== null && activePct >= 70) out.push({ kind: 'strength', key: 'activeGood', params: { pct: activePct } })
  else if (activePct !== null && activePct < 40) {
    out.push({ kind: 'weakness', key: 'inactiveWeak', params: { pct: 100 - activePct } })
    out.push({ kind: 'suggestion', key: 'inactiveSuggest' })
  }

  if (c.completed_students > 0) out.push({ kind: 'strength', key: 'completed', params: { count: c.completed_students } })

  const withData = c.groups.filter(g => g.avg_progress !== null)
  if (withData.length >= 2) {
    const best = withData.reduce((a, b) => (a.avg_progress! >= b.avg_progress! ? a : b))
    const worst = withData.reduce((a, b) => (a.avg_progress! <= b.avg_progress! ? a : b))
    const gap = Math.round(best.avg_progress! - worst.avg_progress!)
    if (gap >= 25) {
      out.push({ kind: 'weakness', key: 'gapWeak', params: { gap, best: best.name, worst: worst.name } })
      out.push({ kind: 'suggestion', key: 'gapSuggest', params: { best: best.name, worst: worst.name } })
    }
  }

  const lowAttendance = c.groups.filter(g => g.attendance_rate !== null && g.attendance_rate < 75)
  if (lowAttendance.length > 0) {
    out.push({ kind: 'weakness', key: 'lowAttendWeak', params: { names: lowAttendance.map(g => g.name) } })
    out.push({ kind: 'suggestion', key: 'lowAttendSuggest' })
  }

  const noSessions = c.groups.filter(g => g.sessions === 0)
  if (noSessions.length > 0) {
    out.push({ kind: 'weakness', key: 'noSessionsWeak', params: { names: noSessions.map(g => g.name) } })
    out.push({ kind: 'suggestion', key: 'noSessionsSuggest' })
  }

  if (out.length === 0) out.push({ kind: 'strength', key: 'allNormal' })
  return out
}

/** Render an insight with a translator scoped to `center.insights`. */
export function formatInsight(
  t: (key: string, params?: Record<string, string | number>) => string,
  i: Insight,
): string {
  const sep = t('listSeparator')
  const params = Object.fromEntries(
    Object.entries(i.params ?? {}).map(([k, v]) => [k, Array.isArray(v) ? v.join(sep) : v]),
  )
  return t(i.key, params)
}
