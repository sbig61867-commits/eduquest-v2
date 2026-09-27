---
name: review-pipeline
description: Run EduQuest's full cloud review chain on the current branch — context → security-review → code-review → debug → simplify → verify → ultrareview → final-verify — stopping at each gate that fails. Use when asked to "run the pipeline", review a branch end to end, or get a change ready to merge.
---

# EduQuest review pipeline

```
PROJECT → /context → /security-review → /code-review → /debug → /simplify → /verify → /ultrareview → FINAL VERIFY
```

Run the stages **in order**. Each stage is a gate: if it finds something blocking, fix it (or stop and
report) before moving on. Keep a checklist (TaskCreate/TaskUpdate) with one item per stage so the user
can follow along. Never skip a stage silently — if a stage can't run, say which one and why.

## 0. Scope

Establish what is being reviewed before anything else:

- `git fetch origin main` then `git diff --stat origin/main...HEAD` and `git status --short`.
- If there is no diff against `main` and no uncommitted change, ask the user what to review
  (a PR number, a path, or the whole repo) — every later stage reviews *the diff*.
- `node_modules` must exist (the SessionStart hook installs it in the cloud). If it doesn't,
  run `npm install --no-save --no-audit --no-fund`.

## 1. /context

`/context` is a built-in CLI command (context-window usage); only the user can type it. What this stage
does for the pipeline is load the project context the later stages need:

- `CLAUDE.md` (already in context) — especially **RLS helper `search_path`**, **privileged-write
  pattern**, **exam integrity**, **AI metering**, **i18n ratchet**, and the migration rules.
- The files the diff touches, plus their direct callers.
- If the diff touches `supabase/*.sql`, the matching entry under "Applied migrations" / "Pending
  migrations" in `CLAUDE.md`.

Output: a 3–6 line summary of what the change does and which of the areas above it touches.

## 2. /security-review

Invoke the built-in `security-review` skill. Then check these EduQuest-specific rules against the diff
(they are the bugs this repo has actually shipped before):

- A new/changed `SECURITY DEFINER` function schema-qualifies tables and sets
  `SET search_path = public, pg_temp`; EXECUTE is revoked `FROM PUBLIC, anon` (not just `anon`).
- A service-role-only RPC never authorizes with `auth.uid()` (it is NULL under the service role).
- Route handlers authenticate/authorize with the **user session**, verify the target is in the
  caller's tenant, and only then write with the service-role client — never authorize with it.
- No new table INSERT/UPDATE policy that lets a client write a score, role, tenant, or permissions.
- Exam paths never send `correct_answer` to the client and never trust a client timestamp or grade.
- No camera frame or evidence snapshot goes to Supabase or to an AI provider.
- Every AI route uses `meteredAiRoute` + `authorizeAiUsage` (or `identifyAiCaller`) and `rateLimit`.

Blocking findings (HIGH/MEDIUM) are fixed before stage 3.

## 3. /code-review

Invoke the built-in `code-review` skill on the branch diff (default effort `high`; use `max` for
schema, auth, or exam changes). Fix every correctness finding it confirms before stage 4.

## 4. /debug

Invoke the project `debug` skill for every failure surfaced so far (a failing test, a reproducible
review finding, a broken build). If nothing is failing, run the quick checks from the `verify` skill
once; if they are green, record "nothing to debug" and move on.

## 5. /simplify

Invoke the built-in `simplify` skill on the diff. It is quality-only; it must not change behaviour.

## 6. /verify

Invoke the project `verify` skill (lint · typecheck · vitest · build). Everything must be green.

## 7. /ultrareview

`/ultrareview` is a built-in, user-triggered command (a deep multi-agent review of the branch/PR that
runs in the cloud and may be billed separately); Claude cannot start it. At this stage:

1. Commit and push the branch (it reviews what is pushed).
2. Tell the user: **"Type `/ultrareview` now"** (or `/ultrareview <PR number>` if a PR exists), and wait.
3. When its findings arrive, fix each confirmed one, then re-run stage 6.

If the user declines or the command is unavailable, run `code-review` at effort `max` instead and say
that this substitute was used.

## 8. FINAL VERIFY

Invoke the project `final-verify` skill. The pipeline is done only when it reports **PASS**.

## Report

End with one table: stage · result (✅ / ⚠️ / ❌) · what was fixed (commit hash) · what is left.
Push to the session's designated branch; do not open a PR unless the user asks.
