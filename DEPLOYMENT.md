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
| `NEXT_PUBLIC_APP_URL` | All | set to your Vercel URL, e.g. `https://eduquest-v2.vercel.app` |
| `GROQ_API_KEY` | All | secret |
| `GEMINI_API_KEY` | All | secret |
| `NEXT_PUBLIC_SERVER_PROCTORING` | All | `true`/`false` |

Then **Deploy**.

## 4. Point Supabase at the new domain
In the Supabase dashboard → **Authentication → URL Configuration**:
- **Site URL**: `https://eduquest-v2.vercel.app`
- **Redirect URLs**: add `https://eduquest-v2.vercel.app/auth/callback`

This makes invitation links and OAuth redirects resolve to production instead of
localhost. After the first deploy, update `NEXT_PUBLIC_APP_URL` to the final URL
(or your custom domain) and redeploy.

## 5. Database migrations
The live Supabase database already has every migration applied. For a fresh
project, run in order:
1. `supabase/schema.sql`
2. `supabase/invitations_migration.sql`
3. `supabase/platform_hardening_migration.sql`
4. `supabase/rls_performance_migration.sql`
5. `supabase/jwt_claims_migration.sql`

## Notes
- Every `git push origin main` auto-deploys (Vercel Git integration).
- Existing logged-in users carry a pre-claims JWT until their next login; the
  middleware has a one-time DB fallback, so nothing breaks. A single re-login
  picks up the JWT claims fast path.
