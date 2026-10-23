import { aiCaller } from '@/lib/ai/caller'
import { getTranslations } from 'next-intl/server'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { run } from '@/lib/db/sql'

// GET /api/ai/quota — the caller's OWN AI allowances and how much is left.
//
// Read-only on purpose: it SELECTs public.rate_limits directly instead of
// calling check_rate_limit(), because that function increments the counter. A
// panel that showed your quota by spending a unit of it would be worse than
// no panel at all.
//
// It is read as app_system, not as the user: rate_limits is readable by that
// role only, so no user session can read it. Authorization is done here
// first, and the keys are built from the authenticated user's own id — a
// caller can never name someone else's key.

export const dynamic = 'force-dynamic'

const AI_ROLES = ['teacher', 'university_admin', 'center_manager', 'super_admin']

/** Fixed-limit features. The two configurable ones are added below from
 *  platform_settings, so the panel never disagrees with what the route
 *  actually enforces. Keep each `key` identical to the rate-limit key its
 *  route passes to aiRateLimit()/rateLimit(), minus the `:userId` suffix. */
// Keys + limits only; the display label is resolved per request from
// `common.quota.features.<key>`, so the panel follows the caller's language.
const FIXED_FEATURES: { key: string; limit: number }[] = [
  { key: 'course-file',        limit: 5 },
  { key: 'item-content',       limit: 30 },
  { key: 'course_suggestions', limit: 10 },
  { key: 'announcement_copy',  limit: 15 },
  { key: 'extract-file',       limit: 60 },
  { key: 'individual_task_ai', limit: 30 },
]

export async function GET() {
  const caller = await aiCaller()
  if (!caller) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  const user = { id: caller.ctx.sub }
  if (!AI_ROLES.includes(caller.role)) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }

  const aiLimits = caller.limits

  const t = await getTranslations('common.quota.features')
  const features = [
    { key: 'lesson',        limit: aiLimits.lesson_per_hour },
    { key: 'lesson-file',   limit: aiLimits.lesson_per_hour },
    { key: 'exam',          limit: aiLimits.exam_per_hour },
    { key: 'homework-file', limit: aiLimits.exam_per_hour },
    ...FIXED_FEATURES,
  ].map(f => ({ ...f, label: t(f.key) }))

  const keys = features.map(f => `${f.key}:${user.id}`)
  let rows: { key: string; count: number; reset_at: string }[]
  try {
    const [r] = await run({ as: 'system' }, sql => [
      sql`select key, count, reset_at from public.rate_limits
            where key in (select jsonb_array_elements_text(${sql.json(keys)}))`,
    ])
    rows = r as unknown as typeof rows
  } catch (e) {
    console.error('[api/ai/quota]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('quotaLoadFailed')) }, { status: 500 })
  }

  const byKey = new Map(rows.map(r => [r.key, r]))
  const now = Date.now()

  const quota = features.map(f => {
    const row = byKey.get(`${f.key}:${user.id}`)
    // An elapsed window is already spent from the DB's point of view: the
    // next call rewrites count to 1 and starts a fresh window. Report it as
    // untouched rather than as an expired row the teacher must decode.
    const live = row && new Date(row.reset_at).getTime() > now ? row : null
    const used = live ? live.count : 0
    return {
      key: f.key,
      label: f.label,
      limit: f.limit,
      // check_rate_limit increments THEN compares, so a rejected attempt is
      // counted too — used can exceed limit. Clamp the display.
      used: Math.min(used, f.limit),
      remaining: Math.max(f.limit - used, 0),
      // The window is anchored to the first consumed request and is never
      // extended by later calls (or by rejected ones), so this instant is
      // stable and safe to count down to on the client.
      resetAt: live ? live.reset_at : null,
    }
  })

  return NextResponse.json({ quota })
}
