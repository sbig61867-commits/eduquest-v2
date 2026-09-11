# ROUTE_QA_REPORT

Date: 2026-09-09 · Branch `main` · Deployment https://eduquest-v2.vercel.app/

Method: static inventory of `src/app/**/page.tsx` and `src/app/api/**/route.ts`, cross-referenced
against every internal navigation target (`href=` and `router.push(`) found in `src/app`,
`src/components` and `src/lib`. Every link target was matched to a file route. Runtime checks were
done against `npm run dev` on localhost with a light and a dark viewport.

## Totals

| Surface | Count |
|---|---|
| Page routes | 64 |
| API route handlers | 49 |
| Route groups | 6 |
| SQL migration files | 53 |

## Link integrity

Every internal navigation target now resolves to a file route. One was broken before this pass.

| Target | Status before | Status now |
|---|---|---|
| `/student/courses/{id}` | **404 — no route existed** | Route added |

`src/app/(student)/student/courses/courses-client.tsx` renders a "Start Course" / "Continue Course"
button on every enrolled course card and pushes to `/student/courses/{id}`. No page file existed at
that path, so the primary call to action on the student course list produced a 404. Since the app
also had no `not-found.tsx`, the student saw the unstyled Next.js default 404. Both are fixed.

## Route-group state coverage

Next.js resolves `loading.tsx`, `error.tsx` and `not-found.tsx` per segment. Gaps meant a role could
fall back to an unstyled or missing state.

| Route group | error | loading | Before |
|---|---|---|---|
| `(super-admin)` | yes | yes | complete |
| `(admin)` | yes | yes | complete |
| `(teacher)` | yes | yes | complete |
| `(student)` | yes | yes | complete |
| `(center)` | yes | yes | **both missing** — added |
| `(auth)` | yes | yes | loading missing — added |
| root | yes | n/a | `not-found.tsx` missing — added |

The centre-manager role had no error boundary at all, so any thrown error inside
`/center/dashboard`, `/center/announcements` or `/center/schedules` escaped to the root boundary and
dropped the user out of the application shell.

## Header wayfinding

`PageTitle` feeds the header's page-name slot. Seven authenticated pages imported it and never
rendered it, leaving the header blank on those routes. All seven now render it.

- `/admin/center-staff`, `/admin/courses`, `/admin/exams`, `/admin/invitations`, `/admin/lessons`
- `/teacher/courses`, `/teacher/lessons/{id}`

Public marketing pages and the auth pages do not use the header shell, so their absence is correct.

## Access-control spot checks

`src/proxy.ts` is the single gate. Behaviour confirmed on the running dev server:

- An unauthenticated request to an unknown path (`/this-page-does-not-exist`) is redirected to
  `/login` rather than reaching the 404. The new `not-found.tsx` therefore serves authenticated
  users hitting a bad or archived id, which is the case it is written for.
- `PUBLIC_EXACT` and `PUBLIC_PREFIXES` cover the marketing pages, the invitation acceptance flow and
  the pre-auth API routes. No authenticated route prefix appears in either list.
- Role-to-prefix mapping in `ROLE_ROUTES` covers all five roles.

## Runtime checks

| Check | Result |
|---|---|
| TypeScript `tsc --noEmit` | clean |
| ESLint | clean, 0 errors and 0 warnings |
| Vitest | 63 of 63 passing |
| Browser console on `/login` and `/` | no errors |
| Dev server log | no errors |

## Known limitation of this pass

Authenticated pages were not walked in the browser, because doing so requires signing in with a live
account against the production Supabase project. The verification above is static plus unauthenticated
runtime. `SECURITY_TEST_MATRIX.md` remains the authority on what the Playwright suite proves.
