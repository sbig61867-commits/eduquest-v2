---
name: verify
description: Run EduQuest's local verification gates — eslint, TypeScript typecheck, the vitest suite, and a production build — and report pass/fail with the real output. Use after any change, before pushing, or at the verify stage of the review pipeline.
---

# Verify (EduQuest)

Run from the repo root, in this order, and stop at the first red gate to fix it (use the `debug`
skill). If `node_modules` is missing, run `npm install --no-save --no-audit --no-fund` first.

```bash
npx eslint $(git diff --name-only --diff-filter=d origin/main...HEAD -- '*.ts' '*.tsx' '*.mjs')   # 1. lint the changed files
npm run lint                               # 1b. full lint (before final-verify)
npx tsc --noEmit -p .                      # 2. typecheck (~30 s)
npx vitest run --pool=threads              # 3. unit/component tests
npm run build                              # 4. production build
```

Notes:

- Use `--pool=threads` for vitest; the default fork pool can fail to start a worker in this sandbox.
- `npm run build` succeeds in the cloud container without `.env.local` (verified 2026-09-27, ~2–3 min).
  If a future change makes it fail **only** because an env var is missing, report the build as
  "not verifiable here (missing env)" — never add fake values to the repo.
- Do **not** run `npx playwright test` or `scripts/verify-system.mjs` here: both run against the
  **production** site / database and create real accounts. Run them only when the user asks.
- For a change under `supabase/`, also confirm `schema.sql` and a standalone migration were both
  updated and that the matching `supabase/tests/*_check.sql` (if any) covers the change. Those
  checks run in the Supabase SQL Editor / MCP, only with the user's go-ahead.

Report a table: gate · command · ✅/❌ · key output (test counts, first error). Never report a gate as
passing that was not run.
