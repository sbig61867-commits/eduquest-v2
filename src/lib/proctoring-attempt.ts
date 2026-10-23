import type { JSONValue } from 'postgres'
import { run, maybeOne } from '@/lib/db/sql'
import { onRosterSql } from '@/lib/exam-roster'

// What every student-side proctoring route checks before it records anything
// (evidence snapshots and clips, the second camera): the exam is published and
// proctored, the student is on its roster, and their attempt. One unit, as
// app_service pinned to the student's institution (students cannot read exams).

export interface ProctoredAttempt {
  proctored: boolean
  onRoster: boolean
  attempt: { status: string; proctoring_events: unknown } | null
}

export async function loadProctoredAttempt(tenantId: string, examId: string, studentId: string): Promise<ProctoredAttempt> {
  const [examRows, attemptRows] = await run({ as: 'service', tenantId }, sql => [
    sql`select e.proctoring_enabled, ${onRosterSql(sql, studentId)} as on_roster from public.exams e where e.id = ${examId} and e.is_published`,
    sql`select status, proctoring_events from public.exam_submissions where exam_id = ${examId} and student_id = ${studentId}`,
  ])
  const exam = maybeOne<{ proctoring_enabled: boolean | null; on_roster: boolean }>(examRows)
  return {
    proctored: exam?.proctoring_enabled === true,
    onRoster: exam?.on_roster === true,
    attempt: maybeOne<{ status: string; proctoring_events: unknown }>(attemptRows),
  }
}

/** Appends events through the atomic appender (it only writes while the attempt is in progress). */
export async function appendProctoringEvents(tenantId: string, examId: string, studentId: string, events: Record<string, string | boolean | number | undefined>[]): Promise<void> {
  await run({ as: 'service', tenantId }, sql => [sql`select public.append_proctoring_events(${examId}, ${studentId}, ${sql.json(events as unknown as JSONValue)})`])
}
