import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'
import {
  LayoutDashboard, GraduationCap, Users, BookOpen, ClipboardList, CalendarDays, Bell, Inbox,
  LogOut, ArrowLeftRight, UserRound, Sparkles, Archive, PlayCircle, Clock, CheckCircle2, Circle,
} from 'lucide-react'
import { LOCALES, toLocale, type Locale } from '@/i18n/config'
import { ScopedIntlProvider } from '@/i18n/provider'
import {
  DEMO_ROLE_PAGES, SOLUTION_SLUGS, localizedPath, marketingAlternates, roleTourPath,
  type DemoInstitutionType, type DemoRole, type RoleTourBase,
} from '@/i18n/public-routes'
import { getDemoData } from '@/lib/demo/data'
import { getTerms, type Terms } from '@/lib/terminology'
import { getRoleLabel } from '@/lib/utils'
import { withSamples } from '@/components/public/solution-props'
import { BrandMark } from '@/components/shared/brand-mark'
import { APP_NAME } from '@/lib/brand'
import { RoleTourControls } from './role-tour-client'
import type enPublic from '@/messages/en/public.json'

// A role tour: one role's dashboard and sidebar pages, for one institution
// type, rendered from the demo fixtures (src/lib/demo/data.ts) relabelled with
// that type's sample names (public.solutions.types.<type>.samples) and its
// vocabulary (getTerms). Served at /demo/<role>/… (university) and at
// /solutions/<slug>/<role>/…; both route trees call RoleTourPage. Server
// rendered, no cookies, no session: the page is edge cacheable.

type Samples = typeof enPublic.solutions.types.school.samples
const DB_ROLE = { student: 'student', teacher: 'teacher', admin: 'university_admin', center: 'center_manager' } as const
const PROGRESS = [62, 40, 85, 20]
const ICON = {
  '': LayoutDashboard, courses: BookOpen, exams: ClipboardList, grades: GraduationCap, schedule: CalendarDays,
  groups: Users, requests: Inbox, teachers: UserRound, students: GraduationCap, schedules: CalendarDays, announcements: Bell,
} as const

function dateCell(v: string) {
  return <Date_ key="d" v={v} />
}

/** A date followed by a duration label, for list rows. */
function dateDuration(v: string, minutes: string) {
  return <><Date_ v={v} /> · {minutes}</>
}

export function tourBase(type: DemoInstitutionType, fromDemo: boolean): RoleTourBase {
  return fromDemo ? '/demo' : `/solutions/${SOLUTION_SLUGS[type]}`
}

function parse(role: string, page: string[] | undefined): { role: DemoRole; page: string } {
  if (!(role in DEMO_ROLE_PAGES)) notFound()
  const r = role as DemoRole
  const p = page?.join('/') ?? ''
  if (!(DEMO_ROLE_PAGES[r] as readonly string[]).includes(p)) notFound()
  return { role: r, page: p }
}

async function tourData(type: DemoInstitutionType, locale: Locale) {
  const raw = getDemoData(locale)
  const pub = await getTranslations('public')
  const d = type === 'university' ? raw : withSamples(raw, pub.raw(`solutions.types.${type}.samples`) as Samples)
  const groupNames = d.teacherGroups.map(g => g.name)
  const teachers = d.teachers.map((x, i) => ({ ...x, subject: type === 'university' ? x.subject : d.courses[i % d.courses.length].title }))
  const students = d.students.map((s, i) => ({ ...s, group: type === 'university' ? s.group : groupNames[i % groupNames.length] }))
  const tenant = type === 'university' ? d.tenant.name : (pub.raw('demo.tour.tenants') as Record<string, string>)[type]
  const courses = d.courses.map((c, i) => ({ ...c, teacher: teachers[i % teachers.length].name, progress: PROGRESS[i], students: [74, 51, 48, 29][i] }))
  const groups = d.teacherGroups.map((g, i) => ({ ...g, course: courses[i % courses.length].title, teacher: teachers[i % teachers.length].name, avg: [86, 81, 89][i] }))
  return { ...d, teachers, students, tenant, courses, groups }
}
type Data = Awaited<ReturnType<typeof tourData>>
type T = Awaited<ReturnType<typeof getTranslations<'public.demo.tour'>>>
type Days = Awaited<ReturnType<typeof getTranslations<'common.days'>>>

