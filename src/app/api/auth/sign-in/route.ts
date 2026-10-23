import { NextResponse } from 'next/server'
import { apiErr } from '@/lib/api-error'
import { startSession } from '@/lib/auth/sign-in'

// Sign in with email + password (member IDs use /api/auth/login-id). Limits:
// per Cloudflare client IP and per account, inside authSignIn.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const email = typeof body.email === 'string' ? body.email.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  if (!email || !password) return NextResponse.json({ ...(await apiErr('invalidCredentials')) }, { status: 400 })
  return startSession(email, password, request)
}
