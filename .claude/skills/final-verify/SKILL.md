---
name: final-verify
description: The last gate of the EduQuest review pipeline — re-run every verification on the final pushed state, confirm nothing from earlier stages is left open, and give a PASS/FAIL verdict. Use at the end of the review pipeline or right before asking for a merge.
---

# FINAL VERIFY (EduQuest)

This runs on the **final** state; anything changed after it invalidates it.

1. **Clean tree, pushed.** `git status --short` is empty and `git log origin/<branch>..HEAD` is empty
   (everything is pushed). `package-lock.json` changed only if `package.json` did.
2. **Full gates, from scratch.** Run the whole `verify` skill again (full `npm run lint`,
   `npx tsc --noEmit -p .`, `npx vitest run --pool=threads`, `npm run build`) — not just changed files.
3. **Open findings.** Every finding from security-review, code-review and ultrareview is either fixed
   (name the commit) or explicitly accepted by the user. None silently dropped.
4. **Repo rules.**
   - DB change → `schema.sql` + a re-runnable migration; `CLAUDE.md` lists it under
     "Pending migrations" until applied (never marked applied without live proof).
   - New UI text → present in both `src/messages/en` and `ar`; no hardcoded literals.
   - New AI call → goes through `meterCall` / `meteredAiRoute`.
   - No secrets, `.env*`, or tokens in the diff (`git diff origin/main...HEAD | grep -iE 'key|secret|token'`
     and review each hit).
   - No model identifiers in commits, PR text, or code comments.
5. **CI** (if a PR exists): checks on the current head are green and there is no merge conflict.

Verdict: **PASS** only if 1–5 all hold. Otherwise **FAIL** with the exact list of what is left.
