import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rate-limit'
import { extractTextFromFile, extractionErrorResponse } from '@/lib/ai/extract'

export const maxDuration = 30

// Extracts text from ONE teacher-uploaded file per request. Splitting
// multi-file uploads (generate-homework-from-file) into one small request
// per file keeps each request well under Vercel's ~4.5MB serverless body
// limit — sending 10 raw files in a single FormData routinely blew past it
// even though every file was individually small, and the resulting platform-
// level rejection surfaced to teachers as a generic "connection error".

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('users').select('role').eq('id', user.id).single()
  if (!profile || !['teacher', 'university_admin', 'super_admin'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Extraction is local parsing (cheap) except the Gemini-vision fallback for
  // scanned files — generous fixed cap, independent of the admin-configured
  // AI generation limits, since this endpoint never calls the lesson/exam
  // generation model itself.
  const rl = await rateLimit(`extract-file:${user.id}`, { limit: 60, windowSecs: 3600 })
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } }
    )
  }

  let formData: FormData
  try { formData = await request.formData() }
  catch { return NextResponse.json({ error: 'Invalid form data' }, { status: 400 }) }

  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  try {
    const text = await extractTextFromFile(file)
    return NextResponse.json({ text })
  } catch (e) {
    console.error('[extract-file]', e)
    const { status, error } = extractionErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
