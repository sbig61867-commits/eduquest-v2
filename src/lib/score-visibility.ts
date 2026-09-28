// When may a student see the score on one of their own submissions?
//
// finalize_exam_submission writes the auto-graded score to exam_submissions
// (and grades) at submit time for EVERY exam, so "score IS NOT NULL" is not a
// visibility rule. Mirrors /api/exam/submit: a regular exam's score is shown
// as soon as it is submitted; homework only once it is 'published' (by the
// teacher, or by auto-publish when every question is auto-gradable).
//
// `examType` comes from get_student_exams (students have no exams SELECT). An
// exam missing from that feed (archived, unenrolled) has an unknown type, so
// only a published grade is shown for it.
export function isScoreVisible(
  gradingStatus: string | null | undefined,
  examType: string | null | undefined,
): boolean {
  if (gradingStatus === 'published') return true
  return examType != null && examType !== 'homework'
}
