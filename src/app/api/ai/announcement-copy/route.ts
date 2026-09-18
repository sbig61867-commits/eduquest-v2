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
  if (!user) return NextResponse.json({ error: 'غير مصرّح' }, { status: 401 })

  const { data: profile } = await supabase
    .from('users').select('role, tenant_id, permissions').eq('id', user.id).single()
  if (!profile?.tenant_id || !can(profile.role, profile.permissions, 'manage_announcements')) {
    return NextResponse.json({ error: 'ممنوع' }, { status: 403 })
  }

  const limit = await rateLimit(`announcement_copy:${user.id}`, { limit: 15, windowSecs: 3600 })
  if (!limit.allowed) return NextResponse.json({ error: 'تجاوزت الحد المسموح، حاول لاحقاً' }, { status: 429 })

  let body: { brief?: string }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 }) }
  const brief = String(body.brief ?? '').trim()
  if (brief.length < 5) return NextResponse.json({ error: 'اكتب وصفاً مختصراً للإعلان أولاً' }, { status: 400 })
  if (brief.length > MAX_BRIEF) return NextResponse.json({ error: 'الوصف طويل جداً' }, { status: 400 })

  const system =
    'أنت كاتب إعلانات لمؤسسة تعليمية. اكتب بالعربية الفصحى المبسطة، بنبرة مهنية ودودة، ' +
    'بلا مبالغة ولا وعود غير موجودة في الوصف، ولا تخترع أسعاراً أو تواريخ أو أرقاماً. ' +
    'أعد JSON فقط: مصفوفة من 3 عناصر، كل عنصر {"title": عنوان ≤ 60 حرفاً, "body": نص ≤ 250 حرفاً, "cta_label": نص زر ≤ 20 حرفاً}.'

  try {
    const raw = await groqChat(`وصف الإعلان من الموظف:\n"""\n${brief}\n"""`, system, 0.8)
    const suggestions = parseSuggestions(raw)
    if (suggestions.length === 0) {
      return NextResponse.json({ error: 'لم يُرجع المساعد اقتراحات صالحة، حاول مرة أخرى' }, { status: 502 })
    }
    void logAiUsage(user.id, profile.tenant_id, 'announcement_copy', 'groq')
    return NextResponse.json({ suggestions })
  } catch (err) {
    console.error('[api/ai/announcement-copy]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'المساعد غير متاح حالياً' }, { status: 503 })
  }
}
