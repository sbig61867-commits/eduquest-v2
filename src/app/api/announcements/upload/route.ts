import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { can } from '@/lib/permissions'
import { rateLimit } from '@/lib/rate-limit'

// Uploads an announcement image to the public `announcement-images` bucket.
// The upload itself runs through the service-role client (bypassing storage
// RLS) only after the caller's `manage_announcements` capability is verified
// and the file is validated, so the bucket needs no write policy of its own.
const BUCKET = 'announcement-images'
const MAX_BYTES = 4 * 1024 * 1024 // 4 MB
const ALLOWED = new Map<string, string>([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
])

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('users').select('role, tenant_id, permissions').eq('id', user.id).single()
  if (!profile?.tenant_id || !can(profile.role, profile.permissions, 'manage_announcements')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const limit = await rateLimit(`announcement_upload:${user.id}`, { limit: 20, windowSecs: 3600 })
  if (!limit.allowed) {
    return NextResponse.json({ error: 'تجاوزت الحد المسموح، حاول لاحقاً' }, { status: 429 })
  }

  let file: File | null = null
  try {
    const form = await request.formData()
    const f = form.get('file')
    if (f instanceof File) file = f
  } catch {
    return NextResponse.json({ error: 'طلب غير صالح' }, { status: 400 })
  }
  if (!file) return NextResponse.json({ error: 'لم يتم إرسال ملف' }, { status: 400 })

  const ext = ALLOWED.get(file.type)
  if (!ext) return NextResponse.json({ error: 'صيغة غير مدعومة (JPG/PNG/WebP/GIF فقط)' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'حجم الصورة يتجاوز 4 ميغابايت' }, { status: 400 })

  const admin = adminClient()
  // Tenant-scoped path keeps one institution's uploads out of another's folder.
  const path = `${profile.tenant_id}/${crypto.randomUUID()}.${ext}`
  const bytes = new Uint8Array(await file.arrayBuffer())

  const { error } = await admin.storage.from(BUCKET).upload(path, bytes, {
    contentType: file.type,
    upsert: false,
  })
  if (error) {
    console.error('[api/announcements/upload]', error)
    return NextResponse.json({ error: 'تعذّر رفع الصورة' }, { status: 500 })
  }

  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path)
  return NextResponse.json({ url: pub.publicUrl }, { status: 201 })
}
