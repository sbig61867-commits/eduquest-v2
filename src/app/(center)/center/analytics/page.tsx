export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { loadCenterAccess } from '@/lib/center-access'
import { NoPermission } from '@/components/shared/no-permission'
import { getTranslations } from 'next-intl/server'
import { loadCourseAnalytics, loadTenantEngagement, courseInsights, formatInsight, engagementTone, type CourseAnalyticsRow } from '@/lib/engagement'
import { BarChart3, CheckCircle2, AlertTriangle, Lightbulb } from 'lucide-react'
import { CourseSuggestions } from '@/components/center/course-suggestions'

// Course → its groups, read as one picture: content progress, platform
// engagement and class attendance side by side, plus a rule-based reading
// of what is strong, what is weak and what to do next.
//
// Both RPCs aggregate inside Postgres and return no student rows and no
// scores, so this page stays inside the "numbers, not content" rule that
// applies to university_admin.

const PERIODS = [7, 30, 90, 180]

function pct(v: number | null | undefined) {
  return v === null || v === undefined ? '—' : `${v}%`
}

/** Horizontal bar — a percentage the eye can compare across rows. */
function Bar({ value, tone = 'bg-blue-500' }: { value: number | null; tone?: string }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }} />
    </div>
  )
}

function barTone(v: number | null) {
  if (v === null) return 'bg-slate-600'
  if (v >= 70) return 'bg-emerald-500'
  if (v >= 40) return 'bg-amber-500'
  return 'bg-rose-500'
}

async function CourseCard({ c, activeTaskPct, days }: { c: CourseAnalyticsRow; activeTaskPct: Map<string, number | null>; days: number }) {
  const t = await getTranslations('center.analytics')
  const tInsight = await getTranslations('center.insights')
  const insights = courseInsights(c)
  const groups = [...c.groups].sort((a, b) => (b.avg_progress ?? -1) - (a.avg_progress ?? -1))

  return (
    <section className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
      <div className="p-5 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-white font-semibold truncate">{c.title}</h3>
          <p className="text-slate-500 text-xs mt-0.5">
            {t('courseMeta', { teacher: c.teacher ?? '—', items: c.items_total, enrollments: c.enrollments })}
            {!c.is_published && <span className="text-amber-400">{t('unpublished')}</span>}
          </p>
        </div>
        <div className="flex items-center gap-5 text-end">
          <div>
            <p className="text-slate-400 text-[11px]">{t('avgProgress')}</p>
            <p className={`text-xl font-bold tabular-nums ${engagementTone(c.avg_progress)}`}>{pct(c.avg_progress)}</p>
          </div>
          <div>
            <p className="text-slate-400 text-[11px]">{t('activeStudents')}</p>
            <p className="text-xl font-bold text-white tabular-nums">{c.active_students}/{c.enrollments}</p>
          </div>
          <div>
            <p className="text-slate-400 text-[11px]">{t('completedCourse')}</p>
            <p className="text-xl font-bold text-emerald-400 tabular-nums">{c.completed_students}</p>
          </div>
        </div>
      </div>

      {groups.length === 0 ? (
        <p className="px-5 py-6 text-slate-500 text-sm">{t('noGroups')}</p>
      ) : (
        <div className="divide-y divide-slate-800">
          {groups.map(g => (
            <div key={g.group_id} className="px-5 py-4 grid grid-cols-1 md:grid-cols-4 gap-4 items-center">
              <div className="min-w-0">
                <p className="text-white text-sm truncate">{g.name}</p>
                <p className="text-slate-500 text-xs mt-0.5">{t('groupMeta', { teacher: g.teacher ?? '—', students: g.students })}</p>
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">{t('contentProgress')}</span>
                  <span className="text-slate-300 tabular-nums">{pct(g.avg_progress)}</span>
                </div>
                <Bar value={g.avg_progress} tone={barTone(g.avg_progress)} />
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">{t('teacherEngagement')}</span>
                  <span className="text-slate-300 tabular-nums">
                    {pct(g.active_pct)}
                    {activeTaskPct.get(g.group_id) !== undefined && activeTaskPct.get(g.group_id) !== null && (
                      <span className="text-slate-500">{t('tasksPct', { pct: activeTaskPct.get(g.group_id)! })}</span>
                    )}
                  </span>
                </div>
                <Bar value={g.active_pct} tone={barTone(g.active_pct)} />
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">{t('classAttendance')}</span>
                  <span className="text-slate-300 tabular-nums">{t('attendanceValue', { rate: pct(g.attendance_rate), sessions: g.sessions })}</span>
                </div>
                <Bar value={g.attendance_rate} tone={barTone(g.attendance_rate)} />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="px-5 py-4 bg-slate-950/40 border-t border-slate-800 grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
        {(['strength', 'weakness', 'suggestion'] as const).map(kind => {
          const list = insights.filter(i => i.kind === kind)
          const meta = {
            strength:   { label: t('strength'),   Icon: CheckCircle2,   cls: 'text-emerald-400' },
            weakness:   { label: t('weakness'),   Icon: AlertTriangle,  cls: 'text-rose-400' },
            suggestion: { label: t('suggestion'), Icon: Lightbulb,      cls: 'text-amber-400' },
          }[kind]
          return (
            <div key={kind} className="space-y-1.5">
              <p className={`flex items-center gap-1.5 font-medium ${meta.cls}`}>
                <meta.Icon className="w-3.5 h-3.5" /> {meta.label}
              </p>
              {list.length === 0
                ? <p className="text-slate-600">—</p>
                : list.map((i, n) => <p key={n} className="text-slate-400 leading-relaxed">• {formatInsight(tInsight, i)}</p>)}
              {kind === 'suggestion' && <CourseSuggestions courseId={c.course_id} days={days} />}
            </div>
          )
        })}
      </div>
    </section>
  )
}

export default async function CenterAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>
}) {
  const { days } = await searchParams
  const t = await getTranslations('center.analytics')
  const { supabase, has } = await loadCenterAccess()
  if (!has('view_reports')) return <NoPermission capability="view_reports" />

  const period = PERIODS.includes(Number(days)) ? Number(days) : 30
  const [analytics, engagement] = await Promise.all([
    loadCourseAnalytics(supabase, period),
    loadTenantEngagement(supabase, period),
  ])

  // Assignment submission rate per group, merged in from the engagement feed.
  const taskByGroup = new Map<string, number | null>(
    (engagement?.groups ?? []).map(g => [g.group_id, g.task_pct]),
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white">{t('title')}</h2>
          <p className="text-slate-400 mt-1">{t('subtitle')}</p>
        </div>
        <div className="flex gap-2">
          {PERIODS.map(d => (
            <Link key={d} href={`/center/analytics?days=${d}`}
              className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                d === period
                  ? 'bg-slate-700 border-slate-600 text-white'
                  : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-500'
              }`}>{t('periodDays', { days: d })}</Link>
          ))}
        </div>
      </div>

      {!analytics ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 text-slate-400 text-sm">
          {t('migrationMissing')} <code dir="ltr">engagement_metrics_migration.sql</code> {t('migrationMissingEnd')}
        </div>
      ) : analytics.courses.length === 0 ? (
        <div className="text-center py-20 bg-slate-900 border border-slate-800 rounded-xl">
          <BarChart3 className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400">{t('noCourses')}</p>
        </div>
      ) : (
        <div className="space-y-5">
          {analytics.courses.map(c => <CourseCard key={c.course_id} c={c} activeTaskPct={taskByGroup} days={period} />)}
        </div>
      )}

      <p className="text-slate-500 text-xs">
        {t('footnote', { days: period })}
      </p>
    </div>
  )
}
