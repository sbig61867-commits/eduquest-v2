// ── Study nudges and a short study plan (no AI provider) ──────────
// Pure functions over data the student can already see (their own exam list,
// lessons and announcements, all read through their session). The orb shows
// the nudges one at a time; the panel shows the plan. Text is chosen by `kind`
// in src/messages/<locale>/student.json, with `params` filled in.

const DAY = 86_400_000

export type NudgeKind =
  | 'due'          // a homework or exam window closes within 3 days
  | 'review'       // an exam starts within 7 days and is tied to a lesson
  | 'examSoon'     // same, without a lesson
  | 'plan'         // two or more items due this week
  | 'announcement' // one recent announcement
  | 'announcements'// several recent announcements
  | 'lesson'       // a lesson published in the last 7 days
  | 'quiet'        // nothing urgent: suggest the latest lesson
  | 'welcome'      // nothing at all yet

export interface Nudge {
  /** Stable per subject, so a dismissed nudge stays dismissed. */
  id: string
  kind: NudgeKind
  params: Record<string, string | number>
  /** Offer a summary of this lesson. */
  lessonId?: string
  /** Where "open" goes. */
  href?: string
}

export interface NudgeExam {
  id: string
  title: string
  type: 'exam' | 'homework'
  starts_at: string | null
  ends_at: string | null
  lesson_id: string | null
}

export interface NudgeInput {
  now: Date
  exams: NudgeExam[]
  submittedExamIds: ReadonlySet<string>
  lessons: { id: string; title: string; created_at: string }[]
  announcements: { id: string; title: string; created_at: string }[]
  /** Titles of lessons linked from exams (may include lessons not in `lessons`). */
  lessonTitles: Readonly<Record<string, string>>
}

export const NUDGE_LIMITS = { total: 6, newLessons: 2, planItems: 8 } as const

const time = (iso: string | null): number | null => {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : null
}

/** Whole days from now until `t`, never negative (0 = within the next 24 h). */
const daysUntil = (now: number, t: number) => Math.max(0, Math.floor((t - now) / DAY))

interface OpenItem { exam: NudgeExam; end: number | null; start: number | null }

function openItems(input: NudgeInput): OpenItem[] {
  const now = input.now.getTime()
  return input.exams
    .filter(e => !input.submittedExamIds.has(e.id))
    .map(e => ({ exam: e, end: time(e.ends_at), start: time(e.starts_at) }))
    .filter(i => i.end === null || i.end > now)
}

function lessonParams(input: NudgeInput, lessonId: string | null) {
  const title = lessonId ? input.lessonTitles[lessonId] : undefined
  return title ? { lessonId: lessonId as string, lesson: title } : null
}

export function buildNudges(input: NudgeInput): Nudge[] {
  const now = input.now.getTime()
  const open = openItems(input)
  const out: Nudge[] = []

  // 1. Deadlines within 3 days, soonest first.
  const due = open
    .filter(i => i.end !== null && i.end - now <= 3 * DAY)
    .sort((a, b) => (a.end as number) - (b.end as number))
  for (const i of due) {
    const lesson = lessonParams(input, i.exam.lesson_id)
    out.push({
      id: `due:${i.exam.id}`,
      kind: 'due',
      params: { title: i.exam.title, days: daysUntil(now, i.end as number), type: i.exam.type },
      lessonId: lesson?.lessonId,
      href: '/student/exams',
    })
  }

  // 2. Exams that open within 7 days: revise the linked lesson before.
  const upcoming = open
    .filter(i => i.exam.type === 'exam' && i.start !== null && i.start > now && i.start - now <= 7 * DAY)
    .sort((a, b) => (a.start as number) - (b.start as number))
  for (const i of upcoming) {
    if (out.some(n => n.id === `due:${i.exam.id}`)) continue
    const lesson = lessonParams(input, i.exam.lesson_id)
    const days = daysUntil(now, i.start as number)
    out.push(lesson
      ? { id: `review:${i.exam.id}`, kind: 'review', params: { title: i.exam.title, days, lesson: lesson.lesson }, lessonId: lesson.lessonId, href: '/student/exams' }
      : { id: `examSoon:${i.exam.id}`, kind: 'examSoon', params: { title: i.exam.title, days }, href: '/student/exams' })
  }

  // 3. A weekly plan when two or more items close this week.
  const week = open
    .filter(i => i.end !== null && i.end - now <= 7 * DAY)
    .sort((a, b) => (a.end as number) - (b.end as number))
  if (week.length >= 2) {
    out.push({ id: `plan:${week.map(i => i.exam.id).join(',')}`, kind: 'plan', params: { count: week.length, first: week[0].exam.title } })
  }

  // 4. Announcements from the last 3 days.
  const recentNews = input.announcements
    .filter(a => { const t = time(a.created_at); return t !== null && now - t <= 3 * DAY })
  if (recentNews.length === 1) {
    out.push({ id: `announcement:${recentNews[0].id}`, kind: 'announcement', params: { title: recentNews[0].title }, href: '/student/dashboard' })
  } else if (recentNews.length > 1) {
    out.push({ id: `announcements:${recentNews.map(a => a.id).join(',')}`, kind: 'announcements', params: { count: recentNews.length }, href: '/student/dashboard' })
  }

  // 5. Lessons published in the last 7 days.
  const fresh = input.lessons
    .filter(l => { const t = time(l.created_at); return t !== null && now - t <= 7 * DAY })
    .slice(0, NUDGE_LIMITS.newLessons)
  for (const l of fresh) {
    out.push({ id: `lesson:${l.id}`, kind: 'lesson', params: { title: l.title }, lessonId: l.id, href: `/student/lessons/${l.id}` })
  }

  // 6. Nothing urgent.
  if (out.length === 0) {
    const latest = input.lessons[0]
    out.push(latest
      ? { id: `quiet:${latest.id}`, kind: 'quiet', params: { title: latest.title }, lessonId: latest.id }
      : { id: 'welcome', kind: 'welcome', params: {} })
  }

  return out.slice(0, NUDGE_LIMITS.total)
}

export interface PlanItem {
  examId: string
  title: string
  type: 'exam' | 'homework'
  /** 'opens' = an exam that has not started yet; 'closes' = the window's end. */
  event: 'opens' | 'closes'
  /** Days until the event (0 = within 24 h). */
  days: number
  /** Suggested day to start revising: two days before, or today. */
  reviewInDays: number
  lessonId?: string
  lesson?: string
}

/** The next two weeks, soonest first: what is coming and when to revise. */
export function buildStudyPlan(input: NudgeInput): PlanItem[] {
  const now = input.now.getTime()
  const items: PlanItem[] = []
  for (const i of openItems(input)) {
    const opens = i.exam.type === 'exam' && i.start !== null && i.start > now
    const at = opens ? i.start : i.end
    if (at === null || at - now > 14 * DAY) continue
    const days = daysUntil(now, at)
    const lesson = lessonParams(input, i.exam.lesson_id)
    items.push({
      examId: i.exam.id,
      title: i.exam.title,
      type: i.exam.type,
      event: opens ? 'opens' : 'closes',
      days,
      reviewInDays: Math.max(0, days - 2),
      ...(lesson ? { lessonId: lesson.lessonId, lesson: lesson.lesson } : {}),
    })
  }
  return items.sort((a, b) => a.days - b.days).slice(0, NUDGE_LIMITS.planItems)
}
