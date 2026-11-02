# Migration execution guide (for the executing model)

You are executing the Cloudflare + Neon migration of this repo, one numbered
step at a time. Read this whole file before doing anything. Read `CLAUDE.md`
too: its hard rules still apply.

## Golden rules (never break these)

1. **One step per run.** Do only the step(s) you were told to do. When they are
   done, write the report (see "Reporting") and STOP. Never start the next step
   on your own.
2. **No loops.** Any command or fix gets at most **2 attempts**. If it still
   fails, write the exact error in the progress log under "Open issues", mark
   the step `blocked`, and stop. Do not try a third variation. Do not re-read
   the same file more than twice.
3. **No hanging commands.** Every shell command that touches the network or
   npm gets a timeout (`timeout 90 ...`). Builds and installs run with
   `run_in_background: true`; wait for the completion notification, never poll
   or sleep.
4. **Production is off limits.** Never touch the live Supabase project, Vercel,
   `main`, or any deploy command (`vercel`, `wrangler deploy`, `cf:deploy`).
   Never merge or push. Never open a PR. Neon work happens only on the trial
   project (connection string `NEON_DATABASE_URL` in `.env.local`, read by
   `scratchpad/neon/env.mjs`).
5. **Secrets.** Never print, echo, commit or paste any key, password or
   connection string. Never commit `.env.local` or `.dev.vars`.
6. **Do not touch files you did not change.** These are the owner's and stay
   as they are: `.claude/launch.json`, `public/models/human/*.json`,
   `.open-next/`. Stage files by name (`git add path`), never `git add -A` or
   `git add .`.
7. **No new packages** unless the step says so by exact name and version.
8. **Owner-only steps** (10, 16, 18): never do them. If you reach one, stop and
   report that the owner must act.
9. **Delete only what the step names**, and look at it first.
10. **Errors are allowed, hiding them is not.** If something fails or you are
    unsure, record it honestly. Never report a step as done without the check
    listed under "Done when".

## Environment facts

- Repo: `C:\Users\Victus\Downloads\eduquest-v2`, branch `migrate/04-better-auth`
  (rename is not needed). Windows; use the Bash tool (Git Bash) with forward
  slashes. Many files use CRLF line endings: keep them.
- Scratchpad with Neon helper scripts (plain Node, `postgres` package already
  installed there):
  `C:/Users/Victus/AppData/Local/Temp/claude/C--Users-Victus-Downloads-eduquest-v2/cc0f292d-6f94-4bb8-bafc-d49b4aa4103f/scratchpad/neon/`
  - `env.mjs` exports `NEON` (the connection string).
  - `peek.mjs` lists `neon_auth.user` and `neon_auth.organization` rows.
  - `cleanup.mjs` deletes the leftover probe user + organization in one
    transaction and prints the remaining counts.
- Commands: `npm test` (if workers fail: `npx vitest run --pool=threads`),
  `npm run lint`, `npx tsc --noEmit`, `npm run cf:build`.

## Reporting

After each run, append to `docs/claude/MIGRATION_PROGRESS.md` (create it if
missing):

```
## Step N: <title> — done | blocked
- What I did: ...
- Checks run and their result: ...
- Open issues: ... (exact error text, or "none")
```

Then reply to the owner **in Arabic**, short: what was done, what was checked,
what is open. Do not commit unless the step says to.

## Steps

### Step 1: Clean up trial leftovers
1. Run `timeout 90 node peek.mjs` in the scratchpad `neon/` folder. Confirm the
   only rows are the probe user (email starts with `claims-` and ends with
   `@example.com`) and the organization `Inst Probe`. If any other row
   exists, do not delete anything: report it and stop.
2. Run `timeout 90 node cleanup.mjs`. A previous run failed with a connection
   error; one retry is allowed (rule 2).
3. Run `peek.mjs` again.
4. Remove the stray package folder: `rm -rf node_modules/better-auth` (it is not
   in `package.json`; it was left by an aborted install).

Done when: `peek.mjs` prints empty results for both tables;
`node_modules/better-auth` does not exist; `git status --short` shows no change
to `package.json` or `package-lock.json`.

### Step 2: Re-verify the Workers build
1. Run `npm run cf:build` in the background, wait for it.
2. If it succeeds, record the size of `.open-next/worker.js` and the total size
   of `.open-next/` (use `du -sh`, with `timeout 60`).
3. Run `npx vitest run --pool=threads` in the background and record pass/fail
   counts.

Done when: the build exits 0 and the test counts are recorded. A failing build
or test is recorded (exact first error) and the step marked `blocked`; do not
try to fix it in this step.

### Steps 3–18 — the approved plan and its status (2026-10-24)

**Owner decision 2026-10-24:** the Supabase database and storage hold trial
data only. Nothing is carried over — no users, lessons, exams, files. Neon
starts empty (the schema only) plus ONE new platform owner (super_admin)
signing in with the owner's own email. This removes the account copy (7),
the backup (14) and the data/file copy (15) from the critical path.

| # | Step | Status |
|---|------|--------|
| 1 | Clean trial leftovers on Neon | done |
| 2 | Re-verify the Workers build | done |
| 3 | Measure the role lookup inside RLS | done |
| 4 | Link the auth identity to `public.users` | done (trial) |
| 5 | `must_change_password` becomes a column | done (trial) |
| 6 | Replace sign-in in the code (login, invitation sign-up, password reset, member-code login, proxy) | done — invitation sign-up, account store and account-switch notice on the new auth; the OAuth callback shows "Google unavailable" (Google stays off until the owner asks) |
| 7 | Prepare moving user accounts with their passwords | built; **not needed** (no accounts are moved) |
| 8 | Hyperdrive → Neon | done |
| 9 | Data access on Neon (SQL layer, RLS kept) | done — no app code imports Supabase; the unused client modules (src/lib/supabase, src/lib/db/index.ts) go in step 18 |
| 10 | File storage on Cloudflare | done — owner chose the free plan (no payment method): Workers KV namespace `tilmoo-files` (id 40c323b9…), created 2026-10-24; R2 later is a one-file change |
| 11 | File upload/read → R2 (incl. `exam-files.ts`, storage quota) | done in code (src/lib/file-store.ts, GET /api/files, stored_files + quota on Neon: migrations 0011–0012); on KV (step 10) |
| 12 | Scheduled jobs: `pg_cron` → Cloudflare Cron Triggers | done (worker.ts scheduled → POST /api/cron/daily; migration 0010); needs the CRON_SECRET secret at deploy |
| 13 | Replace Supabase Realtime channels (live proctoring video stays deferred) | done (Durable Object per exam, live/exam-live.ts; tickets via GET /api/live/ticket; src/lib/live-client.ts); needs the LIVE_SIGNING_SECRET secret at deploy |
| 14 | Back up Supabase | **skipped** — owner: nothing to keep |
| 15 | Move data, accounts, files | done 2026-10-24 — Neon held no trial data (the trials clean up after themselves); rate-limit counters cleared; owner sbig61867@gmail.com created as super_admin by the owner via scripts/create-owner.ps1 (password never in chat) |
| 16 | Deploy on Cloudflare + switch the domain | approved 2026-11-02; **blocked** — the Worker upload fails from this PC's connection (MIGRATION_PROGRESS.md, step 16) |
| 17 | Verify each area one by one: tenant isolation, exams and grading, proctoring, permissions, files, AI, translations, performance and request counts, all automated tests | after 16 |
| 18 | Stop Vercel and Supabase | **owner confirmation** |

Steps 10, 16 and 18 happen only with the owner's action or approval. Nothing
reaches production before step 16.
