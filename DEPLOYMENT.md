# Deploying EduQuest to Vercel

EduQuest is a Next.js app with API routes, middleware, and server-only secrets,
so it must run on a Node/serverless host. **GitHub Pages cannot host it** (static
only). Vercel is the recommended target.

## 1. Push the code to GitHub
The repo remote is already `github.com/sbig61867-commits/eduquest-v2`.
```bash
git add -A
git commit -m "Deploy-ready: full platform"
git push origin main
```
`.env.local` is gitignored — your secrets never leave your machine.

## 2. Import the project on Vercel
1. Go to https://vercel.com/new and sign in.
2. Pick **Import Git Repository** → select `eduquest-v2`.
3. Framework preset auto-detects **Next.js**. Leave build settings default
   (`next build`, output `.next`).

## 3. Set Environment Variables (Vercel → Settings → Environment Variables)
Copy each key from `.env.example`. Use your real values (from `.env.local`):

| Variable | Scope | Notes |
|----------|-------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | All | public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | All | public |
| `SUPABASE_SERVICE_ROLE_KEY` | All | **secret — server only** |
| `NEXT_PUBLIC_APP_URL` | All | final production URL |
| `GROQ_API_KEY` | All | secret |
| `GEMINI_API_KEY` | All | secret |
| `NEXT_PUBLIC_SERVER_PROCTORING` | All | `true`/`false` |
| `LIVEKIT_URL` | All | required only for live proctoring |
| `LIVEKIT_API_KEY` | All | secret; required only for live proctoring |
| `LIVEKIT_API_SECRET` | All | **secret; required only for live proctoring** |
| `RESEND_API_KEY` | All | required for invitation email delivery |
| `EMAIL_FROM` | All | verified sender address |
| `SENTRY_DSN` | All | optional production error monitoring |
| `SENTRY_AUTH_TOKEN` | Build | optional; enables source-map upload |

Then **Deploy**.

## 4. Point Supabase at the production domain
In the Supabase dashboard → **Authentication → URL Configuration**:
- **Site URL**: your final production URL
- **Redirect URLs**: add `<production-url>/auth/callback` and any explicitly
  required local-development callback URL.

Do not use a stale preview or localhost value for production auth redirects.

## 5. Database migrations — important

The old version of this document listed only five migrations. That list became
stale as the platform gained courses, homework, soft-delete/archive, proctoring,
rate limiting, survey/reporting, answer-key protection, and additional RLS
hardening. **Do not provision a fresh database using only the old five-file list.**

For an existing production database, apply every migration that is not already
recorded as applied, in the same dependency/commit order used by the repository.
In particular, the current security state requires these later migrations to be
present as applicable:

- `supabase/soft_delete_archive_migration.sql`
- `supabase/rate_limits_lockdown_migration.sql`
- `supabase/fix_all_search_path_migration.sql`
- `supabase/security_rls_fix_migration.sql`
- `supabase/exam_answer_leak_fix_migration.sql`
- `supabase/finalize_max_score_migration.sql`
- `supabase/preserve_grades_on_lesson_delete_migration.sql`
- `supabase/submissions_teacher_scope_migration.sql`
- `supabase/survey_migration.sql`
- `supabase/security_hardening_2026_09.sql` **(new security hardening; required)**

The complete set of SQL files lives under `supabase/`; do not run unrelated test
or cleanup scripts against production. Before applying migrations to production,
back up the database and verify the target schema/version.

## 6. Production verification checklist

After deployment, verify at minimum:

- Vercel build succeeds with the exact lockfile used by the project.
- A student cannot read exam `correct_answer` values through the Supabase Data API.
- A teacher cannot access another teacher's groups, lessons, exams, or submissions.
- A university admin cannot cross tenant boundaries.
- Direct calls to admin archive/soft-delete and rate-limit RPCs are denied to
  browser roles and still work through the server-side service-role client.
- Public invitation `max_uses` cannot be exceeded by concurrent registrations.
- Proctoring room tokens are unavailable before a student starts an active,
  published exam.
- Error monitoring receives server errors without capturing exam-page media.

## Notes
- Every `git push origin main` auto-deploys when Vercel Git integration is connected.
- Existing logged-in users may carry older JWT claims until refresh; the middleware
  and session watcher provide a compatibility path, but role/account changes should
  still be verified server-side on every protected request.