// ── Building blocks (tokens only) ─────────────────────────────────────────

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-surface p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h3 className="text-fg font-semibold">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

function Stat({ label, value, icon: Icon }: { label: string; value: string | number; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-fg-2 text-sm">{label}</p>
        <span className="p-2 rounded-md bg-accent-subtle text-accent"><Icon className="w-4 h-4" /></span>
      </div>
      <p className="text-fg text-3xl font-bold mt-3 tabular-nums">{value}</p>
    </div>
  )
}

function Pill({ tone, children }: { tone: 'ok' | 'wait' | 'muted' | 'info'; children: React.ReactNode }) {
  const cls = { ok: 'bg-success-subtle text-success', wait: 'bg-warning-subtle text-warning', muted: 'bg-elevated text-fg-2', info: 'bg-accent-subtle text-accent' }[tone]
  return <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${cls}`}>{children}</span>
}

function Bar({ pct }: { pct: number }) {
  return (
    <div className="h-1.5 rounded-full bg-elevated overflow-hidden">
      <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
    </div>
  )
}

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line bg-canvas">
            {head.map(h => <th key={h} className="px-4 py-3 text-start text-fg-3 text-xs font-semibold whitespace-nowrap">{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={`px-4 py-3 ${j === 0 ? 'text-fg font-medium' : 'text-fg-2'}`}>{c}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  )
}

function Rows({ items }: { items: { key: string; main: React.ReactNode; side?: React.ReactNode; sub?: React.ReactNode }[] }) {
  return (
    <ul className="divide-y divide-line">
      {items.map(it => (
        <li key={it.key} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
          <div className="min-w-0">
            <p className="text-fg text-sm font-medium">{it.main}</p>
            {it.sub && <p className="text-fg-3 text-xs mt-1">{it.sub}</p>}
          </div>
          {it.side && <div className="shrink-0 text-sm text-fg-2">{it.side}</div>}
        </li>
      ))}
    </ul>
  )
}

function Title({ title, sub }: { title: string; sub?: string }) {
  return (
    <div>
      <h2 className="text-2xl font-bold text-fg">{title}</h2>
      {sub && <p className="text-fg-2 mt-1">{sub}</p>}
    </div>
  )
}

const Date_ = ({ v }: { v: string }) => <span dir="ltr" className="tabular-nums">{v}</span>

function WeekTable({ d, t, days }: { d: Data; t: T; days: Days }) {
  return <Table head={[t('col.day'), t('col.sessions')]} rows={d.schedule.map(r => [days(String(r.day) as '0'), r.slots.join(' · ')])} />
}

function WeekList({ d, days, limit = 5 }: { d: Data; days: Days; limit?: number }) {
  return (
    <Rows items={d.schedule.slice(0, limit).map(r => ({ key: String(r.day), main: days(String(r.day) as '0'), sub: r.slots.join(' · ') }))} />
  )
}

function Announcements({ d }: { d: Data }) {
  return <Rows items={d.announcements.map(a => ({ key: a.id, main: a.title, sub: <>{a.body} · <Date_ v={a.date} /></> }))} />
}

function RequestRows({ d, t }: { d: Data; t: T }) {
  return (
    <Rows items={d.requests.map(r => ({
      key: r.id, main: r.subject, sub: <>{t('col.from')} {r.from}</>,
      side: <Pill tone={r.status === 'answered' ? 'ok' : 'wait'}>{t(`st.${r.status}`)}</Pill>,
    }))} />
  )
}

// ── Student ───────────────────────────────────────────────────────────────

function StudentPage({ page, d, t, terms, days, role, link }: P) {
  const me = d.students[0]
  const enrolled = d.courses.filter(c => c.published)
  if (page === 'courses') return (
    <div className="space-y-6">
      <Title title={t('student.coursesTitle')} />
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {enrolled.map(c => (
          <Card key={c.id} title={c.title}>
            <p className="text-fg-2 text-sm">{c.level} · {c.teacher}</p>
            <p className="text-fg-3 text-xs mt-1">{t('student.unitOf', { n: Math.max(1, Math.round((c.units * c.progress) / 100)), total: c.units })}</p>
            <div className="mt-4"><Bar pct={c.progress} /></div>
            <p className="text-fg-3 text-xs mt-2">{t('student.progress', { pct: c.progress })}</p>
          </Card>
        ))}
      </div>
    </div>
  )
  if (page === 'exams') return (
    <div className="space-y-6">
      <Title title={t('student.examsTitle')} sub={t('student.serverTimed')} />
      <Table head={[t('col.exam'), t('col.date'), t('col.duration'), t('col.status')]} rows={d.exams.map(e => [
        e.title, dateCell(e.date), t('minutes', { count: e.duration }),
        e.status === 'graded' ? <Pill key="s" tone="ok">{t('st.graded')} · <span dir="ltr">{e.score} / {e.outOf}</span></Pill> : <Pill key="s" tone="wait">{t('student.opens')}</Pill>,
      ])} />
    </div>
  )
  if (page === 'grades') return (
    <div className="space-y-6">
      <Title title={t('student.gradesTitle')} sub={`${t('student.average')} ${me.avgGrade}%`} />
      <Table head={[t('col.exam'), t('col.score'), t('col.percent')]} rows={d.grades.map(g => {
        const pct = Math.round((g.score / g.outOf) * 100)
        return [g.exam, <span key="s" dir="ltr" className="tabular-nums">{g.score} / {g.outOf}</span>, <div key="p" className="min-w-32"><span className="tabular-nums">{pct}%</span><div className="mt-1"><Bar pct={pct} /></div></div>]
      })} />
    </div>
  )
  if (page === 'schedule') return (
    <div className="space-y-6">
      <Title title={t('student.scheduleTitle')} sub={me.group} />
      <WeekTable d={d} t={t} days={days} />
    </div>
  )
  const current = enrolled[0]
  return (
    <div className="space-y-6">
      <Title title={t('dashTitle', { role })} sub={`${me.name} · ${me.group}`} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label={t('student.enrolled')} value={enrolled.length} icon={BookOpen} />
        <Stat label={t('student.upcoming')} value={d.upcomingExams.length} icon={ClipboardList} />
        <Stat label={t('student.average')} value={`${me.avgGrade}%`} icon={GraduationCap} />
        <Stat label={t('student.attendance')} value="94%" icon={CheckCircle2} />
      </div>
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <Card title={t('student.continue')}>
            <p className="text-fg font-semibold">{current.title}</p>
            <p className="text-fg-2 text-sm mt-1">{current.level} · {current.teacher} · {t('student.unitOf', { n: 4, total: current.units })}</p>
            <div className="mt-4"><Bar pct={current.progress} /></div>
            <div className="mt-4 flex items-center justify-between gap-3">
              <span className="text-fg-3 text-xs">{t('student.progress', { pct: current.progress })}</span>
              <Link href={link('courses')} className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-accent hover:bg-accent-hover text-on-accent text-sm font-semibold">
                <PlayCircle className="w-4 h-4" />{t('student.resume')}
              </Link>
            </div>
          </Card>
        </div>
        <Card title={t('student.upcoming')}>
          <Rows items={d.upcomingExams.map(e => ({ key: e.id, main: e.title, sub: dateDuration(e.date, t('minutes', { count: e.duration })), side: <Pill tone="wait">{t('st.upcoming')}</Pill> }))} />
          <p className="text-fg-3 text-xs mt-4 flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" />{t('student.serverTimed')}</p>
        </Card>
      </div>
      <div className="grid lg:grid-cols-3 gap-4">
        <Card title={t('student.weekly')}><WeekList d={d} days={days} limit={3} /></Card>
        <Card title={t('student.recentGrades')} action={<Link href={link('grades')} className="text-accent text-xs font-semibold hover:underline">{t('student.allGrades')}</Link>}>
          <Rows items={d.grades.map(g => ({ key: g.exam, main: g.exam, side: <span dir="ltr" className="tabular-nums">{g.score} / {g.outOf}</span> }))} />
        </Card>
        <Card title={t('student.announcements')}><Announcements d={d} /></Card>
      </div>
      <p className="text-fg-3 text-xs">{terms.institution} · {terms.term}</p>
    </div>
  )
}

// ── Teacher ───────────────────────────────────────────────────────────────

function TeacherPage({ page, d, t, terms, days, role }: P) {
  const me = d.teachers[0]
  const toGrade = 12
  if (page === 'groups') return (
    <div className="space-y-6">
      <Title title={t('teacher.groups', { groups: terms.groups })} />
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {d.groups.map((g, i) => (
          <Card key={g.name} title={g.name} action={<Pill tone="info">{g.count}</Pill>}>
            <p className="text-fg-2 text-sm">{g.course}</p>
            <p className="text-fg-3 text-xs mt-1">{t('teacher.nextSession')} · {days(String(i) as '0')} · {d.schedule[i]?.slots[0]}</p>
            <div className="mt-4"><Bar pct={g.avg} /></div>
            <p className="text-fg-3 text-xs mt-2">{t('teacher.groupAvg', { pct: g.avg })}</p>
            <ul className="mt-4 flex flex-wrap gap-1.5">
              {d.students.filter(s => s.group === g.name).map(s => <li key={s.id}><Pill tone="muted">{s.name}</Pill></li>)}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  )
  if (page === 'exams') return (
    <div className="space-y-6">
      <Title title={t('teacher.examsTitle')} sub={t('student.serverTimed')} />
      <Table head={[t('col.exam'), t('col.date'), t('col.duration'), t('col.submissions'), t('col.status')]} rows={d.exams.map(e => [
        e.title, dateCell(e.date), t('minutes', { count: e.duration }), <span key="n" className="tabular-nums">{e.submissions}</span>,
        <Pill key="s" tone={e.status === 'graded' ? 'ok' : 'wait'}>{t(`st.${e.status}`)}</Pill>,
      ])} />
      <Card title={t('teacher.recentSubs')}>
        <Rows items={d.students.map((s, i) => ({ key: s.id, main: s.name, sub: `${s.group} · ${d.exams[0].title}`, side: i < 2 ? <Pill tone="wait">{t('st.awaiting')}</Pill> : <span dir="ltr" className="tabular-nums">{Math.round(s.avgGrade / 2)} / 50</span> }))} />
      </Card>
    </div>
  )
  if (page === 'requests') return (
    <div className="space-y-6">
      <Title title={t('teacher.requestsTitle')} />
      <Card title={t('teacher.inbox')}><RequestRows d={d} t={t} /></Card>
      <Card title={t('student.announcements')}><Announcements d={d} /></Card>
    </div>
  )
  if (page === 'schedule') return (
    <div className="space-y-6">
      <Title title={t('teacher.scheduleTitle')} sub={me.name} />
      <WeekTable d={d} t={t} days={days} />
    </div>
  )
  const members = d.groups.reduce((n, g) => n + g.count, 0)
  return (
    <div className="space-y-6">
      <Title title={t('dashTitle', { role })} sub={`${me.name} · ${me.subject}`} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label={t('teacher.groups', { groups: terms.groups })} value={d.groups.length} icon={Users} />
        <Stat label={t('teacher.members', { groups: terms.groups })} value={members} icon={GraduationCap} />
        <Stat label={t('teacher.lessons')} value={18} icon={BookOpen} />
        <Stat label={t('teacher.toGrade')} value={toGrade} icon={ClipboardList} />
      </div>
      <div className="grid lg:grid-cols-3 gap-4">
        <Card title={t('teacher.groups', { groups: terms.groups })}>
          <Rows items={d.groups.map(g => ({ key: g.name, main: g.name, sub: g.course, side: <Pill tone="info">{g.count}</Pill> }))} />
        </Card>
        <Card title={t('teacher.upcoming')}>
          <Rows items={d.exams.map(e => ({ key: e.id, main: e.title, sub: dateDuration(e.date, t('minutes', { count: e.duration })), side: <Pill tone={e.status === 'graded' ? 'ok' : 'wait'}>{t(`st.${e.status}`)}</Pill> }))} />
        </Card>
        <Card title={t('teacher.inbox')}><RequestRows d={d} t={t} /></Card>
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <Card title={t('teacher.recentSubs')}>
          <Rows items={d.students.slice(0, 4).map((s, i) => ({ key: s.id, main: s.name, sub: d.exams[0].title, side: i < 2 ? <Pill tone="wait">{t('st.awaiting')}</Pill> : <span dir="ltr" className="tabular-nums">{Math.round(s.avgGrade / 2)} / 50</span> }))} />
        </Card>
        <Card title={t('teacher.today')}><WeekList d={d} days={days} limit={4} /></Card>
      </div>
    </div>
  )
}

// ── Institution administrator ─────────────────────────────────────────────

function AdminPage({ page, d, t, terms, role }: P) {
  if (page === 'courses') return (
    <div className="space-y-6">
      <Title title={t('admin.courses')} />
      <Table head={[t('col.course'), t('col.level'), t('col.teacher'), t('col.units'), t('col.students'), t('col.status')]} rows={d.courses.map(c => [
        c.title, c.level, c.teacher, <span key="u" className="tabular-nums">{c.units}</span>, <span key="n" className="tabular-nums">{c.students}</span>,
        <Pill key="s" tone={c.published ? 'ok' : 'muted'}>{c.published ? t('st.published') : t('st.draft')}</Pill>,
      ])} />
    </div>
  )
  if (page === 'teachers') return (
    <div className="space-y-6">
      <Title title={t('admin.teachers')} />
      <Table head={[t('col.name'), t('col.subject'), terms.groups, t('col.students')]} rows={d.teachers.map(x => [
        x.name, x.subject, <span key="g" className="tabular-nums">{x.groups}</span>, <span key="s" className="tabular-nums">{x.students}</span>,
      ])} />
    </div>
  )
  if (page === 'students') return (
    <div className="space-y-6">
      <Title title={terms.institutionStudents} sub={`${d.stats.students}`} />
      <Table head={[t('col.name'), terms.group, t('col.average')]} rows={d.students.map(s => [
        s.name, s.group, <div key="a" className="min-w-32"><span className="tabular-nums">{s.avgGrade}%</span><div className="mt-1"><Bar pct={s.avgGrade} /></div></div>,
      ])} />
    </div>
  )
  if (page === 'groups') return (
    <div className="space-y-6">
      <Title title={terms.groups} />
      <Table head={[terms.group, t('col.course'), t('col.teacher'), t('col.students'), t('col.average')]} rows={d.groups.map(g => [
        g.name, g.course, g.teacher, <span key="n" className="tabular-nums">{g.count}</span>, <span key="a" className="tabular-nums">{g.avg}%</span>,
      ])} />
    </div>
  )
  const graded = d.exams.find(e => e.status === 'graded')
  const activity = [
    t('admin.act1', { name: d.teachers[0].name, course: d.courses[0].title }),
    t('admin.act2', { name: d.teachers[1].name, exam: d.exams[1].title }),
    t('admin.act3', { count: 12 }),
    t('admin.act4', { exam: graded?.title ?? d.exams[0].title }),
  ]
  return (
    <div className="space-y-6">
      <Title title={t('dashTitle', { role })} sub={d.tenant} />
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Stat label={t('admin.teachers')} value={d.stats.teachers} icon={UserRound} />
        <Stat label={terms.institutionStudents} value={d.stats.students} icon={GraduationCap} />
        <Stat label={t('admin.courses')} value={d.stats.courses} icon={BookOpen} />
        <Stat label={terms.groups} value={9} icon={Users} />
        <Stat label={t('admin.exams')} value={d.stats.exams} icon={ClipboardList} />
      </div>
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <Card title={t('admin.latestCourses')}>
            <Rows items={d.courses.map(c => ({ key: c.id, main: c.title, sub: `${c.level} · ${c.teacher}`, side: <Pill tone={c.published ? 'ok' : 'muted'}>{c.published ? t('st.published') : t('st.draft')}</Pill> }))} />
          </Card>
        </div>
        <Card title={t('admin.ai')}>
          <div className="flex items-center gap-2 text-accent"><Sparkles className="w-4 h-4" /><span className="text-fg text-2xl font-bold tabular-nums">48%</span></div>
          <div className="mt-3"><Bar pct={48} /></div>
          <p className="text-fg-3 text-xs mt-2">{t('admin.aiUsed', { pct: 48 })}</p>
          <Rows items={[
            { key: 'l', main: t('admin.aiLessons'), side: <span className="tabular-nums">36</span> },
            { key: 'q', main: t('admin.aiQuestions'), side: <span className="tabular-nums">412</span> },
          ]} />
        </Card>
      </div>
      <div className="grid lg:grid-cols-3 gap-4">
        <Card title={t('admin.activity')}>
          <Rows items={activity.map((a, i) => ({ key: String(i), main: a, sub: <Date_ v={d.announcements[i % 2].date} /> }))} />
        </Card>
        <Card title={t('admin.topStudents')}>
          <Rows items={[...d.students].sort((a, b) => b.avgGrade - a.avgGrade).slice(0, 4).map(s => ({ key: s.id, main: s.name, sub: s.group, side: <span className="tabular-nums">{s.avgGrade}%</span> }))} />
        </Card>
        <Card title={t('admin.archive')}>
          <div className="flex items-start gap-3">
            <span className="p-2 rounded-md bg-elevated text-fg-2"><Archive className="w-4 h-4" /></span>
            <p className="text-fg-2 text-sm leading-relaxed">{t('admin.archiveDesc', { terms: terms.terms })}</p>
          </div>
          <p className="text-fg mt-4 text-sm"><span className="text-2xl font-bold tabular-nums">4</span> {t('admin.archiveCount', { terms: terms.terms })}</p>
        </Card>
      </div>
    </div>
  )
}

// ── Centre manager ────────────────────────────────────────────────────────

function CenterPage({ page, d, t, terms, days, role }: P) {
  const perms = [
    { key: 'p1', label: t('center.perm1', { groups: terms.groups }), on: true },
    { key: 'p2', label: t('center.perm2'), on: true },
    { key: 'p3', label: t('center.perm3'), on: true },
    { key: 'p4', label: t('center.perm4', { institution: terms.institution }), on: false },
  ]
  if (page === 'groups') return (
    <div className="space-y-6">
      <Title title={t('center.groups', { groups: terms.groups })} />
      <Table head={[terms.group, t('col.course'), t('col.teacher'), t('col.students'), t('col.status')]} rows={d.groups.map(g => [
        g.name, g.course, g.teacher, <span key="n" className="tabular-nums">{g.count}</span>, <Pill key="s" tone="ok">{t('st.active')}</Pill>,
      ])} />
    </div>
  )
  if (page === 'schedules') return (
    <div className="space-y-6">
      <Title title={t('center.weekly')} />
      <div className="grid lg:grid-cols-2 gap-4">
        {d.groups.slice(0, 2).map(g => <Card key={g.name} title={g.name}><WeekList d={d} days={days} /></Card>)}
      </div>
    </div>
  )
  if (page === 'announcements') return (
    <div className="space-y-6">
      <Title title={t('center.announcements')} />
      <Table head={[t('col.subject'), t('col.audience'), t('col.date')]} rows={d.announcements.map((a, i) => [
        <div key="t"><p>{a.title}</p><p className="text-fg-3 text-xs font-normal mt-1">{a.body}</p></div>,
        i === 0 ? t('center.audienceCentre') : t('center.audienceAll', { institution: terms.institution }), <Date_ key="d" v={a.date} />,
      ])} />
    </div>
  )
  if (page === 'requests') return (
    <div className="space-y-6">
      <Title title={t('center.staffRequests')} />
      <Card title={t('center.staffRequests')}><RequestRows d={d} t={t} /></Card>
    </div>
  )
  return (
    <div className="space-y-6">
      <Title title={t('dashTitle', { role })} sub={d.tenant} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label={t('center.groups', { groups: terms.groups })} value={d.groups.length} icon={Users} />
        <Stat label={t('center.schedules')} value={5} icon={CalendarDays} />
        <Stat label={t('center.announcements')} value={d.announcements.length} icon={Bell} />
        <Stat label={t('center.openRequests')} value={d.requests.filter(r => r.status === 'pending').length} icon={Inbox} />
      </div>
      <div className="grid lg:grid-cols-3 gap-4">
        <Card title={t('center.groups', { groups: terms.groups })}>
          <Rows items={d.groups.map(g => ({ key: g.name, main: g.name, sub: `${g.course} · ${g.teacher}`, side: <Pill tone="info">{g.count}</Pill> }))} />
        </Card>
        <Card title={t('center.staffRequests')}><RequestRows d={d} t={t} /></Card>
        <Card title={t('center.permissions')}>
          <ul className="space-y-3">
            {perms.map(p => (
              <li key={p.key} className="flex items-start gap-2.5 text-sm">
                {p.on ? <CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-0.5" /> : <Circle className="w-4 h-4 text-fg-3 shrink-0 mt-0.5" />}
                <span className={p.on ? 'text-fg' : 'text-fg-3'}>{p.label}</span>
                <span className="sr-only">{p.on ? t('st.granted') : t('st.notGranted')}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <Card title={t('center.weekly')}><WeekList d={d} days={days} limit={4} /></Card>
        <Card title={t('center.announcements')}><Announcements d={d} /></Card>
      </div>
    </div>
  )
}

type P = { page: string; d: Data; t: T; terms: Terms; days: Days; role: string; link: (page: string) => string }
const PAGES = { student: StudentPage, teacher: TeacherPage, admin: AdminPage, center: CenterPage }

// ── Page + metadata ───────────────────────────────────────────────────────

type Params = Promise<{ role: string; page?: string[] }>

export async function roleTourMetadata(type: DemoInstitutionType, fromDemo: boolean, params: Params): Promise<Metadata> {
  const p = await params
  const { role, page } = parse(p.role, p.page)
  const locale = toLocale(await getLocale())
  const t = await getTranslations('public.demo.tour')
  const label = getRoleLabel(DB_ROLE[role], type, locale)
  const d = await tourData(type, locale)
  return {
    title: t('metaTitle', { role: label, institution: d.tenant }),
    description: t('metaDesc', { role: label, institution: d.tenant }),
    alternates: marketingAlternates(roleTourPath(tourBase(type, fromDemo), role, page), locale),
  }
}

export async function RoleTourPage({ type, fromDemo, params }: { type: DemoInstitutionType; fromDemo: boolean; params: Params }) {
  const p = await params
  const { role, page } = parse(p.role, p.page)
  const locale = toLocale(await getLocale())
  const [t, demo, nav, days, d] = await Promise.all([
    getTranslations('public.demo.tour'), getTranslations('public.demo'), getTranslations('public.demo.nav'),
    getTranslations('common.days'), tourData(type, locale),
  ])
  const terms = getTerms(type, locale)
  const roleLabel = getRoleLabel(DB_ROLE[role], type, locale)
  const base = tourBase(type, fromDemo)
  const link = (pg: string) => localizedPath(locale, roleTourPath(base, role, pg))
  const hrefs = Object.fromEntries(LOCALES.map(l => [l, localizedPath(l, roleTourPath(base, role, page))])) as Record<Locale, string>
  const back = localizedPath(locale, fromDemo ? '/demo' : base as `/solutions/${(typeof SOLUTION_SLUGS)[DemoInstitutionType]}`)

  const label = (pg: string): string => {
    switch (pg) {
      case '': return nav('dashboard')
      case 'groups': return terms.groups
      case 'students': return terms.institutionStudents
      case 'teachers': return t('nav.teachers')
      case 'schedule': return t('nav.schedule')
      case 'requests': return t('nav.requests')
      default: return nav(pg as 'courses')
    }
  }
  const Body = PAGES[role]

  return (
    <ScopedIntlProvider namespaces={['common']}>
      <div className="eq-public min-h-screen bg-canvas text-fg lg:flex">
        <aside className="lg:w-72 lg:shrink-0 lg:sticky lg:top-0 lg:h-screen flex flex-col bg-surface border-b lg:border-b-0 lg:border-e border-line">
          <div className="p-4 flex lg:block items-center justify-between gap-3">
            <Link href={localizedPath(locale, '/')} dir="ltr" className="eq-brand flex items-center gap-2.5">
              <BrandMark size={36} />
              <span className="eq-wordmark font-bold text-lg">{APP_NAME}</span>
            </Link>
            <div className="lg:mt-5 min-w-0 rounded-lg border border-line bg-canvas px-4 py-3">
              <p className="text-fg text-sm font-semibold truncate">{d.tenant}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="text-fg-2 text-xs truncate">{roleLabel}</span>
                <Pill tone="wait">{demo('shell.demoMode')}</Pill>
              </div>
            </div>
          </div>
          <nav className="flex-1 px-3 pb-3 lg:pb-0">
            <ul className="flex lg:flex-col gap-1 overflow-x-auto [scrollbar-width:none]">
              {DEMO_ROLE_PAGES[role].map(pg => {
                const Icon = ICON[pg]
                const active = pg === page
                return (
                  <li key={pg} className="shrink-0">
                    <Link
                      href={link(pg)}
                      aria-current={active ? 'page' : undefined}
                      className={`flex items-center gap-3 px-3.5 py-2.5 rounded-md transition-colors whitespace-nowrap ${active ? 'bg-accent text-on-accent' : 'text-fg-2 hover:text-fg hover:bg-elevated'}`}
                    >
                      <Icon className="w-5 h-5 shrink-0" />
                      <span className="text-sm font-medium">{label(pg)}</span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </nav>
          <div className="hidden lg:block p-3 border-t border-line space-y-1">
            <Link href={back} className="flex items-center gap-3 px-3.5 py-2.5 rounded-md text-fg-2 hover:text-fg hover:bg-elevated transition-colors">
              <ArrowLeftRight className="w-5 h-5 shrink-0" /><span className="text-sm font-medium">{demo('shell.tryAnother')}</span>
            </Link>
            <Link href={localizedPath(locale, '/')} className="flex items-center gap-3 px-3.5 py-2.5 rounded-md text-fg-2 hover:text-danger hover:bg-danger-subtle transition-colors">
              <LogOut className="w-5 h-5 shrink-0" /><span className="text-sm font-medium">{demo('shell.exit')}</span>
            </Link>
          </div>
        </aside>
        <div className="flex-1 min-w-0">
          <header className="sticky top-0 z-20 min-h-16 border-b border-line bg-canvas flex flex-wrap items-center justify-between gap-3 px-4 lg:px-8 py-3">
            <p className="flex items-center gap-2.5 text-fg-2 text-sm">
              <span aria-hidden="true" className="w-2 h-2 rounded-full bg-warning shrink-0" />
              <span>
                {demo('shell.banner')}{' '}
                <Link href={localizedPath(locale, '/contact')} className="text-accent hover:text-accent-hover underline underline-offset-4">{demo('shell.bannerContact')}</Link>{' '}
                {demo('shell.bannerEnd')}
              </span>
            </p>
            <div className="flex items-center gap-2">
              <Link href={back} className="lg:hidden px-3 py-1.5 rounded-full border border-line-strong text-fg-2 text-xs hover:text-fg">{demo('shell.tryAnother')}</Link>
              <RoleTourControls locale={locale} hrefs={hrefs} />
            </div>
          </header>
          <main className="p-4 sm:p-6 lg:p-8 max-w-[88rem]">
            <Body page={page} d={d} t={t} terms={terms} days={days} role={roleLabel} link={link} />
          </main>
        </div>
      </div>
    </ScopedIntlProvider>
  )
}
