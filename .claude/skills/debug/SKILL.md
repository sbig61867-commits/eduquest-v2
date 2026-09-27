---
name: debug
description: Root-cause and fix a failure in EduQuest (failing vitest/lint/tsc/build, a runtime error, a 403 from Supabase, an exam/proctoring bug) with a reproduce → isolate → fix → prove loop. Use when something is broken or when the review pipeline reaches its debug stage.
---

# Debug (EduQuest)

Work one failure at a time. "Flake" is never a root cause.

## 1. Reproduce

Get the failure to happen on demand and save the exact output:

| Failure | Reproduce with |
|---|---|
| unit/component test | `npx vitest run --pool=threads <file> -t "<name>"` |
| type error | `npx tsc --noEmit -p .` |
| lint | `npx eslint <file>` |
| build | `npm run build` |
| route/page behaviour | `npm run dev` + `curl` / the `run` skill (needs `.env.local`; say so if absent) |

`--pool=threads` is required here: the default fork pool can fail to start a worker in this sandbox.
If you cannot reproduce it, say so and list what you tried — do not "fix" blind.

## 2. Isolate — check the known EduQuest failure classes first

- **Silent 403 / empty result from Supabase** that works in the SQL Editor → a `SECURITY DEFINER`
  function missing `SET search_path = public, pg_temp` or an unqualified table (see
  `supabase/fix_helper_search_path.sql`).
- **`TENANT_MISMATCH` / NULL user in an RPC** called from a route → the RPC uses `auth.uid()` but the
  route calls it with the service-role client (`fix_start_exam_attempt_migration.sql`).
- **Role/tenant looks stale** → it lives in the JWT (`sync_user_claims`); the change must go through
  `public.users`, and the user needs a fresh session.
- **Missing column / 404 on a table** → migration not applied; check "Applied migrations" in
  `CLAUDE.md` before assuming a code bug. Code should degrade, not crash, when it is absent.
- **i18n test failures** → key sets differ between `src/messages/en` and `ar`, a hardcoded string in a
  `MIGRATED_DIRS` file, an Arabic plural using `#`, or `formatDate`/`getTerms` without a locale.
- **Vocabulary tab empty in a lesson** → a prompt lost the dash that `VOCAB_RE` needs.
- **Datetime shifted by hours** → a bare `datetime-local` string stored as UTC.

Otherwise bisect: narrow to the smallest input / commit (`git log -p`, `git bisect`) that flips it.

## 3. Fix

Smallest change that removes the root cause. A DB behaviour change means **both** updating
`supabase/schema.sql` and adding a re-runnable migration file — never apply it to the live DB from
here without the user's explicit go-ahead. Never skip, disable or loosen a test to get green.

## 4. Prove

Re-run the exact reproduction from step 1 and show it passing, then the neighbouring tests for the
touched files. Add a regression test when the failure was a real bug and a test is feasible.

Report: symptom → root cause → fix (file:line) → proof (command + result).
