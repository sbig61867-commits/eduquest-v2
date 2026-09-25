import { getLocale, getTranslations } from 'next-intl/server'
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
// The Arabic wording is unchanged from before; English mirrors it.
function factSheet(c: CourseAnalyticsRow, days: number, locale: Locale, insights: string[]): string {
  const ar = locale === 'ar'
  const none = ar ? 'غير محدد' : 'not set'
  const groups = c.groups.length === 0
    ? (ar ? 'لا توجد مجموعات مرتبطة بالكورس.' : 'No groups are linked to the course.')
    : c.groups.map(g => ar
        ? `- ${g.name} (المعلّم: ${g.teacher ?? none}): ${g.students} طالب، ` +
          `إنجاز المحتوى ${g.avg_progress ?? '—'}%، نشطون ${g.active_pct ?? '—'}%، ` +
          `حضور صفّي ${g.attendance_rate ?? '—'}% عبر ${g.sessions} جلسة`
        : `- ${g.name} (teacher: ${g.teacher ?? none}): ${g.students} students, ` +
          `content progress ${g.avg_progress ?? '—'}%, active ${g.active_pct ?? '—'}%, ` +
          `class attendance ${g.attendance_rate ?? '—'}% over ${g.sessions} sessions`).join('\n')

  return (ar ? [
    `الكورس: ${c.title}`,
    `المعلّم المسؤول: ${c.teacher ?? none}`,
    `الفترة: آخر ${days} يوماً`,
    `عناصر منشورة: ${c.items_total} · مسجّلون: ${c.enrollments}`,
    `متوسط الإنجاز: ${c.avg_progress ?? '—'}% · نشطون خلال الفترة: ${c.active_students} · أنهوا الكورس: ${c.completed_students}`,
    'المجموعات:',
    groups,
    'ملاحظات محسوبة آلياً:',
  ] : [
    `Course: ${c.title}`,
    `Responsible teacher: ${c.teacher ?? none}`,
    `Period: last ${days} days`,
    `Published items: ${c.items_total} · enrolled: ${c.enrollments}`,
    `Average progress: ${c.avg_progress ?? '—'}% · active in period: ${c.active_students} · completed the course: ${c.completed_students}`,
    'Groups:',
    groups,
    'Automatically computed notes:',
  ]).concat(insights).join('\n')
}

function systemPrompt(locale: Locale): string {
  return locale === 'ar'
    ? 'أنت مستشار تشغيلي لمركز تعليمي. تتلقى أرقاماً حقيقية عن كورس ومجموعاته وتقترح خطوات تحسين. ' +
      'اكتب بالعربية الفصحى المبسطة. لا تخترع أي رقم أو اسم غير موجود في المعطيات، ولا تقترح أدوات أو ميزات خارج المنصة. ' +
      'كل اقتراح عملي ومحدد وقابل للتنفيذ خلال أسبوعين، ويذكر المجموعة أو الفئة المستهدفة عند وجودها. ' +
      'إن كانت الأرقام جيدة فاقترح كيف يُحافَظ عليها بدل اختلاق مشكلات. ' +
      `أعد JSON فقط: مصفوفة من ٣ إلى ${MAX_SUGGESTIONS} نصوص، كل نص ≤ ٢٤٠ حرفاً، بلا ترقيم ولا عناوين.`
    : 'You are an operations advisor for a learning centre. You receive real figures about a course and its groups and suggest improvement steps. ' +
      'Write in clear, simple English. Do not invent any number or name that is not in the data, and do not suggest tools or features outside the platform. ' +
      'Every suggestion must be practical, specific and doable within two weeks, and name the target group or cohort where there is one. ' +
      'If the figures are good, suggest how to keep them there instead of inventing problems. ' +
      `Return JSON only: an array of 3 to ${MAX_SUGGESTIONS} strings, each ≤ 240 characters, with no numbering or headings.`
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
