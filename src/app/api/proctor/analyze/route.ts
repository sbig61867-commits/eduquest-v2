import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { rateLimit } from '@/lib/rate-limit'

// Students no longer have direct SELECT on exams (answer-leak fix); read exam
// metadata with the service-role client. The user is already authenticated above.
function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 200/hr covers a 90-min exam at one frame per 30s (180 frames) plus buffer.
  // Previous limit of 60 would cut off server proctoring after 30 minutes.
  const rl = await rateLimit(`proctor:${user.id}`, { limit: 200, windowSecs: 3600 })
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    return NextResponse.json({ issues: [], description: '' })
  }

  let body: { examId?: string; frameBase64?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { examId, frameBase64 } = body

  if (!frameBase64 || !examId) {
    return NextResponse.json({ error: 'Missing examId or frameBase64' }, { status: 400 })
  }

  if (frameBase64.length > 512_000) {
    return NextResponse.json({ error: 'Frame too large' }, { status: 413 })
  }

  // Verify exam exists, is published, and has proctoring enabled
  const { data: exam } = await adminClient()
    .from('exams')
    .select('id, proctoring_enabled')
    .eq('id', examId)
    .eq('is_published', true)
    .single()

  if (!exam?.proctoring_enabled) {
    return NextResponse.json({ issues: [], description: '' })
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })

    const prompt = `Analyze this exam proctoring image and respond with ONLY a JSON object (no markdown):
{
  "faceVisible": true or false,
  "multipleFaces": true or false,
  "lookingAway": true or false,
  "suspiciousActivity": true or false,
  "description": "one short sentence"
}
faceVisible=false if no face. lookingAway=true if eyes not facing camera. multipleFaces=true if more than one person. suspiciousActivity=true if phone/book/screen visible.`

    const result = await Promise.race([
      model.generateContent([
        { inlineData: { mimeType: 'image/jpeg', data: frameBase64 } },
        prompt,
      ]),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Gemini timeout')), 10_000)
      ),
    ])

    const text = result.response.text().trim()
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    const analysis = jsonMatch
      ? JSON.parse(jsonMatch[0])
      : { faceVisible: true, lookingAway: false, multipleFaces: false, suspiciousActivity: false, description: '' }

    const issues: string[] = []
    if (!analysis.faceVisible) issues.push('face_not_detected')
    if (analysis.multipleFaces) issues.push('multiple_faces')
    if (analysis.lookingAway) issues.push('looking_away')
    if (analysis.suspiciousActivity) issues.push('suspicious_activity')

    // Append violations atomically via RPC (jsonb concat in the DB — no
    // read-then-write race when frames overlap, and bypasses RLS safely).
    if (issues.length > 0) {
      const newEvents = issues.map(type => ({
        type,
        timestamp: new Date().toISOString(),
        details: analysis.description,
      }))

      await supabase.rpc('append_proctoring_events', {
        p_exam_id: examId,
        p_student_id: user.id,
        p_events: newEvents,
      })
    }

    return NextResponse.json({ issues, description: analysis.description ?? '' })
  } catch (err) {
    console.error('[proctor/analyze]', err)
    return NextResponse.json({ issues: [], description: '' })
  }
}
