import { apiErr, type ApiErrorCode } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { getCaller, serviceClient, staffCan } from '@/lib/staff-auth'

// Move a student from one group to another on request.
// Capability `manage_students` (university_admin default-on, centre manager
// only when granted) is checked with the user session; the move itself runs in
// transfer_student_group() on the service-role client, which re-checks tenant,
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

  const { data, error } = await serviceClient().rpc('transfer_student_group', {
    p_actor: caller.id,
    p_student_id: studentId,
    p_from_group: fromGroup,
    p_to_group: toGroup,
    p_reason: reason,
  })

  if (error) {
    const known = Object.keys(ERRORS).find(k => error.message?.includes(k))
    if (known) {
      const [status, code] = ERRORS[known]
      return NextResponse.json({ ...(await apiErr(code)) }, { status })
    }
    console.error('[api/group-transfers POST]', error)
    return NextResponse.json({ ...(await apiErr('transferFailed')) }, { status: 500 })
  }

  return NextResponse.json({ transfer_id: data }, { status: 201 })
}
