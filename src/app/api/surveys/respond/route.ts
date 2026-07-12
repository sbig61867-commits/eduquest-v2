import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// GET /api/surveys/respond — student: open survey (if any) for one of their
// groups that they haven't answered yet.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (profile?.role !== 'student') return NextResponse.json({ survey: null })

  const admin = adminClient()
  const { data: memberships } = await admin.from('group_students').select('group_id').eq('student_id', user.id)
  const groupIds = (memberships ?? []).map(m => m.group_id)
  if (!groupIds.length) return NextResponse.json({ survey: null })

  const { data: surveys } = await admin
    .from('surveys').select('id, title, group_id, groups(name)').in('group_id', groupIds).eq('is_open', true)
  if (!surveys?.length) return NextResponse.json({ survey: null })

  const surveyIds = surveys.map(s => s.id)
  const { data: answered } = await admin
    .from('survey_responses').select('survey_id').eq('student_id', user.id).in('survey_id', surveyIds)
  const answeredIds = new Set((answered ?? []).map(a => a.survey_id))

  const pending = surveys.find(s => !answeredIds.has(s.id))
  if (!pending) return NextResponse.json({ survey: null })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const groupName = ((pending as any).groups?.name as string | undefined) ?? ''
  return NextResponse.json({ survey: { id: pending.id, title: pending.title, groupName } })
}

// POST /api/surveys/respond — student submits their one answer
// Body: { survey_id, ease_rating, prefer_platform, best_feature, problem_faced, recommend, comment }
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('users').select('role, tenant_id').eq('id', user.id).single()
  if (profile?.role !== 'student' || !profile.tenant_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: {
    survey_id?: string; ease_rating?: number; prefer_platform?: boolean
    best_feature?: string; problem_faced?: string; recommend?: boolean; comment?: string
  }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { survey_id, ease_rating, prefer_platform, recommend } = body
  if (!survey_id || typeof ease_rating !== 'number' || ease_rating < 1 || ease_rating > 5
      || typeof prefer_platform !== 'boolean' || typeof recommend !== 'boolean') {
    return NextResponse.json({ error: 'Missing or invalid fields' }, { status: 400 })
  }

  const admin = adminClient()

  // Verify the survey is open and the student belongs to its group.
  const { data: survey } = await admin.from('surveys').select('id, group_id, is_open').eq('id', survey_id).single()
  if (!survey || !survey.is_open) return NextResponse.json({ error: 'Survey not open' }, { status: 404 })

  const { data: membership } = await admin
    .from('group_students').select('group_id').eq('group_id', survey.group_id).eq('student_id', user.id).maybeSingle()
  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { error: dbErr } = await admin.from('survey_responses').insert({
    survey_id,
    student_id: user.id,
    tenant_id: profile.tenant_id,
    ease_rating,
    prefer_platform,
    best_feature: body.best_feature?.trim().slice(0, 500) || null,
    problem_faced: body.problem_faced?.trim().slice(0, 500) || null,
    recommend,
    comment: body.comment?.trim().slice(0, 1000) || null,
  })

  if (dbErr) {
    if (dbErr.code === '23505') return NextResponse.json({ error: 'Already submitted' }, { status: 409 })
    console.error('[surveys/respond POST]', dbErr)
    return NextResponse.json({ error: 'Failed to submit response' }, { status: 500 })
  }
  return NextResponse.json({ ok: true }, { status: 201 })
}
