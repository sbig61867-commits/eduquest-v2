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

### Steps 3–18
Not yet detailed. The owner and the planning model will add each step's exact
actions here before it runs. If you are asked to run a step that has no
section here, stop and say so.
