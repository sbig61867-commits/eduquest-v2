import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { loadAnnouncementAuthor } from '@/lib/announcement-author'
import { rateLimit } from '@/lib/rate-limit'
import { checkStorageQuotaAs, publicFileUrl, putFile } from '@/lib/file-store'

// Uploads an announcement image to the file store under public/announcements/
// (src/lib/file-store.ts: any signed-in user may view it, as the public bucket
// allowed). Only after the caller's `manage_announcements` capability is
// verified on their live row (loadAnnouncementAuthor) and the file is validated.
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

export async function POST(request: Request) {
  const auth = await loadAnnouncementAuthor()
  if ('error' in auth) return auth.error
  const user = { id: auth.author.id }
  const tenantId = auth.author.tenant_id

  const limit = await rateLimit(`announcement_upload:${user.id}`, { limit: 20, windowSecs: 3600 })
  if (!limit.allowed) {
    return NextResponse.json({ ...(await apiErr('rateLimited')) }, { status: 429 })
  }

  let file: File | null = null
  try {
    const form = await request.formData()
    const f = form.get('file')
    if (f instanceof File) file = f
  } catch {
    return NextResponse.json({ ...(await apiErr('badRequest')) }, { status: 400 })
  }
  if (!file) return NextResponse.json({ ...(await apiErr('noFileUploaded')) }, { status: 400 })

  const ext = ALLOWED.get(file.type)
  if (!ext) return NextResponse.json({ ...(await apiErr('unsupportedImage')) }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ ...(await apiErr('imageTooLarge4')) }, { status: 400 })

  const bytes = new Uint8Array(await file.arrayBuffer())

  // Verify the actual bytes match a real image signature — the declared
  // Content-Type above is client-supplied and not trustworthy on its own.
  const realType = sniffedType(bytes)
  if (!realType || !ALLOWED.has(realType)) {
    return NextResponse.json({ ...(await apiErr('imageContentInvalid')) }, { status: 400 })
  }

  // The institution's file allowance (owner's plan limit, src/lib/file-store.ts).
  const quota = await checkStorageQuotaAs(tenantId, bytes.length)
  if (!quota.allowed) return NextResponse.json({ ...(await apiErr('storageLimit')) }, { status: 413 })
  // Tenant-scoped key keeps one institution's uploads out of another's folder.
  const path = `public/announcements/${tenantId}/${crypto.randomUUID()}.${ext}`
  try {
    await putFile(tenantId, path, bytes, realType)
  } catch (e) {
    console.error('[api/announcements/upload]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('imageUploadFailed')) }, { status: 500 })
  }

  return NextResponse.json({ url: publicFileUrl(path) }, { status: 201 })
}
