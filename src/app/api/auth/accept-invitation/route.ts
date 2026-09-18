import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { rateLimit } from '@/lib/rate-limit'
import { checkStudentLimit, STUDENT_LIMIT_MESSAGE } from '@/lib/student-limit'

function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function POST(request: Request) {
 try {
  // Rate-limit by IP: 5 registration attempts per hour per IP to prevent bulk account creation
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const rl = await rateLimit(`accept-invitation:${ip}`, { limit: 5, windowSecs: 3600 })
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'طلبات كثيرة جداً. حاول لاحقاً.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } }
    )
  }

  let body: { token?: string; email?: string; password?: string; fullName?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 }) }

  const { token, email, password, fullName } = body

  if (!token || !email || !password || !fullName) {
    return NextResponse.json({ error: 'حقول مطلوبة ناقصة' }, { status: 400 })
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'يجب ألا تقل كلمة المرور عن 8 أحرف' }, { status: 400 })
  }
  if (fullName.trim().length < 2) {
    return NextResponse.json({ error: 'يجب ألا يقل الاسم الكامل عن حرفين' }, { status: 400 })
  }

  const cleanEmail = email.trim().toLowerCase()
  const admin = getAdminClient()

  // ── Step 1: validate & lock invitation ───────────────────────
  const { data: inv, error: invErr } = await admin
    .from('invitations')
    .select('id, role, tenant_id, email, group_id, course_id, is_public, max_uses, use_count, status, expires_at, is_university_student')
    .eq('token', token)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .single()

  if (invErr || !inv) {
    return NextResponse.json(
      { error: 'رابط الدعوة غير صالح أو منتهي الصلاحية.' },
      { status: 410 }
    )
  }

  // Check max_uses for public links
  if (inv.is_public && inv.max_uses != null && inv.use_count >= inv.max_uses) {
    return NextResponse.json(
      { error: 'بلغ رابط الدعوة الحد الأقصى لعدد الاستخدامات.' },
      { status: 410 }
    )
  }

  // ── Step 2: verify email for private invitations ──────────────
  if (!inv.is_public) {
    if (!inv.email || inv.email.toLowerCase() !== cleanEmail) {
      return NextResponse.json(
        { error: 'البريد الإلكتروني لا يطابق هذه الدعوة.' },
        { status: 403 }
      )
    }
  }

  // ── Step 2b: plan seat cap (students only) ───────────────────
  // Checked before the auth user is created so a refusal needs no rollback.
  // Public multi-use links are the main way a tenant could silently exceed
  // its plan, so this is the check that actually matters in practice.
  if (inv.role === 'student') {
    const seat = await checkStudentLimit(admin, inv.tenant_id)
    if (!seat.allowed) {
      return NextResponse.json({ error: STUDENT_LIMIT_MESSAGE }, { status: 403 })
    }
  }

  // ── Step 3: create auth user ──────────────────────────────────
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email: cleanEmail,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName.trim() },
  })

  if (authError) {
    const m = (authError.message ?? '').toLowerCase()
    // Supabase signals a duplicate via several shapes depending on version:
    // message contains "already"/"registered"/"exists", code 'email_exists', or HTTP 422.
    const isDuplicate =
      m.includes('already') || m.includes('registered') || m.includes('exists') ||
      authError.code === 'email_exists' || authError.status === 422
    if (isDuplicate) {
      return NextResponse.json(
        { error: 'يوجد حساب بهذا البريد بالفعل. جرّب تسجيل الدخول.' },
        { status: 409 }
      )
    }
    console.error('[accept-invitation] createUser error:', authError)
    return NextResponse.json({ error: authError.message || 'Could not create account.' }, { status: 400 })
  }

  const userId = authData.user.id

  try {
    // ── Step 3b: carry the invitation's student population onto the profile.
    // Written before accept_invitation so a failure here still lands in the
    // rollback below (the placeholder profile row already exists, created by
    // the handle_new_user trigger). accept_invitation itself is left untouched
    // — supabase/fix_rls_write_path_migration.sql is still pending on it.
    if (inv.role === 'student') {
      const { error: affErr } = await admin
        .from('users')
        .update({ is_university_student: inv.is_university_student !== false })
        .eq('id', userId)
      if (affErr) throw new Error(`student affiliation: ${affErr.message}`)
    }

    // ── Steps 4-7, atomically: the earlier SELECT (above) was only a
    // fail-fast/email-match check and is NOT race-safe on its own — two
    // concurrent accepts of a multi-use link could both pass it before
    // either write happened. `accept_invitation` re-validates status/expiry/
    // max_uses under `SELECT ... FOR UPDATE` in one transaction, then sets
    // role/tenant/full_name on the (trigger-created) profile row, marks the
    // invitation used, and enrolls the student in the group/course — so a
    // link capped at N uses can never admit more than N under concurrency.
    const { error: rpcErr } = await admin.rpc('accept_invitation', {
      p_token: token,
      p_user_id: userId,
      p_full_name: fullName.trim(),
    })

    if (rpcErr) {
      const code = rpcErr.message ?? ''
      if (code.includes('INVITATION_INVALID_OR_EXPIRED')) {
        // Someone else consumed the last use (or it expired) between our
        // fail-fast check and this atomic accept — not a server error.
        await admin.auth.admin.deleteUser(userId).catch(e =>
          console.error('[accept-invitation] ROLLBACK FAILED, orphaned user:', userId, e)
        )
        return NextResponse.json(
          { error: 'رابط الدعوة غير صالح أو منتهٍ أو بلغ حده الأقصى من الاستخدامات.' },
          { status: 410 }
        )
      }
      throw new Error(`accept_invitation: ${rpcErr.message}`)
    }

    return NextResponse.json({ email: cleanEmail })

  } catch (err) {
    // Rollback: delete the auth user so the email can be used again
    await admin.auth.admin.deleteUser(userId).catch(e =>
      console.error('[accept-invitation] ROLLBACK FAILED, orphaned user:', userId, e)
    )
    const detail = err instanceof Error ? err.message : String(err)
    console.error('[accept-invitation] error after auth user created:', detail)
    return NextResponse.json(
      { error: 'فشل التسجيل. حاول مجدداً أو تواصل مع الدعم.' },
      { status: 500 }
    )
  }
 } catch (outer) {
    // Any unhandled error in steps 1-3 (before the auth user is created) lands here.
    // Without this, the route would return a 500 HTML page and the client would
    // show its generic "Registration failed" fallback, hiding the real cause.
    const detail = outer instanceof Error ? outer.message : String(outer)
    console.error('[accept-invitation] unhandled error:', detail)
    return NextResponse.json(
      { error: 'فشل التسجيل بسبب خطأ في الخادم. حاول مجدداً أو تواصل مع الدعم.' },
      { status: 500 }
    )
 }
}
