/**
 * GET /api/debug/groups-health
 * Diagnostic endpoint — traces every step of the group creation flow.
 * Returns a JSON report showing exactly where the failure occurs.
 * DELETE THIS FILE after confirming group creation works.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export async function GET() {
  const report: Record<string, unknown> = {}

  // ── 1. Environment ───────────────────────────────────────────
  report.env = {
    NEXT_PUBLIC_SUPABASE_URL:    !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY:   !!process.env.SUPABASE_SERVICE_ROLE_KEY,
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    report.fatal = 'SUPABASE_SERVICE_ROLE_KEY is not set — admin client cannot bypass RLS'
    return NextResponse.json(report, { status: 500 })
  }

  // ── 2. Session ───────────────────────────────────────────────
  const supabase = await createClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  report.session = { user_id: user?.id ?? null, error: authErr?.message ?? null }

  if (!user) {
    report.fatal = 'No authenticated user — session missing or expired'
    return NextResponse.json(report, { status: 401 })
  }

  // ── 3. Profile read (user session client, subject to RLS) ────
  const { data: profile, error: profileErr } = await supabase
    .from('users')
    .select('id, role, tenant_id, is_active')
    .eq('id', user.id)
    .single()

  report.profile = {
    data: profile ?? null,
    error: profileErr?.message ?? null,
    // If data is null but error is null, RLS returned empty (policy denied read)
    rls_denied: !profile && !profileErr,
  }

  // ── 4. RLS helper functions via SQL (admin client) ───────────
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // Test helper functions as the authenticated user (switch role via rpc)
  // We can't easily test as the user here, so we check the function bodies exist
  const { data: funcCheck, error: funcErr } = await admin
    .from('pg_proc')
    .select('proname, prosrc')
    .in('proname', ['current_user_role', 'current_tenant_id'])
    .limit(2)

  report.db_functions = {
    found: funcCheck?.length ?? 0,
    error: funcErr?.message ?? null,
    note: funcErr ? 'pg_proc not accessible via supabase client — normal' : null,
  }

  // ── 5. Admin client: can it read users? ─────────────────────
  const { data: adminProfile, error: adminProfileErr } = await admin
    .from('users')
    .select('id, role, tenant_id')
    .eq('id', user.id)
    .single()

  report.admin_profile_read = {
    data: adminProfile ?? null,
    error: adminProfileErr?.message ?? null,
  }

  // ── 6. Admin client: can it INSERT a group? (dry run — immediately delete) ──
  if (adminProfile?.tenant_id && adminProfile?.role) {
    const { data: inserted, error: insertErr } = await admin
      .from('groups')
      .insert({
        name: '__health_check_delete_me__',
        description: 'auto-deleted diagnostic insert',
        teacher_id: user.id,
        tenant_id: adminProfile.tenant_id,
      })
      .select('id')
      .single()

    report.admin_insert_test = {
      success: !!inserted,
      inserted_id: inserted?.id ?? null,
      error: insertErr?.message ?? null,
      error_code: insertErr?.code ?? null,
    }

    // Clean up immediately
    if (inserted?.id) {
      await admin.from('groups').delete().eq('id', inserted.id)
      report.admin_insert_test = { ...report.admin_insert_test as object, cleaned_up: true }
    }
  } else {
    report.admin_insert_test = { skipped: 'profile read failed, cannot attempt insert' }
  }

  // ── 7. Summary ───────────────────────────────────────────────
  const insertTest = report.admin_insert_test as { success?: boolean; error?: string }
  report.diagnosis = {
    auth_ok:          !!user,
    profile_ok:       !!profile,
    role_is_teacher:  profile?.role === 'teacher',
    tenant_set:       !!profile?.tenant_id,
    admin_insert_ok:  insertTest?.success ?? false,
    admin_insert_err: insertTest?.error ?? null,
    verdict: insertTest?.success
      ? '✅ Admin client INSERT works — deployment may not be live yet OR frontend still uses old path'
      : insertTest?.error
        ? `❌ Admin client INSERT failed: ${insertTest.error}`
        : '⚠️  Insert test skipped',
  }

  return NextResponse.json(report, { status: 200 })
}
