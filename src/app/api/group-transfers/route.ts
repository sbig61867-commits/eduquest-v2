import { apiErr, type ApiErrorCode } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { run, maybeOne } from '@/lib/db/sql'
import { getCaller, staffCan } from '@/lib/staff-auth'

// Move a student from one group to another on request.
// Capability `manage_students` (university_admin default-on, centre manager
// only when granted) is checked on the caller's live row; the move itself runs in
// transfer_student_group() as app_service pinned to the institution, which re-checks tenant,
// seat cap and membership atomically and freezes the old course's progress
// (group_course_transfer_migration.sql).

// RPC domain errors -> [HTTP status, API error code]
const ERRORS: Record<string, [number, ApiErrorCode]> = {
  FORBIDDEN:          [403, 'cannotTransfer'],
  STUDENT_NOT_FOUND:  [404, 'studentNotFound'],
  GROUP_NOT_FOUND:    [404, 'groupNotFound'],
  SAME_GROUP:         [400, 'sameGroup'],
  REASON_REQUIRED:    [400, 'transferReasonRequired'],
  GROUP_ARCHIVED:     [409, 'targetGroupArchived'],
  NOT_IN_GROUP:       [409, 'studentNotInSourceGroup'],
  ALREADY_IN_GROUP:   [409, 'studentAlreadyInTarget'],
  GROUP_FULL:         [409, 'targetGroupFull'],
}

export async function POST(request: Request) {
  const res = await getCaller()
  if ('error' in res) return res.error
  const { caller } = res
  if (!staffCan(caller, 'manage_students')) {
    return NextResponse.json({ ...(await apiErr(ERRORS.FORBIDDEN[1])) }, { status: 403 })
  }

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const studentId = typeof body.student_id === 'string' ? body.student_id : ''
  const fromGroup = typeof body.from_group_id === 'string' ? body.from_group_id : ''
  const toGroup = typeof body.to_group_id === 'string' ? body.to_group_id : ''
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (!studentId || !fromGroup || !toGroup) {
    return NextResponse.json({ ...(await apiErr('missingTransferFields')) }, { status: 400 })
  }
  if (reason.length < 3 || reason.length > 500) {
    return NextResponse.json({ ...(await apiErr('transferReasonLength')) }, { status: 400 })
  }

  let transferId: unknown
  try {
    const [rows] = await run({ as: 'service', tenantId: caller.tenant_id }, sql => [
      sql`select public.transfer_student_group(p_actor => ${caller.id}, p_student_id => ${studentId}::uuid,
            p_from_group => ${fromGroup}::uuid, p_to_group => ${toGroup}::uuid, p_reason => ${reason}) as id`,
    ])
    transferId = maybeOne<{ id: unknown }>(rows)?.id
  } catch (e) {
    const message = e instanceof Error ? e.message : ''
    const known = Object.keys(ERRORS).find(k => message.includes(k))
    if (known) {
      const [status, code] = ERRORS[known]
      return NextResponse.json({ ...(await apiErr(code)) }, { status })
    }
    // a malformed id is not one of this institution's students or groups
    if ((e as { code?: string }).code === '22P02') return NextResponse.json({ ...(await apiErr('studentNotFound')) }, { status: 404 })
    console.error('[api/group-transfers POST]', message)
    return NextResponse.json({ ...(await apiErr('transferFailed')) }, { status: 500 })
  }

  return NextResponse.json({ transfer_id: transferId }, { status: 201 })
}
