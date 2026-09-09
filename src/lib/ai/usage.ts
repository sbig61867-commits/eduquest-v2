import { createClient } from '@supabase/supabase-js'

// Fire-and-forget usage tracking for the super_admin AI-usage dashboard.
// Uses the service-role client because ai_usage_log has no INSERT policy
// (write-only-via-service-role, same pattern as staff_requests/announcements).
// Never throws — a logging failure must not break the actual AI feature.
export async function logAiUsage(
  userId: string,
  tenantId: string | null,
  feature: string,
  provider: string
): Promise<void> {
  try {
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    await admin.from('ai_usage_log').insert({ user_id: userId, tenant_id: tenantId, feature, provider })
  } catch (e) {
    console.error('[ai-usage] log failed:', e instanceof Error ? e.message : e)
  }
}
