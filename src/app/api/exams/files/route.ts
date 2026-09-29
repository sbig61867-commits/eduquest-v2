import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rate-limit'
import { checkStorageQuota } from '@/lib/storage-quota'
import {
  EXAM_FILES_BUCKET, MAX_FILE_BYTES, examFilesAdmin, extFor, signExamFiles, sniffImageType, taskAttachmentPath,
} from '@/lib/exam-files'

// POST /api/exams/files — a teacher uploads one image for an individual task
// (typically a photo of the student's marked paper). It lands in the private
// exam-files bucket under the teacher's own prefix; /api/exams/individual
// only accepts paths under that prefix, so nobody can attach someone else's
// file. Returns the path (stored on the task) and a signed preview URL.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })

  const { data: profile } = await supabase.from('users').select('role, tenant_id').eq('id', user.id).single()
  if (!profile?.tenant_id || !['teacher', 'university_admin'].includes(profile.role ?? '')) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }

  const limit = await rateLimit(`exam_files:${user.id}`, { limit: 60, windowSecs: 3600 })
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

  const admin = examFilesAdmin()
  // The institution's file allowance (owner's plan limit, src/lib/storage-quota.ts).
  const quota = await checkStorageQuota(admin, profile.tenant_id, bytes.length)
  if (!quota.allowed) return NextResponse.json({ ...(await apiErr('storageLimit')) }, { status: 413 })
  const path = taskAttachmentPath(profile.tenant_id, user.id, crypto.randomUUID(), ext)
  const { error } = await admin.storage.from(EXAM_FILES_BUCKET).upload(path, bytes, { contentType: type, upsert: false })
  if (error) {
    console.error('[api/exams/files]', error.message)
    return NextResponse.json({ ...(await apiErr('imageUploadFailed')) }, { status: 500 })
  }

  const [url] = await signExamFiles([path], admin)
  return NextResponse.json({ path, url: url ?? null }, { status: 201 })
}
