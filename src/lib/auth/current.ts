import { cookies } from 'next/headers'
import { CTX_COOKIE, verifyCtx, type SessionCtx } from './session'

// Step 9.6: who is signed in, for server components and route handlers. Reads
// the signed tm_ctx the proxy verified or refreshed for this request: no auth
// lookup and no database. Writes are re-checked against the live account in
// the proxy, and every query is checked again by RLS.

export type AuthUser = { id: string; email?: string; role?: string; tenant_id?: string | null }

export async function currentCtx(): Promise<SessionCtx | null> {
  const store = await cookies()
  const ctx = await verifyCtx(store.get(CTX_COOKIE)?.value)
  return ctx && ctx.is_active ? ctx : null
}

export async function currentUser(): Promise<AuthUser | null> {
  const ctx = await currentCtx()
  if (!ctx) return null
  return { id: ctx.sub, email: ctx.email ?? undefined, role: ctx.role ?? undefined, tenant_id: ctx.tenant_id }
}

/**
 * The service context for writes on the signed-in user's own institution
 * (privileged writes after the route has authorized them). A super_admin has
 * no institution and gets platform scope; anyone else without one gets none.
 */
export function serviceScopeFor(ctx: SessionCtx): { as: 'service'; tenantId: string } | { as: 'service'; platform: true } | null {
  if (ctx.tenant_id) return { as: 'service', tenantId: ctx.tenant_id }
  if (ctx.role === 'super_admin') return { as: 'service', platform: true }
  return null
}
