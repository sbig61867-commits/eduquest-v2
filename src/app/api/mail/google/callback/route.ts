import { resolveAppUrl } from '@/lib/auth-urls'
import { serviceClient } from '@/lib/staff-auth'
import { getMailCaller } from '@/lib/mail/access'
import { encrypt, verifyState } from '@/lib/mail/crypto'
import { GMAIL_SEND_SCOPE, emailFromIdToken, exchangeCode, revokeToken } from '@/lib/mail/google'

// Google redirects the popup here. We finish the exchange server-side, store
// the tokens encrypted, then notify the page (BroadcastChannel) and close the popup.
function popupResult(ok: boolean, message: string) {
  const payload = JSON.stringify({ type: 'eduquest-mail-link', ok, message })
  const html = `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>EduQuest</title>
<body style="font-family:sans-serif;background:#0f172a;color:#e2e8f0;display:grid;place-items:center;height:100vh;margin:0">
<p id="m"></p>
<script>
  var data = ${payload.replace(/</g, '\\u003c')};
  document.getElementById('m').textContent = data.message + ' — يمكنك إغلاق هذه النافذة';
  // COOP same-origin (next.config.ts) severs window.opener once the popup has
  // visited accounts.google.com, so notify the page over a same-origin channel.
  try { var ch = new BroadcastChannel('eduquest-mail'); ch.postMessage(data); ch.close(); } catch (e) {}
  setTimeout(function(){ window.close() }, 1200);
</script></body></html>`
  return new Response(html, { status: ok ? 200 : 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

export async function GET(request: Request) {
  const auth = await getMailCaller()
  if ('error' in auth) return popupResult(false, 'لا تملك صلاحية ربط البريد')
  const { caller } = auth

  const url = new URL(request.url)
  if (url.searchParams.get('error')) return popupResult(false, 'أُلغي الربط من نافذة Google')
  if (!verifyState(url.searchParams.get('state'), caller.id)) return popupResult(false, 'انتهت صلاحية الطلب، أعد المحاولة')

  const code = url.searchParams.get('code')
  if (!code) return popupResult(false, 'لم يُستلم رمز الموافقة من Google')

  const origin = resolveAppUrl(request.url, process.env.NEXT_PUBLIC_APP_URL)
  const tokens = await exchangeCode(origin, code)
  if (!tokens.access_token) {
    console.error('[mail/google/callback] exchange failed', tokens.error)
    return popupResult(false, 'تعذّر إكمال الربط مع Google')
  }
  if (!tokens.scope?.split(' ').includes(GMAIL_SEND_SCOPE)) {
    await revokeToken(tokens.access_token)
    return popupResult(false, 'لم تُمنح صلاحية الإرسال — فعّل خيار "إرسال البريد" في نافذة Google')
  }
  if (!tokens.refresh_token) {
    return popupResult(false, 'لم يُصدر Google رمز التحديث — أزل وصول EduQuest من حسابك في Google ثم أعد الربط')
  }
  const email = emailFromIdToken(tokens.id_token)
  if (!email) return popupResult(false, 'تعذّر معرفة عنوان البريد')

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
    return popupResult(false, 'تعذّر حفظ الربط')
  }
  return popupResult(true, `تم ربط ${email}`)
}
