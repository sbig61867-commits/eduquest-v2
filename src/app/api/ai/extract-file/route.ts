import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { aiRateLimit } from '@/lib/rate-limit'
import {
  ExtractionError, extractTextFromFile, extractionErrorResponse, fileExt, isImageExt, readFormDataCapped,
} from '@/lib/ai/extract'
import { authorizeAiUsage, identifyAiCaller, meteredAiRoute } from '@/lib/ai/usage'
import { logAiFailure } from '@/lib/ai/meter'
import { audienceApproved } from '@/lib/ai/privacy'

export const maxDuration = 30

// Extracts text from ONE teacher-uploaded file per request. Splitting
// multi-file uploads (generate-homework-from-file) into one small request
// per file keeps each request well under Vercel's ~4.5MB serverless body
// limit — sending 10 raw files in a single FormData routinely blew past it
// even though every file was individually small, and the resulting platform-
// level rejection surfaced to teachers as a generic "connection error".
//
// Two paths, decided per file:
//   local   PDF with a text layer, DOCX, PPTX. Parsed on the server, no AI,
//           no provider, no allowance check, so ordinary files always work.
//   vision  images, and PDFs with no text layer. Gemini reads the whole file,
//           which is institutional content: privacy approval and the monthly
//           allowance are both checked before any call.

export const POST = meteredAiRoute('extract-file', async (request: Request) => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })

  const { data: profile } = await supabase
    .from('users').select('role').eq('id', user.id).single()
  if (!profile || !['teacher', 'university_admin', 'super_admin'].includes(profile.role)) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }

  // Attributes a vision call (if any) to this user in the usage ledger.
  identifyAiCaller(user.id)

  // Fixed per-user cap on every request, local or vision. It is not the
  // admin-configured generation limit: this endpoint never calls a generator.
  const rl = await aiRateLimit(`extract-file:${user.id}`, { limit: 60, windowSecs: 3600 })
  if (!rl.allowed) {
    return NextResponse.json(
      { ...(await apiErr('rateLimited')) },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } }
    )
  }

  let formData: FormData
  // Reads at most UPLOAD_MAX_REQUEST_BYTES of body, whatever Content-Length says.
  try { formData = await readFormDataCapped(request) }
  catch (e) {
    if (e instanceof ExtractionError && e.code === 'too_large') return NextResponse.json({ ...(await apiErr('fileTooLarge')) }, { status: 413 })
    return NextResponse.json({ ...(await apiErr('invalidFormData')) }, { status: 400 })
  }

  const file = formData.get('file')
  if (!(file instanceof File)) return NextResponse.json({ ...(await apiErr('noFileUploaded')) }, { status: 400 })

  const ext = fileExt(file.name)

  // Runs only on the vision path, before Gemini is reachable.
  const visionGate = async (): Promise<Response | null> => {
    if (!audienceApproved(['institution'])) {
      return NextResponse.json({ ...(await apiErr(ext === 'pdf' ? 'fileScannedUnsupported' : 'aiPrivacyPending')) }, { status: 503 })
    }
    return authorizeAiUsage(user.id)
  }

  try {
    if (isImageExt(ext)) {
      const denied = await visionGate()
      if (denied) return denied
      return NextResponse.json({ text: await extractTextFromFile(file, { vision: true }) })
    }

    try {
      return NextResponse.json({ text: await extractTextFromFile(file, { vision: false }) })
    } catch (e) {
      // Only a PDF with no text layer needs vision. Any other local failure is final.
      if (!(e instanceof ExtractionError) || e.userCode !== 'fileScannedUnsupported') throw e
      const denied = await visionGate()
      if (denied) return denied
      return NextResponse.json({ text: await extractTextFromFile(file, { vision: true }) })
    }
  } catch (e) {
    logAiFailure('[extract-file]', e)
    const { status, error, code } = await extractionErrorResponse(e)
    return NextResponse.json({ error, code }, { status })
  }
})
