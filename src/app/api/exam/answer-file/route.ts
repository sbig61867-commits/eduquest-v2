import { currentCtx } from '@/lib/auth/current'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { run, maybeOne } from '@/lib/db/sql'
import { rateLimit } from '@/lib/rate-limit'
import { onRosterSql } from '@/lib/exam-roster'
import { checkStorageQuotaAs, putFile, removeFiles } from '@/lib/file-store'
import {
  MAX_FILE_BYTES, answerFilePath, extFor, isSafeQuestionId, isUuid, signExamFiles, sniffImageType,
} from '@/lib/exam-files'

// A student attaches a photo of their handwritten answer to one written
// question of an individual task (POST), or removes it (DELETE).
//
// Only for a task assigned to this student, only while their attempt is
// still in progress, only for a written question of that task. The file goes
// to the R2 bucket (src/lib/file-store.ts); the submission row keeps the path
// in answer_files and the teacher sees it through a signed link in the results.
// Reads and writes run as app_service pinned to the student's institution; the
// write repeats the attempt's conditions (still in progress, this student).

type Ask = { examId: string; questionId: string }
type Exam = { id: string; tenant_id: string; questions: unknown; on_roster: boolean }
type Sub = { id: string; status: string; answer_files: Record<string, string> | null }

async function authorize(ask: Ask) {
  const ctx = await currentCtx()
  if (!ctx) return { fail: NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 }) }
  if (!ctx.tenant_id) return { fail: NextResponse.json({ ...(await apiErr('examNotFound')) }, { status: 404 }) }
  const userId = ctx.sub
  const tenantId = ctx.tenant_id

  const [examRows, subRows] = await run({ as: 'service', tenantId }, sql => [
    sql`select e.id, e.tenant_id, e.questions, ${onRosterSql(sql, userId)} as on_roster
          from public.exams e
         where e.id = ${ask.examId} and e.tenant_id = ${tenantId}
           and e.is_published and e.deleted_at is null and e.assigned_student_id = ${userId}`,
    sql`select id, status, answer_files from public.exam_submissions
         where exam_id = ${ask.examId} and student_id = ${userId}`,
  ])
  const exam = maybeOne<Exam>(examRows)
  if (!exam) return { fail: NextResponse.json({ ...(await apiErr('examNotFound')) }, { status: 404 }) }
  if (!exam.on_roster) return { fail: NextResponse.json({ ...(await apiErr('notEnrolledInExam')) }, { status: 403 }) }
  const question = (Array.isArray(exam.questions) ? exam.questions : [])
    .find((q: { id?: string; type?: string }) => q?.id === ask.questionId) as { type?: string } | undefined
  if (!question || !['essay', 'short_answer'].includes(question.type ?? '')) {
    return { fail: NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }
  }
  const sub = maybeOne<Sub>(subRows)
  if (!sub || sub.status !== 'in_progress') {
    return { fail: NextResponse.json({ ...(await apiErr('examNotStarted')) }, { status: 409 }) }
  }
  return { userId, tenantId, sub }
}

/** Saves answer_files only while the attempt is still this student's and in progress. */
async function saveFiles(tenantId: string, subId: string, userId: string, files: Record<string, string>) {
  const [rows] = await run({ as: 'service', tenantId }, sql => [
    sql`update public.exam_submissions set answer_files = ${sql.json(files)}
         where id = ${subId} and student_id = ${userId} and status = 'in_progress' returning id`,
  ])
  return rows.length > 0
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
  if (auth.fail) return auth.fail
  const { userId, tenantId, sub } = auth

  const limit = await rateLimit(`answer_file:${userId}`, { limit: 40, windowSecs: 3600 })
  if (!limit.allowed) return NextResponse.json({ ...(await apiErr('rateLimited')) }, { status: 429 })

  const bytes = new Uint8Array(await file.arrayBuffer())
  const type = sniffImageType(bytes)
  const ext = type ? extFor(type) : null
  if (!type || !ext) return NextResponse.json({ ...(await apiErr('imageContentInvalid')) }, { status: 400 })

  // The institution's file allowance (owner's plan limit, src/lib/file-store.ts).
  const quota = await checkStorageQuotaAs(tenantId, bytes.length)
  if (!quota.allowed) return NextResponse.json({ ...(await apiErr('storageLimit')) }, { status: 413 })
  const path = answerFilePath(tenantId, examId, userId, questionId, ext)
  try {
    await putFile(tenantId, path, bytes, type)
  } catch (e) {
    console.error('[api/exam/answer-file]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('imageUploadFailed')) }, { status: 500 })
  }

  const files = { ...(sub.answer_files ?? {}) }
  const previous = files[questionId]
  files[questionId] = path
  if (!(await saveFiles(tenantId, sub.id, userId, files))) {
    return NextResponse.json({ ...(await apiErr('submissionSaveFailed')) }, { status: 500 })
  }
  // A photo of another format replaced the old one: drop the orphan.
  if (previous && previous !== path) void removeFiles(tenantId, [previous]).catch(() => {})

  const [url] = await signExamFiles([path])
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
  if (auth.fail) return auth.fail
  const { userId, tenantId, sub } = auth

  const files = { ...(sub.answer_files ?? {}) }
  const path = files[body.questionId]
  if (!path) return NextResponse.json({ ok: true })
  delete files[body.questionId]
  if (!(await saveFiles(tenantId, sub.id, userId, files))) {
    return NextResponse.json({ ...(await apiErr('submissionSaveFailed')) }, { status: 500 })
  }
  void removeFiles(tenantId, [path]).catch(() => {})
  return NextResponse.json({ ok: true })
}
