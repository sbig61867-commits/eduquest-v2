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

// The client-supplied Content-Type header is not proof of the actual bytes —
// check the real file signature (magic numbers) so a renamed/relabeled
// non-image file can't ride through the MIME allowlist above.
function sniffedType(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'image/gif'
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return 'image/webp'
  return null
}

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
  if (!user) return NextResponse.json({ error: 'غير مصرّح' }, { status: 401 })

  const { data: profile } = await supabase
    .from('users').select('role, tenant_id, permissions').eq('id', user.id).single()
  if (!profile?.tenant_id || !can(profile.role, profile.permissions, 'manage_announcements')) {
    return NextResponse.json({ error: 'ممنوع' }, { status: 403 })
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

  const bytes = new Uint8Array(await file.arrayBuffer())

  // Verify the actual bytes match a real image signature — the declared
  // Content-Type above is client-supplied and not trustworthy on its own.
  const realType = sniffedType(bytes)
  if (!realType || !ALLOWED.has(realType)) {
    return NextResponse.json({ error: 'محتوى الملف لا يطابق صورة صالحة' }, { status: 400 })
  }

  const admin = adminClient()
  // Tenant-scoped path keeps one institution's uploads out of another's folder.
  const path = `${profile.tenant_id}/${crypto.randomUUID()}.${ext}`

  const { error } = await admin.storage.from(BUCKET).upload(path, bytes, {
    contentType: realType,
    upsert: false,
  })
  if (error) {
    console.error('[api/announcements/upload]', error)
    return NextResponse.json({ error: 'تعذّر رفع الصورة' }, { status: 500 })
  }

  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path)
  return NextResponse.json({ url: pub.publicUrl }, { status: 201 })
}
