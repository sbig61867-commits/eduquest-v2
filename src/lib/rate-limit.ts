// Persistent rate limiter — backed by the Postgres `rate_limits` table via the
// atomic `check_rate_limit` RPC. Survives serverless cold starts and works across
// multiple instances (unlike an in-memory Map, which resets per process).
import { createClient as createAdminClient } from '@supabase/supabase-js'

interface RateLimitOptions {
  /** Max requests allowed in the window */
  limit: number
  /** Window duration in seconds */
  windowSecs: number
}

interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number
}

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function rateLimit(key: string, opts: RateLimitOptions): Promise<RateLimitResult> {
  const { data, error } = await adminClient().rpc('check_rate_limit', {
    p_key: key,
    p_limit: opts.limit,
    p_window_secs: opts.windowSecs,
  })

  // Fail-open: if the limiter itself errors, do not block legitimate traffic.
  if (error || !data) {
    return { allowed: true, remaining: opts.limit, resetAt: Date.now() + opts.windowSecs * 1000 }
  }

  const row = data as Record<string, unknown>
  if (
    typeof row.allowed !== 'boolean' ||
    typeof row.remaining !== 'number' ||
    typeof row.reset_at !== 'string'
  ) {
    return { allowed: true, remaining: opts.limit, resetAt: Date.now() + opts.windowSecs * 1000 }
  }
  return {
    allowed: row.allowed,
    remaining: row.remaining,
    resetAt: new Date(row.reset_at).getTime(),
  }
}
