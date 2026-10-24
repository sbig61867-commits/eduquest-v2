import { NextResponse } from 'next/server'
import { cronAuthorized } from '@/lib/cron-secret'
import { EVIDENCE_ROOT, isExpired, parseEvidenceKey } from '@/lib/evidence-keys'
import { deleteEvidence, evidenceBackend, listEvidenceKeys } from '@/lib/evidence-store'

// POST /api/proctor/evidence/cleanup — permanently deletes every proctoring
// snapshot older than 30 hours (src/lib/evidence-keys.ts). Called hourly by
// .github/workflows/evidence-cleanup.yml with `Authorization: Bearer <CRON_SECRET>`;
// the bucket's own lifecycle rule (2 days) is only a backstop. Only needed for
// the S3/R2 backend — Workers KV expires every snapshot by itself. Anything under
// evidence/ that is not a well-formed key is removed too: nothing else belongs there.
// Public in src/proxy.ts (no user session) — the secret is the only gate.

export async function POST(request: Request) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const backend = evidenceBackend()
  if (!backend) return NextResponse.json({ configured: false, deleted: 0 })
  // Workers KV deletes each snapshot itself at its 30-hour expiry: nothing to do.
  if (backend === 'kv') return NextResponse.json({ configured: true, backend, deleted: 0, expiresInStore: true })

  const now = Date.now()
  const keys = await listEvidenceKeys(`${EVIDENCE_ROOT}/`)
  const doomed = keys.filter(k => {
    const parsed = parseEvidenceKey(k)
    return !parsed || isExpired(parsed.capturedAt, now)
  })
  const deleted = await deleteEvidence(doomed)

  return NextResponse.json({ configured: true, backend, scanned: keys.length, deleted, remaining: keys.length - deleted })
}
