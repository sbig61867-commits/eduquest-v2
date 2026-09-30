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
// `examType` / `hasManualQuestions` come from the student exam list
// (src/lib/data/student-exams.ts — students have no exams SELECT, and the list
// carries no questions; get_student_exam_list computes has_manual_questions
// with the same rule as isAutoGradable). An exam missing from that list
// (archived, unenrolled) has an unknown type, so only a published grade is
// shown for it.

/** mcq / true_false (or a pre-types row) — the teacher results screen's isAutoQ. */
export function isAutoGradable(q: { type?: string | null }): boolean {
  return !q.type || q.type === 'mcq' || q.type === 'true_false'
}

export function isScoreVisible(
  gradingStatus: string | null | undefined,
  examType: string | null | undefined,
  hasManualQuestions?: boolean | null,
): boolean {
  if (gradingStatus === 'published') return true
  if (examType == null || examType === 'homework') return false
  return !hasManualQuestions
}
