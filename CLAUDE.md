# CLAUDE.md

Core rules only. Details live in `docs/claude/` — read the relevant file before working in that area:
- `docs/claude/ARCHITECTURE.md` — auth gate, Supabase clients, staff collaboration, exam integrity + proctoring, i18n, AI metering, edge cache, performance contract, post-plan fixes, rate limiting
- `docs/claude/MIGRATIONS_LOG.md` — DB workflow, backups, every applied migration and how it was verified
- `docs/claude/PRODUCT_RULES.md` — sign-in by member ID, centre manager panel, design system (D3)
- `PERFORMANCE_CONTRACT.md`, `SECURITY_TEST_MATRIX.md`, `PAGESPEED_PLAN.md`

## Commands

```bash
npm run dev      # http://localhost:3000
npm run build
npm run lint
npm test         # vitest (src/__tests__/**); use `npx vitest run --pool=threads` if workers fail to start
```
Playwright `tests/security-auth.spec.ts` runs against production.

## Stack

Next.js 16 (App Router; middleware is `src/proxy.ts`) · React 19 · TypeScript · Tailwind v4 · Supabase (Postgres + Auth + Storage + Realtime) · Zustand · next-intl (ar/en). AI: Groq + Gemini (free tiers only). Proctoring runs on the student's device (MediaPipe, TF.js) — no AI provider. Email: Resend. Next 16 differs from training data: read `node_modules/next/dist/docs/` before writing Next code.

## Architecture in one screen

- Roles: `super_admin`, `university_admin`, `center_manager`, `teacher`, `student`. Route groups `src/app/(super-admin|admin|center|teacher|student|auth)`.
- Every domain row has `tenant_id`; isolation is **Postgres RLS**, not app code. `super_admin` is cross-tenant.
- Identity (`role`, `is_active`, `tenant_id`) is in JWT `app_metadata`, synced by trigger `sync_user_claims`; change these only through `public.users`.
- Supabase clients: `lib/supabase/client.ts` (browser), `lib/supabase/server.ts` (RSC/routes, user session, RLS) — default for reads. Service-role client only for privileged writes after user-session authorization, tables with no SELECT policy (`rate_limits`), and service-role-only RPCs.
- Capabilities: `users.permissions` resolved in `src/lib/permissions.ts`; routes check with the user session, then write with service role (`src/lib/staff-auth.ts`, `src/lib/center-access.ts`).
- Reads that reach a screen go through `src/lib/data/<resource>.ts` and follow `PERFORMANCE_CONTRACT.md`.

## Hard rules

1. Every `SECURITY DEFINER` function: schema-qualify tables (`public.x`) and `SET search_path = public, pg_temp`.
2. A service-role-only RPC must never use `auth.uid()` (it is NULL there). Re-derive actor/tenant from `public.users`.
3. `REVOKE ALL … FROM PUBLIC, anon` on new functions (anon inherits via PUBLIC).
4. RLS cannot restrict columns: pin every authz column in `users_update` WITH CHECK.
5. Exams are server-authoritative: start/submit/grade via `/api/exam/*` RPCs; `correct_answer` never leaves the server.
6. Proctoring: no server-side frame analysis, no browser screen recording, no WebGazer (GPL). Evidence never stored in Supabase (Cloudflare KV, 30 h).
7. Every AI route: `meteredAiRoute(...)` + `authorizeAiUsage(user.id)`; provider calls through `meterCall()` / shared helpers (`groqChat`). AI must stay free-tier.
8. Rate-limit expensive routes with `rateLimit('feature:userId', …)`.
9. No `select('*')`, bounded lists, no N+1. No Redis/app cache, no loading UI, no global prefetch change.
10. i18n: no UI literals in route groups/components; messages in `src/messages/{en,ar}/` with identical keys; Arabic plurals print `{var}`, never `#`.
11. Design: tokens from `src/app/design-tokens.css`; no raw palette colours, `text-[Npx]`, `rounded-xl+`, gradients, `backdrop-blur` in new code. IBM Plex fonts only.
12. Never "clean up" dashes in AI lesson prompts (`VOCAB_RE` depends on them).
13. Public marketing HTML must not depend on cookies (edge-cached).
14. Ratchet tests (`perf-contract`, `design-contract`, `i18n-*`) are shrink-only.

## Database

- SQL in `supabase/`, applied manually (or via Supabase MCP) — no migration CLI. Update `schema.sql` **and** add an idempotent migration file.
- Before applying to the live DB: run the backup workflow and wait for green (`gh workflow run db-backup.yml -f reason="before <migration>"`), dry-run in a rolled-back transaction, re-read the live definition and `origin/main` for newer migrations.
- Never re-run an applied migration (list in `docs/claude/MIGRATIONS_LOG.md`). Pending: none.

## Conventions

- Typed casts: `as unknown as RowType[]`, never `as any`.
- Reuse `getRoleLabel`, `getRoleDashboardPath` (`src/lib/utils.ts`), `getTerms` (`src/lib/terminology.ts`).
- Env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GROQ_API_KEY`, Gemini/Resend keys; base URL `NEXT_PUBLIC_APP_URL` → `VERCEL_URL` → localhost.
- Work stays local until the owner says deploy; then ship the whole pipeline.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
