import { getLocale } from 'next-intl/server'
import { aiPrompts } from '@/content/ai'
import { toLocale } from '@/i18n/config'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { can } from '@/lib/permissions'
import { rateLimit } from '@/lib/rate-limit'
import { groqChat } from '@/lib/ai/groq'
import { logAiUsage } from '@/lib/ai/usage'

// Suggests announcement copy (title / body / button label) on the free Groq
// tier. Text only — no image generation. Gated by manage_announcements and
// rate-limited per user; nothing is stored until the author saves.

const MAX_BRIEF = 600

interface Suggestion { title: string; body: string; cta_label: string }

function parseSuggestions(raw: string): Suggestion[] {
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start === -1 || end <= start) return []
  try {
    const arr = JSON.parse(raw.slice(start, end + 1)) as unknown[]
    return arr
      .map(x => x as Record<string, unknown>)
      .filter(x => typeof x?.title === 'string' && x.title.trim())
      .slice(0, 3)
      .map(x => ({
        title: String(x.title).trim().slice(0, 120),
        body: typeof x.body === 'string' ? x.body.trim().slice(0, 600) : '',
        cta_label: typeof x.cta_label === 'string' ? x.cta_label.trim().slice(0, 40) : '',
      }))
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
  if (!profile?.tenant_id || !can(profile.role, profile.permissions, 'manage_announcements')) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }

  const limit = await rateLimit(`announcement_copy:${user.id}`, { limit: 15, windowSecs: 3600 })
  if (!limit.allowed) return NextResponse.json({ ...(await apiErr('rateLimited')) }, { status: 429 })

  let body: { brief?: string }
  try { body = await request.json() } catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }
  const brief = String(body.brief ?? '').trim()
  if (brief.length < 5) return NextResponse.json({ ...(await apiErr('briefRequired')) }, { status: 400 })
  if (brief.length > MAX_BRIEF) return NextResponse.json({ ...(await apiErr('descriptionTooLong')) }, { status: 400 })

  // Written in the viewer's language so the suggested copy comes back in it.
  // Prompt text: src/content/ai/{ar,en}.ts.
  const text = aiPrompts(toLocale(await getLocale())).announcementCopy

  try {
    const raw = await groqChat(text.brief(brief), text.system, 0.8)
    const suggestions = parseSuggestions(raw)
    if (suggestions.length === 0) {
      return NextResponse.json({ ...(await apiErr('aiNoValidSuggestions')) }, { status: 502 })
    }
    void logAiUsage(user.id, profile.tenant_id, 'announcement_copy', 'groq')
    return NextResponse.json({ suggestions })
  } catch (err) {
    console.error('[api/ai/announcement-copy]', err instanceof Error ? err.message : err)
    return NextResponse.json({ ...(await apiErr('aiUnavailable')) }, { status: 503 })
  }
}
