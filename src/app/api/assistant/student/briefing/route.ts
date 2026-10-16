import { NextResponse } from 'next/server'
import { apiErr } from '@/lib/api-error'
import { createClient, getAuthUser } from '@/lib/supabase/server'
import { loadAssistantBriefing } from '@/lib/data/assistant-nudges'

// GET /api/assistant/student/briefing
// The orb's nudges, a two-week study plan and the lessons it can summarise.
// Reads only, through the student's session (RLS); no AI provider is called,
// so no allowance check or privacy gate applies here.
export async function GET() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  if (user.role !== 'student') return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })

  const { data, error } = await loadAssistantBriefing(supabase, user.id)
  if (error) console.error('[assistant/briefing] partial read', { code: 'read_error' })
  return NextResponse.json(data, { headers: { 'Cache-Control': 'private, no-store' } })
}
