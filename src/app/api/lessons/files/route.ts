import { currentCtx } from '@/lib/auth/current'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rate-limit'
import { checkStorageQuotaAs, putFile } from '@/lib/file-store'
import { MAX_FILE_BYTES, extFor, lessonImagePath, signExamFiles, sniffImageType } from '@/lib/exam-files'

// POST /api/lessons/files — a teacher uploads one image for a lesson's image
// block (a summary or diagram they made elsewhere, kept exactly as they made
// it). Lands in the R2 bucket (src/lib/file-store.ts) under the teacher's own
// lessons prefix; PATCH /api/lessons only accepts image paths under that prefix.
export async function POST(request: Request) {
  const ctx = await currentCtx()
  if (!ctx) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  const user = { id: ctx.sub }

  // Role and institution from the session context; the image only becomes part
  // of a lesson through PATCH /api/lessons, which checks the caller live.
  const profile = { role: ctx.role, tenant_id: ctx.tenant_id }
  if (!profile.tenant_id || !['teacher', 'university_admin'].includes(profile.role ?? '')) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }

  const limit = await rateLimit(`lesson_files:${user.id}`, { limit: 120, windowSecs: 3600 })
  if (!limit.allowed) return NextResponse.json({ ...(await apiErr('rateLimited')) }, { status: 429 })

  let file: File | null = null
  try {
    const f = (await request.formData()).get('file')
    if (f instanceof File) file = f
  } catch {
    return NextResponse.json({ ...(await apiErr('invalidFormData')) }, { status: 400 })
  }
  if (!file) return NextResponse.json({ ...(await apiErr('noFileUploaded')) }, { status: 400 })
  if (file.size > MAX_FILE_BYTES) return NextResponse.json({ ...(await apiErr('imageTooLarge4')) }, { status: 400 })

  const bytes = new Uint8Array(await file.arrayBuffer())
  const type = sniffImageType(bytes)
  const ext = type ? extFor(type) : null
  if (!type || !ext) return NextResponse.json({ ...(await apiErr('imageContentInvalid')) }, { status: 400 })

  const quota = await checkStorageQuotaAs(profile.tenant_id, bytes.length)
  if (!quota.allowed) return NextResponse.json({ ...(await apiErr('storageLimit')) }, { status: 413 })
  const path = lessonImagePath(profile.tenant_id, user.id, crypto.randomUUID(), ext)
  try {
    await putFile(profile.tenant_id, path, bytes, type)
  } catch (e) {
    console.error('[api/lessons/files]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('imageUploadFailed')) }, { status: 500 })
  }

  const [url] = await signExamFiles([path])
  return NextResponse.json({ path, url: url ?? null }, { status: 201 })
}
