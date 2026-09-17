import { randomBytes } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt, encrypt } from './crypto'

// Google mailbox linking. A dedicated OAuth client ("EduQuest Mail") — NOT the
// sign-in client Supabase uses — so this can never break Google login.
// Env: GOOGLE_MAIL_CLIENT_ID, GOOGLE_MAIL_CLIENT_SECRET.

export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send'
const SCOPES = ['openid', 'email', GMAIL_SEND_SCOPE]

export function googleMailConfigured(): boolean {
  return !!(process.env.GOOGLE_MAIL_CLIENT_ID && process.env.GOOGLE_MAIL_CLIENT_SECRET && process.env.MAIL_TOKEN_ENCRYPTION_KEY)
}

export function googleRedirectUri(origin: string): string {
  return `${origin}/api/mail/google/callback`
}

export function googleAuthUrl(origin: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_MAIL_CLIENT_ID!,
    redirect_uri: googleRedirectUri(origin),
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',   // we need a refresh token
    prompt: 'consent',        // …which Google only re-issues on explicit consent
    include_granted_scopes: 'false',
    state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

interface TokenResponse {
  access_token: string
  expires_in: number
  refresh_token?: string
  scope?: string
  id_token?: string
  error?: string
  error_description?: string
}

export async function exchangeCode(origin: string, code: string): Promise<TokenResponse> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_MAIL_CLIENT_ID!,
      client_secret: process.env.GOOGLE_MAIL_CLIENT_SECRET!,
      redirect_uri: googleRedirectUri(origin),
      grant_type: 'authorization_code',
    }),
  })
  return res.json() as Promise<TokenResponse>
}

/** The address comes from Google's own id_token (received directly from Google over TLS). */
export function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null
  try {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8')) as { email?: string; email_verified?: boolean }
    return payload.email && payload.email_verified !== false ? payload.email : null
  } catch {
    return null
  }
}

export async function revokeToken(token: string): Promise<void> {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => {})
}

export interface ConnectionRow {
  id: string
  user_id: string
  tenant_id: string
  email: string
  refresh_token_enc: string
  access_token_enc: string | null
  access_expires_at: string | null
  status: string
}

/** A valid access token, refreshing (and persisting) it when needed. */
export async function getAccessToken(admin: SupabaseClient, conn: ConnectionRow): Promise<string> {
  if (conn.access_token_enc && conn.access_expires_at && new Date(conn.access_expires_at).getTime() > Date.now() + 60_000) {
    return decrypt(conn.access_token_enc)
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_MAIL_CLIENT_ID!,
      client_secret: process.env.GOOGLE_MAIL_CLIENT_SECRET!,
      refresh_token: decrypt(conn.refresh_token_enc),
      grant_type: 'refresh_token',
    }),
  })
  const data = (await res.json()) as TokenResponse
  if (!res.ok || !data.access_token) {
    // invalid_grant = the user revoked access or changed their password: needs relinking.
    await admin.from('mail_connections').update({
      status: data.error === 'invalid_grant' ? 'revoked' : 'error',
      last_error: data.error_description ?? data.error ?? `HTTP ${res.status}`,
      updated_at: new Date().toISOString(),
    }).eq('id', conn.id)
    throw new Error(data.error === 'invalid_grant' ? 'RELINK_REQUIRED' : 'TOKEN_REFRESH_FAILED')
  }
  await admin.from('mail_connections').update({
    access_token_enc: encrypt(data.access_token),
    access_expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    status: 'active',
    last_error: null,
    updated_at: new Date().toISOString(),
  }).eq('id', conn.id)
  return data.access_token
}

// ── MIME ─────────────────────────────────────────────────────────────────────

function encodeHeader(value: string): string {
  // RFC 2047 so Arabic subjects/names survive every mail client.
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`
}

function stripCrlf(value: string): string {
  return value.replace(/[\r\n]+/g, ' ')
}

export interface Attachment { filename: string; contentType: string; base64: string }

export function buildMime(opts: {
  fromEmail: string
  fromName?: string
  to: string
  subject: string
  html: string
  attachments?: Attachment[]
}): string {
  const boundary = `eq_${randomBytes(12).toString('hex')}`
  const from = opts.fromName ? `${encodeHeader(stripCrlf(opts.fromName))} <${stripCrlf(opts.fromEmail)}>` : stripCrlf(opts.fromEmail)
  const lines = [
    `From: ${from}`,
    `To: ${stripCrlf(opts.to)}`,
    `Subject: ${encodeHeader(stripCrlf(opts.subject))}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(opts.html, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n'),
  ]
  for (const a of opts.attachments ?? []) {
    lines.push(
      `--${boundary}`,
      `Content-Type: ${stripCrlf(a.contentType)}; name="${encodeHeader(stripCrlf(a.filename))}"`,
      `Content-Disposition: attachment; filename="${encodeHeader(stripCrlf(a.filename))}"`,
      'Content-Transfer-Encoding: base64',
      '',
      a.base64.replace(/(.{76})/g, '$1\r\n'),
    )
  }
  lines.push(`--${boundary}--`, '')
  return lines.join('\r\n')
}

export async function sendGmail(accessToken: string, mime: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: Buffer.from(mime, 'utf8').toString('base64url') }),
  })
  if (res.ok) return { ok: true }
  const data = await res.json().catch(() => ({})) as { error?: { message?: string } }
  return { ok: false, error: data.error?.message ?? `HTTP ${res.status}` }
}
