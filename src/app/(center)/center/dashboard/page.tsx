export const dynamic = 'force-dynamic'

import Link from 'next/link'
import {
  GraduationCap, Users, Layers, BookOpen, ClipboardCheck, TrendingUp, AlertTriangle,
  CalendarDays, Megaphone, ShieldCheck, Inbox,
} from 'lucide-react'
import { loadCenterAccess } from '@/lib/center-access'
import { CAPABILITIES } from '@/lib/permissions'
import { getTranslations, getLocale } from 'next-intl/server'

// Centre dashboard. Every number comes from ONE call to the
// get_center_dashboard() RPC, which aggregates in Postgres and returns
// counts/rates only (no student-level content), scoped to the caller's
// tenant from auth.uid(). Nothing is cached or stored separately.

interface Dashboard {
  generated_at: string
  period_days: number
  people: { teachers: number; active_teachers: number; students: number; active_students: number; new_students: number; students_without_group: number }
  groups: { active: number; archived: number; avg_size: number }
  learning: { courses: number; published_courses: number; enrollments: number; avg_progress: number; completed: number; active_learners: number; at_risk: number }
  assessments: { graded: number; avg_pct: number; pass_rate: number; submissions: number; flagged: number }
  attendance: { sessions: number; records: number; present: number; late: number; absent: number; excused: number; rate: number; chronic_absentees: number }
  group_rows: { id: string; name: string; teacher: string | null; students: number; sessions: number; attendance_rate: number | null; avg_pct: number | null }[]
  teacher_rows: { id: string; name: string; is_active: boolean; groups: number; students: number; courses: number; weekly_hours: number | null; avg_pct: number | null }[]
  trend: { week: string; new_students: number; submissions: number; completed_items: number; attendance_rate: number | null }[]
  schedule: { schedules: number; published_schedules: number; groups_without_schedule: number; weekly_slots: number; weekly_hours: number; teacher_conflicts: number }
  engagement: { announcements_live: number; announcements_scheduled: number; survey_responses: number; survey_ease_avg: number | null; survey_recommend_pct: number | null; open_requests: number; pending_appeals: number }
}

const PERIODS = [7, 30, 90, 180]

function pct(v: number | null | undefined) {
  return v === null || v === undefined ? '—' : `${v}%`
}

function rateTone(v: number | null) {
  if (v === null) return 'text-slate-500'
  if (v >= 85) return 'text-emerald-400'
  if (v >= 70) return 'text-amber-400'
  return 'text-rose-400'
}

function Tile({ label, value, sub, icon: Icon, tone }: {
  label: string; value: string | number; sub?: string; icon: typeof Users; tone: string
}) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-slate-400 text-sm">{label}</p>
        <Icon className={`w-4 h-4 ${tone}`} />
      </div>
      <p className="text-2xl font-bold text-white tabular-nums">{value}</p>
      {sub && <p className="text-slate-500 text-xs mt-1">{sub}</p>}
    </div>
  )
}

