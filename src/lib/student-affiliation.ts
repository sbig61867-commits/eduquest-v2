import { can, type PermissionMap } from '@/lib/permissions'

// ── Who is a university student? ──────────────────────────────────
// `users.is_university_student` is explicit (set when the account is created or
// carried on the invitation) because it cannot be derived: an external trainee
// enrolled in one centre course looks exactly like a university student who
// also takes that course. Centre membership, by contrast, IS derived — see
// get_student_announcements() in
// supabase/student_affiliation_announcements_migration.sql.
//
// Classifying a student INTO the university population is gated by the same
// capability that lets you announce to it (`announce_to_university`): someone
// who may not address university students may not move students into that
// audience either.

export interface AffiliationActor {
  role: string | null | undefined
  permissions: PermissionMap
}

/** May this staff member set/clear a student's university affiliation? */
export function canSetAffiliation(actor: AffiliationActor): boolean {
  return can(actor.role, actor.permissions, 'announce_to_university')
}

/**
 * The flag to store for a newly created / invited student.
 * Defaults keep each role's usual intent: a university admin adds university
 * students, a centre manager adds centre trainees. Teachers hold no staff
 * capabilities at all, so their invitations keep the pre-existing behaviour
 * (university student) — an admin can correct any account afterwards.
 */
export function resolveStudentAffiliation(actor: AffiliationActor, requested: unknown): boolean {
  if (actor.role === 'teacher') return true
  if (!canSetAffiliation(actor)) return false
  if (typeof requested === 'boolean') return requested
  return actor.role !== 'center_manager'
}
