import type { Role } from '@/types'

/** Display names of the roles other than university_admin, whose name follows the institution type. */
export type RoleLabels = Record<Exclude<Role, 'university_admin'>, string>
