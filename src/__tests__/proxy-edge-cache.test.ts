// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

// A signed-out or signed-in session without touching Supabase.
const session = vi.hoisted(() => ({ claims: null as null | Record<string, unknown> }))
vi.mock('@/lib/supabase/middleware', () => ({
  updateSession: async () => ({ supabaseResponse: NextResponse.next(), claims: session.claims, supabase: {} }),
}))

import { proxy } from '@/proxy'

function page(path: string, cookie?: string) {
  const headers: Record<string, string> = { accept: 'text/html,application/xhtml+xml' }
  if (cookie) headers.cookie = cookie
  return new NextRequest(`https://eduquest.test${path}`, { headers })
}

describe('proxy edge cache for /<locale>/ marketing pages', () => {
  beforeEach(() => { session.claims = null })

  it('caches a first visit: no eq_locale cookie is set, so the CDN may keep the page', async () => {
    const res = await proxy(page('/ar'))
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(res.headers.get('Vercel-CDN-Cache-Control')).toContain('public')
  })

  it('caches a returning visitor whose cookie names another language', async () => {
    const res = await proxy(page('/en/features', 'eq_locale=ar'))
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(res.headers.get('Vercel-CDN-Cache-Control')).toContain('public')
  })

  it('never caches an RSC navigation', async () => {
    const res = await proxy(new NextRequest('https://eduquest.test/ar/about', { headers: { accept: 'text/x-component' } }))
    expect(res.headers.get('Vercel-CDN-Cache-Control')).toBeNull()
  })

  it('still remembers the URL language for a signed-in user, and never caches their page', async () => {
    session.claims = { sub: 'u1', app_metadata: { user_role: 'teacher', is_active: true, tenant_id: 't1' } }
    const res = await proxy(page('/en/about', 'eq_locale=ar'))
    expect(res.headers.get('set-cookie')).toContain('eq_locale=en')
    expect(res.headers.get('Vercel-CDN-Cache-Control')).toBeNull()
  })
})

describe('proxy public paths for proctoring', () => {
  beforeEach(() => { session.claims = null })

  it('serves the on-device models and the phone camera page without a session', async () => {
    for (const path of ['/models/human/blazeface.json', '/models/human/faceres.bin', '/cam/abc.def']) {
      const res = await proxy(new NextRequest(`https://eduquest.test${path}`))
      expect(res.headers.get('location')).toBeNull()
    }
  })

  it('still sends a signed-out visitor away from the student area', async () => {
    const res = await proxy(new NextRequest('https://eduquest.test/student/exams'))
    expect(res.headers.get('location')).toContain('/login')
  })
})
