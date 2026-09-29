import type { SupabaseClient } from '@supabase/supabase-js'

// Per-institution file storage limit set by the owner:
//   tenants.storage_limit_mb — MB of files in the exam-files and
//   announcement-images buckets. NULL = no cap.
// Usage comes from tenant_storage_bytes() (supabase/tenant_storage_limit_migration.sql),
// which sums the institution's objects (every path starts with its tenant id).
//
// Checked by every upload route before the file is stored. Fails OPEN on a
// read error or before the migration is applied, like src/lib/seat-limit.ts:
// an unrelated hiccup never blocks a teacher or a student on its own.

const MB = 1024 * 1024

export interface StorageStatus {
  /** NULL = no cap. */
  limitBytes: number | null
  /** NULL if usage could not be read. */
  usedBytes: number | null
  /** May `incomingBytes` more be stored? */
  allowed: boolean
}

/** Status from a raw limit (MB) + usage (pure; exported for tests). */
export function storageStatus(limitMb: unknown, usedBytes: number | null, incomingBytes = 0): StorageStatus {
  const limitBytes = typeof limitMb === 'number' && Number.isFinite(limitMb) ? limitMb * MB : null
  if (limitBytes === null || usedBytes === null) return { limitBytes, usedBytes, allowed: true }
  return { limitBytes, usedBytes, allowed: usedBytes + incomingBytes <= limitBytes }
}

async function usedBytes(client: SupabaseClient, tenantId: string): Promise<number | null> {
  const { data, error } = await client.rpc('tenant_storage_bytes', { p_tenant: tenantId })
  if (error) {
    console.error('[storage-quota] usage read failed, allowing:', error.message)
    return null
  }
  const n = Number(data)
  return Number.isFinite(n) ? n : null
}

/**
 * Before an upload. `client` must be the service-role client (the routes
 * already hold one). `*` so it keeps working before storage_limit_mb exists.
 */
export async function checkStorageQuota(client: SupabaseClient, tenantId: string, incomingBytes: number): Promise<StorageStatus> {
  const { data: tenant, error } = await client.from('tenants').select('*').eq('id', tenantId).maybeSingle()
  if (error || !tenant) {
    if (error) console.error('[storage-quota] tenant read failed, allowing:', error.message)
    return { limitBytes: null, usedBytes: null, allowed: true }
  }
  const limitMb = (tenant as Record<string, unknown>).storage_limit_mb
  if (limitMb == null) return { limitBytes: null, usedBytes: null, allowed: true }
  return storageStatus(limitMb, await usedBytes(client, tenantId), incomingBytes)
}

/** For the owner's institution cards (super_admin session). */
export async function getStorageUsage(client: SupabaseClient, tenantId: string, limitMb: unknown): Promise<StorageStatus> {
  return storageStatus(limitMb, await usedBytes(client, tenantId))
}

export function formatMb(bytes: number): string {
  return (bytes / MB).toFixed(bytes < 10 * MB ? 1 : 0)
}
