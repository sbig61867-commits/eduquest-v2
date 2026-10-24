import { run, type Sql } from '@/lib/db/sql'
import type { InstitutionType, StructureMode } from '@/types'
import { isInstitutionType } from '@/lib/terminology'

// Per-tenant opt-in for the academic structure (faculties/departments + terms).
// 'flat' is the original structure and the default; see
// supabase/academic_structure_migration.sql, whose triggers enforce the same rule.

export function isAcademicMode(mode: unknown): boolean {
  return mode === 'academic'
}

export interface TenantSettings {
  institution_type: InstitutionType
  structure_mode: StructureMode
  /** Has a continuing-education centre (student affiliation split + center_manager). */
  has_center: boolean
}

/** Normalise a raw tenants row (possibly pre-migration, so columns may be absent). */
export function toTenantSettings(row: Record<string, unknown> | null | undefined): TenantSettings {
  return {
    institution_type: isInstitutionType(row?.institution_type) ? row.institution_type : 'university',
    structure_mode: isAcademicMode(row?.structure_mode) ? 'academic' : 'flat',
    // Absent (pre-migration) or anything but an explicit false ⇒ keep today's centre features.
    has_center: row?.has_center !== false,
  }
}

/** The statement reading a tenant's settings, for a caller's own unit (toTenantSettings on its row). */
export function tenantSettingsSql(sql: Sql, tenantId: string) {
  return sql`select institution_type, structure_mode, has_center from public.tenants where id = ${tenantId}`
}

/** All per-tenant settings in one read, as the caller. */
export async function getTenantSettings(userId: string, tenantId: string): Promise<TenantSettings> {
  const [rows] = await run({ as: 'user', userId }, sql => [tenantSettingsSql(sql, tenantId)])
  return toTenantSettings(rows[0])
}
