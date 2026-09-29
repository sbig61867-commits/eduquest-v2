/**
 * Reads Safe Exam Browser's proof for the current page (browser only).
 * Outside SEB this returns null. See src/lib/seb.ts for what the server does
 * with it.
 */

interface SebSecurityApi {
  configKey?: string
  updateKeys?: (callback: () => void) => void
}

export async function readSebProof(): Promise<{ pageUrl: string; configKeyHash: string } | null> {
  if (typeof window === 'undefined') return null
  const api = (window as Window & { SafeExamBrowser?: { security?: SebSecurityApi } }).SafeExamBrowser?.security
  if (!api) return null
  if (typeof api.updateKeys === 'function') {
    // Newer SEB versions refresh the keys for the current URL on request.
    await new Promise<void>(resolve => {
      const done = setTimeout(resolve, 2_000)
      try { api.updateKeys!(() => { clearTimeout(done); resolve() }) } catch { clearTimeout(done); resolve() }
    })
  }
  if (typeof api.configKey !== 'string' || !api.configKey) return null
  return { pageUrl: window.location.href.split('#')[0], configKeyHash: api.configKey }
}
