import { run, type Sql } from '@/lib/db/sql'
import { toTenantSettings, type TenantSettings } from '@/lib/structure-mode'

// A tenant's settings on the SQL layer (server only — kept apart from
// src/lib/structure-mode.ts, which the browser imports).

/** The statement reading a tenant's settings, for a caller's own unit (toTenantSettings on its row). */
export function tenantSettingsSql(sql: Sql, tenantId: string) {
  return sql`select institution_type, structure_mode, has_center from public.tenants where id = ${tenantId}`
}

/** All per-tenant settings in one read, as the caller. */
export async function getTenantSettings(userId: string, tenantId: string): Promise<TenantSettings> {
  const [rows] = await run({ as: 'user', userId }, sql => [tenantSettingsSql(sql, tenantId)])
  return toTenantSettings(rows[0])
}
