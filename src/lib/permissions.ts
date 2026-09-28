import type { Role } from '@/types'

// ── Capability model ──────────────────────────────────────────────
// Per-user capability flags stored in `users.permissions` (JSONB).
// The owner (super_admin) configures each university_admin; a
// university_admin configures each center_manager and may never grant a
// capability they do not hold themselves (see canGrant / assertGrantable).
//
// Defaults are resolved HERE, not in the DB, so the column can stay '{}'
// and existing admins keep every capability (non-breaking rollout):
//   super_admin      → everything, always, never restrictable
//   university_admin → default ON  (owner may switch a capability off)
//   center_manager   → default OFF (admin must switch a capability on)
//   teacher/student  → none of these staff capabilities
export const CAPABILITIES = [
  'manage_teachers',
  'manage_students',
  'manage_groups',
  'manage_invitations',
  'manage_announcements',
  'announce_to_university',
  'manage_schedules',
  'manage_courses',
  'manage_attendance',
  'view_reports',
  'manage_center_staff',
  'manage_academic_structure',
] as const

export type Capability = (typeof CAPABILITIES)[number]

// Display names and hints live in src/messages/<locale>/staff.json
// (`staff.capabilities`), so they follow the viewer's language.

/** Roles that carry staff capabilities at all. */
export const STAFF_ROLES: Role[] = ['super_admin', 'university_admin', 'center_manager']

export type PermissionMap = Record<string, unknown> | null | undefined

/** Does this user hold `cap`? */
export function can(role: string | null | undefined, permissions: PermissionMap, cap: Capability): boolean {
  if (role === 'super_admin') return true
  // Only staff roles carry these capabilities at all. Checked BEFORE reading the
  // map so a stray flag on a teacher/student row can never grant one — the map is
  // data, and the role is the gate. (Defence in depth: users_update also pins the
  // permissions column, so a user cannot write their own flags.)
  if (!STAFF_ROLES.includes(role as Role)) return false
  const explicit = permissions?.[cap]
  if (typeof explicit === 'boolean') return explicit
  // Unset → fall back to the role default.
  if (role === 'university_admin') return true
  return false
}

/** Effective capability map, useful for rendering toggle UIs. */
export function resolvePermissions(
  role: string | null | undefined,
  permissions: PermissionMap,
): Record<Capability, boolean> {
  return Object.fromEntries(
    CAPABILITIES.map(c => [c, can(role, permissions, c)]),
  ) as Record<Capability, boolean>
}

/**
 * Which roles may edit whose capabilities.
 * The owner configures admins; an admin configures centre managers.
 */
export function canEditPermissionsOf(
  editorRole: string | null | undefined,
  targetRole: string | null | undefined,
): boolean {
  if (editorRole === 'super_admin') return targetRole === 'university_admin' || targetRole === 'center_manager'
  if (editorRole === 'university_admin') return targetRole === 'center_manager'
  return false
}

/**
 * Privilege-escalation guard: you can only grant what you hold.
 * Returns the capabilities in `requested` the editor is not allowed to turn on.
 */
export function ungrantableCapabilities(
  editorRole: string | null | undefined,
  editorPermissions: PermissionMap,
  requested: Record<string, boolean>,
): Capability[] {
  return CAPABILITIES.filter(
    cap => requested[cap] === true && !can(editorRole, editorPermissions, cap),
  )
}

/** Keep only known capability keys, coerced to booleans. */
export function sanitizePermissions(input: unknown): Record<Capability, boolean> {
  const raw = (input ?? {}) as Record<string, unknown>
  return Object.fromEntries(
    CAPABILITIES.filter(c => typeof raw[c] === 'boolean').map(c => [c, raw[c] as boolean]),
  ) as Record<Capability, boolean>
}
