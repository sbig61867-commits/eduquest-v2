import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { rateLimit } from '@/lib/rate-limit'
import { groqChat } from '@/lib/ai/groq'

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// POST /api/courses/generate-item-content  body: { course_id, title }
// Generates the markdown content for one section STRICTLY from the course's stored
// source file text — never from outside/general knowledge.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('users').select('role, tenant_id').eq('id', user.id).single()
  if (!profile?.tenant_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const rl = await rateLimit(`item-content:${user.id}`, { limit: 30, windowSecs: 3600 })
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } }
    )
  }

  let body: { course_id?: string; title?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { course_id, title } = body
  if (!course_id || !title?.trim()) {
    return NextResponse.json({ error: 'course_id and title are required' }, { status: 400 })
  }

  // Verify the teacher owns the course and pull its stored source text.
  const { data: course } = await adminClient()
    .from('courses').select('teacher_id, tenant_id, source_text, language').eq('id', course_id).single()
  if (!course || course.tenant_id !== profile.tenant_id || course.teacher_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!course.source_text?.trim()) {
    return NextResponse.json(
      { error: 'لا يوجد ملف مصدر لهذا الكورس. أعد استيراد الكورس من ملف ليتمكن الذكاء الاصطناعي من التوليد منه.' },
      { status: 422 }
    )
  }

  const prompt = `You are writing lesson content for a course section.
Use ONLY the source material below. Do NOT add facts, examples, or information that are not present in the source. Do NOT use outside or general knowledge. Keep the same language as the source.
If the source does not cover the section, say so briefly instead of inventing content.

Section to write: "${title.trim()}"

Format the output in clean Markdown.

=== SOURCE MATERIAL (the only allowed source) ===
${course.source_text.slice(0, 10000)}`

  try {
    const content = await groqChat(
      prompt,
      'Write lesson content in Markdown strictly from the provided source material. Never add outside knowledge.'
    )
    return NextResponse.json({ content })
  } catch (e) {
    console.error('[generate-item-content]', e)
    return NextResponse.json({ error: 'AI generation failed. Please try again.' }, { status: 500 })
  }
}
