import { getTranslations, getLocale } from 'next-intl/server'
import { dirFor, toLocale } from '@/i18n/config'
import { resolveAppUrl } from '@/lib/auth-urls'
import { serviceClient } from '@/lib/staff-auth'
import { getMailCaller } from '@/lib/mail/access'
import { encrypt, verifyState } from '@/lib/mail/crypto'
import { GMAIL_SEND_SCOPE, emailFromIdToken, exchangeCode, revokeToken } from '@/lib/mail/google'

// Google redirects the popup here. We finish the exchange server-side, store
// the tokens encrypted, then notify the page (BroadcastChannel) and close the popup.
// The message is shown in this popup AND forwarded to the mail page as a
// toast, so it is resolved in the caller's language here.
async function popupResult(ok: boolean, key: string, params?: Record<string, string>) {
  const t = await getTranslations('center.mail.popup')
  const locale = toLocale(await getLocale())
  const message = t(key, params)
  const closeHint = t('closeHint')
  const payload = JSON.stringify({ type: 'eduquest-mail-link', ok, message })
  const hint = JSON.stringify(closeHint)
  const html = `<!doctype html><html lang="${locale}" dir="${dirFor(locale)}"><meta charset="utf-8"><title>EduQuest</title>
<body style="font-family:sans-serif;background:#0f172a;color:#e2e8f0;display:grid;place-items:center;height:100vh;margin:0">
<p id="m"></p>
<script>
  var data = ${payload.replace(/</g, '\\u003c')};
  document.getElementById('m').textContent = data.message + ' — ' + ${hint.replace(/</g, '\\u003c')};
  // COOP same-origin (next.config.ts) severs window.opener once the popup has
  // visited accounts.google.com, so notify the page over a same-origin channel.
  try { var ch = new BroadcastChannel('eduquest-mail'); ch.postMessage(data); ch.close(); } catch (e) {}
  setTimeout(function(){ window.close() }, 1200);
</script></body></html>`
  return new Response(html, { status: ok ? 200 : 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

export async function GET(request: Request) {
  const auth = await getMailCaller()
  if ('error' in auth) return popupResult(false, 'noPermission')
  const { caller } = auth

  const url = new URL(request.url)
  if (url.searchParams.get('error')) return popupResult(false, 'cancelled')
  if (!verifyState(url.searchParams.get('state'), caller.id)) return popupResult(false, 'expired')

  const code = url.searchParams.get('code')
  if (!code) return popupResult(false, 'noCode')

  const origin = resolveAppUrl(request.url, process.env.NEXT_PUBLIC_APP_URL)
  const tokens = await exchangeCode(origin, code)
  if (!tokens.access_token) {
    console.error('[mail/google/callback] exchange failed', tokens.error)
    return popupResult(false, 'exchangeFailed')
  }
  if (!tokens.scope?.split(' ').includes(GMAIL_SEND_SCOPE)) {
    await revokeToken(tokens.access_token)
    return popupResult(false, 'noSendScope')
  }
  if (!tokens.refresh_token) {
    return popupResult(false, 'noRefreshToken')
  }
  const email = emailFromIdToken(tokens.id_token)
  if (!email) return popupResult(false, 'noEmail')

  const { error } = await serviceClient().from('mail_connections').upsert({
    user_id: caller.id,
    tenant_id: caller.tenant_id,
    provider: 'google',
    email,
    refresh_token_enc: encrypt(tokens.refresh_token),
    access_token_enc: encrypt(tokens.access_token),
    access_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    status: 'active',
    last_error: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,provider' })

  if (error) {
    console.error('[mail/google/callback] save failed', error)
    return popupResult(false, 'saveFailed')
  }
  return popupResult(true, 'linked', { email })
}
