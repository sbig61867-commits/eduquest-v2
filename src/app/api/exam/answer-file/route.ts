import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rate-limit'
import { isOnExamRoster } from '@/lib/exam-roster'
import {
  EXAM_FILES_BUCKET, MAX_FILE_BYTES, answerFilePath, examFilesAdmin, extFor, isSafeQuestionId, isUuid,
  signExamFiles, sniffImageType,
} from '@/lib/exam-files'

// A student attaches a photo of their handwritten answer to one written
// question of an individual task (POST), or removes it (DELETE).
//
// Only for a task assigned to this student, only while their attempt is
// still in progress, only for a written question of that task. The file goes
// to the private exam-files bucket; the submission row keeps the path in
// answer_files and the teacher sees it through a signed URL in the results.

type Ctx = { examId: string; questionId: string }

async function authorize(ctx: Ctx) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { fail: NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 }) }

  const admin = examFilesAdmin()
  const { data: exam } = await admin.from('exams').select('*').eq('id', ctx.examId).maybeSingle()
  if (!exam || !exam.is_published || exam.deleted_at || exam.assigned_student_id !== user.id) {
    return { fail: NextResponse.json({ ...(await apiErr('examNotFound')) }, { status: 404 }) }
  }
  if (!(await isOnExamRoster(supabase, exam, user.id))) {
    return { fail: NextResponse.json({ ...(await apiErr('notEnrolledInExam')) }, { status: 403 }) }
  }
  const question = (Array.isArray(exam.questions) ? exam.questions : [])
    .find((q: { id?: string; type?: string }) => q?.id === ctx.questionId)
  if (!question || !['essay', 'short_answer'].includes(question.type)) {
    return { fail: NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }
  }
  const { data: sub } = await admin
    .from('exam_submissions').select('id, status, answer_files')
    .eq('exam_id', ctx.examId).eq('student_id', user.id).maybeSingle()
  if (!sub || sub.status !== 'in_progress') {
    return { fail: NextResponse.json({ ...(await apiErr('examNotStarted')) }, { status: 409 }) }
  }
  return { user, exam, sub, admin }
}

export async function POST(request: Request) {
  let form: FormData
  try { form = await request.formData() }
  catch { return NextResponse.json({ ...(await apiErr('invalidFormData')) }, { status: 400 }) }

  const examId = form.get('examId')
  const questionId = form.get('questionId')
  const file = form.get('file')
  if (!isUuid(examId) || !isSafeQuestionId(questionId)) return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })
  if (!(file instanceof File)) return NextResponse.json({ ...(await apiErr('noFileUploaded')) }, { status: 400 })
  if (file.size > MAX_FILE_BYTES) return NextResponse.json({ ...(await apiErr('imageTooLarge4')) }, { status: 400 })

  const auth = await authorize({ examId, questionId })
  if ('fail' in auth) return auth.fail
  const { user, exam, sub, admin } = auth

  const limit = await rateLimit(`answer_file:${user.id}`, { limit: 40, windowSecs: 3600 })
  if (!limit.allowed) return NextResponse.json({ ...(await apiErr('rateLimited')) }, { status: 429 })

  const bytes = new Uint8Array(await file.arrayBuffer())
  const type = sniffImageType(bytes)
  const ext = type ? extFor(type) : null
  if (!type || !ext) return NextResponse.json({ ...(await apiErr('imageContentInvalid')) }, { status: 400 })

  const path = answerFilePath(exam.tenant_id, examId, user.id, questionId, ext)
  const { error } = await admin.storage.from(EXAM_FILES_BUCKET).upload(path, bytes, { contentType: type, upsert: true })
  if (error) {
    console.error('[api/exam/answer-file]', error.message)
    return NextResponse.json({ ...(await apiErr('imageUploadFailed')) }, { status: 500 })
  }

  const files = { ...((sub.answer_files as Record<string, string> | null) ?? {}) }
  const previous = files[questionId]
  files[questionId] = path
  const { error: saveErr } = await admin
    .from('exam_submissions').update({ answer_files: files }).eq('id', sub.id).eq('status', 'in_progress')
  if (saveErr) return NextResponse.json({ ...(await apiErr('submissionSaveFailed')) }, { status: 500 })
  // A photo of another format replaced the old one: drop the orphan.
  if (previous && previous !== path) void admin.storage.from(EXAM_FILES_BUCKET).remove([previous])

  const [url] = await signExamFiles([path], admin)
  return NextResponse.json({ url: url ?? null })
}

export async function DELETE(request: Request) {
  let body: { examId?: unknown; questionId?: unknown }
  try { body = await request.json() }
  catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }
  if (!isUuid(body.examId) || !isSafeQuestionId(body.questionId)) {
    return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })
  }

  const auth = await authorize({ examId: body.examId, questionId: body.questionId })
  if ('fail' in auth) return auth.fail
  const { sub, admin } = auth

  const files = { ...((sub.answer_files as Record<string, string> | null) ?? {}) }
  const path = files[body.questionId]
  if (!path) return NextResponse.json({ ok: true })
  delete files[body.questionId]
  const { error } = await admin
    .from('exam_submissions').update({ answer_files: files }).eq('id', sub.id).eq('status', 'in_progress')
  if (error) return NextResponse.json({ ...(await apiErr('submissionSaveFailed')) }, { status: 500 })
  void admin.storage.from(EXAM_FILES_BUCKET).remove([path])
  return NextResponse.json({ ok: true })
}
