import type { SupabaseClient } from '@supabase/supabase-js'
import type { InstitutionType, StructureMode } from '@/types'
import { isInstitutionType } from '@/lib/terminology'

// Per-tenant opt-in for the academic structure (faculties/departments + terms).
// 'flat' is the original structure and the default; see
// supabase/academic_structure_migration.sql, whose triggers enforce the same rule.

export function isAcademicMode(mode: unknown): boolean {
  return mode === 'academic'
}

/**
 * Reads the tenant's mode. Selects `*` on purpose: before the migration is
 * applied the column does not exist, and naming it would fail the query —
 * `*` simply omits it, which resolves to 'flat'.
 */
export async function getTenantStructureMode(client: SupabaseClient, tenantId: string): Promise<StructureMode> {
  const { data } = await client.from('tenants').select('*').eq('id', tenantId).maybeSingle()
  return isAcademicMode((data as { structure_mode?: unknown } | null)?.structure_mode) ? 'academic' : 'flat'
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

/** All per-tenant settings in one read; `*` for the same pre-migration reason as above. */
export async function getTenantSettings(client: SupabaseClient, tenantId: string): Promise<TenantSettings> {
  const { data } = await client.from('tenants').select('*').eq('id', tenantId).maybeSingle()
  return toTenantSettings(data as Record<string, unknown> | null)
}
