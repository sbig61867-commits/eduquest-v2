// When may a student see the score on one of their own submissions?
//
// finalize_exam_submission writes the auto-graded score to exam_submissions
// (and grades) at submit time for EVERY exam, so "score IS NOT NULL" is not a
// visibility rule. Mirrors /api/exam/submit: a regular exam whose questions are
// all auto-gradable shows its score as soon as it is submitted; homework, and
// any exam with a question the teacher grades by hand (essay, short answer),
// only once it is 'published' — until then the number leaves those questions
// out and is not the student's mark (exam logic audit 2026-09-30).
//
// `examType` / `questions` come from get_student_exams (students have no exams
// SELECT). An exam missing from that feed (archived, unenrolled) has an unknown
// type, so only a published grade is shown for it.

/** mcq / true_false (or a pre-types row) — the teacher results screen's isAutoQ. */
export function isAutoGradable(q: { type?: string | null }): boolean {
  return !q.type || q.type === 'mcq' || q.type === 'true_false'
}

export function isScoreVisible(
  gradingStatus: string | null | undefined,
  examType: string | null | undefined,
  questions?: ReadonlyArray<{ type?: string | null }> | null,
): boolean {
  if (gradingStatus === 'published') return true
  if (examType == null || examType === 'homework') return false
  return !(questions ?? []).some(q => !isAutoGradable(q))
}
