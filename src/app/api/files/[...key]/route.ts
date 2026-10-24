import { NextResponse } from 'next/server'
import { apiErr } from '@/lib/api-error'
import { currentCtx } from '@/lib/auth/current'
import { PUBLIC_PREFIX, readStoredFile, verifyFileSignature } from '@/lib/file-store'

// GET /api/files/<key> — serves one object of the file store (src/lib/file-store.ts).
//  - Private keys (task attachments, answer photos, lesson images) need the
//    short-lived signature a page handed out after its own access check
//    (?exp=…&sig=…); a bare or expired link opens nothing.
//  - public/ keys (announcement images) need only a signed-in user, as the
//    public bucket's images were only ever shown inside the app.
// Always a signed-in session as well (the proxy also requires it).
export async function GET(request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  if (!(await currentCtx())) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  const parts = (await params).key
  if (!parts?.length || parts.some(p => !p || p === '.' || p === '..')) {
    return NextResponse.json({ ...(await apiErr('notFound')) }, { status: 404 })
  }
  const key = parts.join('/')
  const isPublic = key.startsWith(PUBLIC_PREFIX)
  if (!isPublic) {
    const q = new URL(request.url).searchParams
    if (!(await verifyFileSignature(key, q.get('exp'), q.get('sig')))) {
      return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
    }
  }
  const file = await readStoredFile(key)
  if (!file) return NextResponse.json({ ...(await apiErr('notFound')) }, { status: 404 })
  return new Response(file.body as BodyInit, {
    headers: {
      'Content-Type': file.contentType,
      'Content-Length': String(file.size),
      'X-Content-Type-Options': 'nosniff',
      // a private file stays in this browser only, and not past its link
      'Cache-Control': isPublic ? 'private, max-age=86400' : 'private, max-age=600',
    },
  })
}