/** Small multiple: one metric per week as bars, labelled with its latest value. */
function TrendBars({ title, ariaLabel, points, suffix = '' }: { title: string; ariaLabel: string; points: { week: string; v: number | null }[]; suffix?: string }) {
  const max = Math.max(1, ...points.map(p => p.v ?? 0))
  const last = points[points.length - 1]?.v
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
      <div className="flex items-baseline justify-between mb-3">
        <p className="text-slate-400 text-sm">{title}</p>
        <p className="text-white font-semibold tabular-nums">{last === null || last === undefined ? '—' : `${last}${suffix}`}</p>
      </div>
      <div className="flex items-end gap-1.5 h-20" role="img" aria-label={ariaLabel}>
        {points.map(p => (
          <div key={p.week} className="flex-1 h-full flex items-end" title={`${p.week}: ${p.v ?? '—'}${suffix}`}>
            <div
              className={`w-full rounded-t ${p.v === null ? 'bg-slate-800' : 'bg-blue-500/70'}`}
              style={{ height: `${p.v === null ? 4 : Math.max(4, (p.v / max) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-slate-600 mt-1.5" dir="ltr">
        <span>{points[0]?.week.slice(5)}</span>
        <span>{points[points.length - 1]?.week.slice(5)}</span>
      </div>
    </div>
  )
}

export default async function CenterDashboard({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const t = await getTranslations('center.dashboard')
  const tStaff = await getTranslations('staff')
  const locale = await getLocale()
  const { supabase, perms, has } = await loadCenterAccess()
  const granted = CAPABILITIES.filter(c => perms[c])
  const sp = await searchParams
  const days = PERIODS.includes(Number(sp.days)) ? Number(sp.days) : 30

  const capabilityCard = (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
      <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-blue-400" /> {t('yourCapabilities')}
      </h3>
      {granted.length === 0 ? (
        <p className="text-slate-500 text-sm">{t('noCapabilities')}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {granted.map(c => (
            <span key={c} className="text-xs px-2.5 py-1 rounded-full bg-blue-600/15 text-blue-300 border border-blue-600/30">
              {tStaff(`capabilities.${c}.label`)}
            </span>
          ))}
        </div>
      )}
    </div>
  )

  if (!has('view_reports')) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-white">{t('title')}</h2>
          <p className="text-slate-400 mt-1">{t('needsReports')}</p>
        </div>
        {capabilityCard}
      </div>
    )
  }

  const { data, error } = await supabase.rpc('get_center_dashboard', { p_days: days })
  if (error || !data) {
    console.error('[center/dashboard]', error)
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-white">{t('title')}</h2>
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-5 text-amber-300 text-sm">
          {t('loadFailed')} <code dir="ltr">attendance_migration.sql</code> {t('loadFailedThen')}
          <code dir="ltr"> center_dashboard_migration.sql</code> {t('loadFailedEnd')}
        </div>
        {capabilityCard}
      </div>
    )
  }

  const d = data as Dashboard
  const attentionGroups = d.group_rows
    .filter(g => g.students === 0 || (g.attendance_rate !== null && g.attendance_rate < 75) || (g.avg_pct !== null && g.avg_pct < 50))
    .slice(0, 8)

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-white">{t('title')}</h2>
          <p className="text-slate-400 mt-1">
            {t('generated', { days: d.period_days, at: new Date(d.generated_at).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) })}
          </p>
        </div>
        <nav className="flex gap-1 bg-slate-900 border border-slate-800 rounded-lg p-1" aria-label={t('periodNav')}>
          {PERIODS.map(p => (
            <Link key={p} href={`?days=${p}`} scroll={false}
              className={`px-3 py-1.5 rounded-md text-sm ${p === days ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}>
              {t('periodDays', { days: p })}
            </Link>
          ))}
        </nav>
      </div>

      {/* Headline KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Tile label={t('tiles.activeStudents')} value={d.people.active_students} icon={Users} tone="text-emerald-400"
          sub={t('tiles.activeStudentsSub', { new: d.people.new_students, without: d.people.students_without_group })} />
        <Tile label={t('tiles.attendanceRate')} value={pct(d.attendance.rate)} icon={ClipboardCheck} tone="text-blue-400"
          sub={t('tiles.attendanceRateSub', { sessions: d.attendance.sessions, chronic: d.attendance.chronic_absentees })} />
        <Tile label={t('tiles.avgProgress')} value={pct(d.learning.avg_progress)} icon={TrendingUp} tone="text-violet-400"
          sub={t('tiles.avgProgressSub', { completed: d.learning.completed, atRisk: d.learning.at_risk })} />
        <Tile label={t('tiles.avgScores')} value={pct(d.assessments.avg_pct)} icon={GraduationCap} tone="text-amber-400"
          sub={t('tiles.avgScoresSub', { pass: pct(d.assessments.pass_rate), graded: d.assessments.graded })} />
      </div>

      {/* Weekly trends */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <TrendBars title={t('trends.attendance')} ariaLabel={t('trendAria', { title: t('trends.attendance') })} suffix="%" points={d.trend.map(t => ({ week: t.week, v: t.attendance_rate }))} />
        <TrendBars title={t('trends.completed')} ariaLabel={t('trendAria', { title: t('trends.completed') })} points={d.trend.map(t => ({ week: t.week, v: t.completed_items }))} />
        <TrendBars title={t('trends.submissions')} ariaLabel={t('trendAria', { title: t('trends.submissions') })} points={d.trend.map(t => ({ week: t.week, v: t.submissions }))} />
        <TrendBars title={t('trends.newStudents')} ariaLabel={t('trendAria', { title: t('trends.newStudents') })} points={d.trend.map(t => ({ week: t.week, v: t.new_students }))} />
      </div>

      {/* Operations */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Tile label={t('tiles.teachers')} value={d.people.active_teachers} icon={GraduationCap} tone="text-blue-400" sub={t('tiles.teachersSub', { total: d.people.teachers })} />
        <Tile label={t('tiles.activeGroups')} value={d.groups.active} icon={Layers} tone="text-violet-400" sub={t('tiles.activeGroupsSub', { size: d.groups.avg_size })} />
        <Tile label={t('tiles.publishedCourses')} value={d.learning.published_courses} icon={BookOpen} tone="text-emerald-400"
          sub={t('tiles.publishedCoursesSub', { enrollments: d.learning.enrollments, active: d.learning.active_learners })} />
        <Tile label={t('tiles.weeklyHours')} value={d.schedule.weekly_hours} icon={CalendarDays} tone="text-amber-400"
          sub={t('tiles.weeklyHoursSub', { without: d.schedule.groups_without_schedule })} />
      </div>

      {/* Needs attention */}
      {(() => {
        const alerts = [
          d.schedule.teacher_conflicts > 0 && t('attention.conflicts', { count: d.schedule.teacher_conflicts }),
          d.people.students_without_group > 0 && t('attention.withoutGroup', { count: d.people.students_without_group }),
          d.learning.at_risk > 0 && t('attention.atRisk', { count: d.learning.at_risk }),
          d.attendance.chronic_absentees > 0 && t('attention.chronic', { count: d.attendance.chronic_absentees }),
          d.engagement.pending_appeals > 0 && t('attention.appeals', { count: d.engagement.pending_appeals }),
          d.engagement.open_requests > 0 && t('attention.requests', { count: d.engagement.open_requests }),
          d.assessments.flagged > 0 && t('attention.flagged', { count: d.assessments.flagged }),
        ].filter(Boolean) as string[]
        if (alerts.length === 0 && attentionGroups.length === 0) return null
        return (
          <div className="bg-slate-900 border border-amber-500/30 rounded-xl p-5 space-y-3">
            <h3 className="text-white font-semibold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400" /> {t('attention.title')}
            </h3>
            {alerts.length > 0 && (
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm text-slate-300">
                {alerts.map(a => <li key={a} className="flex gap-2"><span className="text-amber-400">•</span>{a}</li>)}
              </ul>
            )}
            {attentionGroups.length > 0 && (
              <p className="text-slate-400 text-sm">
                {t('attention.groups', { names: attentionGroups.map(g => g.name).join(', ') })}
              </p>
            )}
          </div>
        )
      })()}

      {/* Per group */}
      <section className="space-y-2">
        <h3 className="text-white font-semibold">{t('groupsTable.title')}</h3>
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 text-xs">
                <th className="text-start font-medium px-5 py-3">{t('groupsTable.group')}</th>
                <th className="text-start font-medium px-5 py-3">{t('groupsTable.teacher')}</th>
                <th className="text-end font-medium px-5 py-3">{t('groupsTable.students')}</th>
                <th className="text-end font-medium px-5 py-3">{t('groupsTable.attendance')}</th>
                <th className="text-end font-medium px-5 py-3">{t('groupsTable.progress')}</th>
                <th className="text-end font-medium px-5 py-3">{t('groupsTable.lastActivity')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {d.group_rows.length === 0 && <tr><td colSpan={6} className="text-center text-slate-500 py-8">{t('groupsTable.empty')}</td></tr>}
              {d.group_rows.map(g => (
                <tr key={g.id}>
                  <td className="px-5 py-3 text-white">{g.name}</td>
                  <td className="px-5 py-3 text-slate-400">{g.teacher ?? '—'}</td>
                  <td className="px-5 py-3 text-end tabular-nums text-slate-300">{g.students}</td>
                  <td className="px-5 py-3 text-end tabular-nums text-slate-300">{g.sessions}</td>
                  <td className={`px-5 py-3 text-end tabular-nums ${rateTone(g.attendance_rate)}`}>{pct(g.attendance_rate)}</td>
                  <td className={`px-5 py-3 text-end tabular-nums ${rateTone(g.avg_pct === null ? null : g.avg_pct + 15)}`}>{pct(g.avg_pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Per teacher */}
      <section className="space-y-2">
        <h3 className="text-white font-semibold">{t('teachersTable.title')}</h3>
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 text-xs">
                <th className="text-start font-medium px-5 py-3">{t('teachersTable.teacher')}</th>
                <th className="text-end font-medium px-5 py-3">{t('teachersTable.groups')}</th>
                <th className="text-end font-medium px-5 py-3">{t('teachersTable.students')}</th>
                <th className="text-end font-medium px-5 py-3">{t('teachersTable.lessons')}</th>
                <th className="text-end font-medium px-5 py-3">{t('teachersTable.examsGraded')}</th>
                <th className="text-end font-medium px-5 py-3">{t('teachersTable.lastActivity')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {d.teacher_rows.length === 0 && <tr><td colSpan={6} className="text-center text-slate-500 py-8">{t('teachersTable.empty')}</td></tr>}
              {d.teacher_rows.map(t => (
                <tr key={t.id} className={t.is_active ? '' : 'opacity-50'}>
                  <td className="px-5 py-3 text-white">{t.name}</td>
                  <td className="px-5 py-3 text-end tabular-nums text-slate-300">{t.groups}</td>
                  <td className="px-5 py-3 text-end tabular-nums text-slate-300">{t.students}</td>
                  <td className="px-5 py-3 text-end tabular-nums text-slate-300">{t.courses}</td>
                  <td className="px-5 py-3 text-end tabular-nums text-slate-300">{t.weekly_hours ?? '—'}</td>
                  <td className="px-5 py-3 text-end tabular-nums text-slate-300">{pct(t.avg_pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Engagement */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Tile label={t('tiles.liveAnnouncements')} value={d.engagement.announcements_live} icon={Megaphone} tone="text-amber-400"
          sub={t('tiles.liveAnnouncementsSub', { scheduled: d.engagement.announcements_scheduled })} />
        <Tile label={t('tiles.surveyEase')} value={d.engagement.survey_ease_avg === null ? '—' : `${d.engagement.survey_ease_avg}/5`}
          icon={TrendingUp} tone="text-emerald-400"
          sub={t('tiles.surveyEaseSub', { responses: d.engagement.survey_responses, recommend: pct(d.engagement.survey_recommend_pct) })} />
        <Tile label={t('tiles.attendanceRecords')} value={d.attendance.records} icon={ClipboardCheck} tone="text-blue-400"
          sub={t('tiles.attendanceRecordsSub', { present: d.attendance.present, late: d.attendance.late, absent: d.attendance.absent, excused: d.attendance.excused })} />
        <Tile label={t('tiles.openMatters')} value={d.engagement.open_requests + d.engagement.pending_appeals} icon={Inbox} tone="text-rose-400"
          sub={t('tiles.openMattersSub', { requests: d.engagement.open_requests, appeals: d.engagement.pending_appeals })} />
      </div>

      {capabilityCard}
    </div>
  )
}
