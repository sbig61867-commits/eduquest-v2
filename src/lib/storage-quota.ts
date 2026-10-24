
// Per-institution file storage limit set by the owner:
//   tenants.storage_limit_mb — MB of the institution's files in the R2 bucket
//   (src/lib/file-store.ts). NULL = no cap.
// Usage comes from tenant_storage_bytes(), a sum over public.stored_files
// (neon/migrations/0011); the check itself is checkStorageQuotaAs in file-store.
// Fails OPEN on a read error, like the seat limits: an unrelated hiccup never
// blocks a teacher or a student on its own.

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

export function formatMb(bytes: number): string {
  return (bytes / MB).toFixed(bytes < 10 * MB ? 1 : 0)
}
