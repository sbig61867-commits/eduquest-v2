import { getLocale, getTranslations } from 'next-intl/server'
import { aiPrompts } from '@/content/ai'
import { toLocale, type Locale } from '@/i18n/config'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { can } from '@/lib/permissions'
import { rateLimit } from '@/lib/rate-limit'
import { groqChat } from '@/lib/ai/groq'
import { logAiUsage } from '@/lib/ai/usage'
import { loadCourseAnalytics, courseInsights, formatInsight, type CourseAnalyticsRow } from '@/lib/engagement'

// Improvement suggestions for ONE course, on demand only.
//
// Nothing here runs on page load: /center/analytics renders the rule-based
// courseInsights() for free, and this route is called only when the manager
// presses the button for a specific course. Every call is rate-limited and
// logged, so the AI bill stays a deliberate action rather than a background
// cost of viewing a page.
//
// The numbers are re-computed server-side through get_course_analytics with
// the USER's session (so RLS + the view_reports guard apply); the client
// sends only a course id and a period, never the figures to reason about.

const PERIODS = [7, 30, 90, 180]
const MAX_SUGGESTIONS = 5

// The prompt is written in the viewer's language so the model answers in it.
// Prompt text: src/content/ai/{ar,en}.ts.
function factSheet(c: CourseAnalyticsRow, days: number, locale: Locale, insights: string[]): string {
  const text = aiPrompts(locale).courseSuggestions
  const groups = c.groups.length === 0
    ? text.noGroups
    : c.groups.map(g => text.groupLine({
        name: g.name,
        teacher: g.teacher ?? text.none,
        students: g.students,
        progress: String(g.avg_progress ?? '—'),
        active: String(g.active_pct ?? '—'),
        attendance: String(g.attendance_rate ?? '—'),
        sessions: g.sessions,
      })).join('\n')

  return [
    ...text.header({
      title: c.title,
      teacher: c.teacher ?? text.none,
      days,
      items: c.items_total,
      enrollments: c.enrollments,
      progress: String(c.avg_progress ?? '—'),
      active: c.active_students,
      completed: c.completed_students,
    }),
    text.groupsHeading,
    groups,
    text.notesHeading,
    ...insights,
  ].join('\n')
}

function systemPrompt(locale: Locale): string {
  return aiPrompts(locale).courseSuggestions.system(MAX_SUGGESTIONS)
}

function parseSuggestions(raw: string): string[] {
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start === -1 || end <= start) return []
  try {
    const arr = JSON.parse(raw.slice(start, end + 1)) as unknown[]
    return arr
      .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      .slice(0, MAX_SUGGESTIONS)
      .map(s => s.trim().slice(0, 300))
  } catch {
    return []
  }
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })

  const { data: profile } = await supabase
    .from('users').select('role, tenant_id, permissions').eq('id', user.id).single()
  if (!profile?.tenant_id || !can(profile.role, profile.permissions, 'view_reports')) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }

  const limit = await rateLimit(`course_suggestions:${user.id}`, { limit: 10, windowSecs: 3600 })
  if (!limit.allowed) return NextResponse.json({ ...(await apiErr('rateLimited')) }, { status: 429 })

  let body: { course_id?: string; days?: number }
  try { body = await request.json() } catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const courseId = String(body.course_id ?? '')
  if (!courseId) return NextResponse.json({ ...(await apiErr('missingCourseId')) }, { status: 400 })
  const days = PERIODS.includes(Number(body.days)) ? Number(body.days) : 30

  const analytics = await loadCourseAnalytics(supabase, days)
  if (!analytics) return NextResponse.json({ ...(await apiErr('courseStatsFailed')) }, { status: 503 })

  // Only courses of the caller's own tenant come back from the RPC, so a
  // hand-typed id from another tenant simply is not found here.
  const course = analytics.courses.find(c => c.course_id === courseId)
  if (!course) return NextResponse.json({ ...(await apiErr('courseNotFound')) }, { status: 404 })

  const locale = toLocale(await getLocale())
  const tInsight = await getTranslations('center.insights')
  const insights = courseInsights(course).map(i => `- (${i.kind}) ${formatInsight(tInsight, i)}`)
  const system = systemPrompt(locale)

  try {
    const raw = await groqChat(factSheet(course, days, locale, insights), system, 0.6)
    const suggestions = parseSuggestions(raw)
    if (suggestions.length === 0) {
      return NextResponse.json({ ...(await apiErr('aiNoValidSuggestions')) }, { status: 502 })
    }
    void logAiUsage(user.id, profile.tenant_id, 'course_suggestions', 'groq')
    return NextResponse.json({ suggestions })
  } catch (err) {
    console.error('[api/ai/course-suggestions]', err instanceof Error ? err.message : err)
    return NextResponse.json({ ...(await apiErr('aiUnavailable')) }, { status: 503 })
  }
}
