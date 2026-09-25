import { can, type PermissionMap } from '@/lib/permissions'

// ── Announcement audiences ────────────────────────────────────────
// A tenant holds two student populations that overlap: the university's own
// students and the continuing-education centre's trainees (an external trainee
// may be neither enrolled at the university nor known to it, and a university
// student may also take a centre course).
//
//   all        — every student in the tenant
//   university — students flagged `is_university_student`
//   center     — centre students (flag off, or enrolled in a course)
//   groups     — the selected groups only
//
// Reaching beyond the centre requires `announce_to_university`
// (university_admin default ON, center_manager default OFF, granted by the
// owner/admin chain). An author without it is pinned to the centre: their
// announcement carries `center_students_only`, which the student feed applies
// on top of the audience — so even a 'groups' announcement reaches only the
// centre students inside those groups.
export const ANNOUNCEMENT_AUDIENCES = ['all', 'university', 'center', 'groups'] as const
export type AnnouncementAudience = (typeof ANNOUNCEMENT_AUDIENCES)[number]

/** Audiences that reach students outside the centre. */
const UNIVERSITY_REACHING: AnnouncementAudience[] = ['all', 'university']

export function isAnnouncementAudience(value: unknown): value is AnnouncementAudience {
  return ANNOUNCEMENT_AUDIENCES.includes(value as AnnouncementAudience)
}

/** May this staff member target students beyond the centre? */
export function canTargetUniversity(
  role: string | null | undefined,
  permissions: PermissionMap,
): boolean {
  return can(role, permissions, 'announce_to_university')
}

export interface AudienceDecision {
  audience: AnnouncementAudience
  center_students_only: boolean
}

// An API error code; the route translates it into the caller's language.
export const AUDIENCE_DENIED = 'audienceDenied' as const

/**
 * Resolve the audience a request may actually use.
 * `center_students_only` is decided HERE from the author's capability and is
 * never read from the request body.
 */
export function resolveAudience(
  requested: unknown,
  mayTargetUniversity: boolean,
): AudienceDecision | { error: typeof AUDIENCE_DENIED } {
  const audience: AnnouncementAudience = isAnnouncementAudience(requested)
    ? requested
    : (mayTargetUniversity ? 'all' : 'center')

  if (!mayTargetUniversity && UNIVERSITY_REACHING.includes(audience)) {
    return { error: AUDIENCE_DENIED }
  }
  return { audience, center_students_only: !mayTargetUniversity }
}

/**
 * May this author edit/publish an EXISTING announcement? An author pinned to
 * the centre must not take over one that reaches university students — which
 * includes toggling its publication state.
 */
export function canEditAnnouncement(
  existing: { audience: string; center_students_only?: boolean | null },
  mayTargetUniversity: boolean,
): boolean {
  if (mayTargetUniversity) return true
  return existing.center_students_only === true || existing.audience === 'center'
}
