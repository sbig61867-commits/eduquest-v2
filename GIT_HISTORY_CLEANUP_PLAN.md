# Git History Cleanup Plan — leaked DB credential

**Status: PLAN ONLY. Nothing here has been executed. No force-push has been
run and none will be without explicit approval of this plan.**

Related: `FINAL_AUDIT_STATUS.md` (incident record), `SECRETS.md` (prevention).

---

## 1. Exact scope of the exposure

| Fact | Value |
|---|---|
| Secret type | Postgres `postgres`-role (superuser) password |
| File | `scripts/run-migration.mjs`, line 65 |
| Commits containing it | **1** — `f21ff18286f42e6b97ca678329842eb92175336b` ("Deploy-ready: full EduQuest platform", 2026-06-22) |
| Commits since then | 189 (total history: 194 commits) |
| Other commits touching the file | 1 — `c4ae84a` (today's fix, which *removes* it) |
| Branches containing `f21ff18` | **All 4**: `main`, `chore/part-b-applied`, `security/rpc-execute-lockdown`, `security/users-capability-pin` — plus all 4 remote counterparts |
| Tags | 0 |
| Forks | 0 |
| Open/merged PRs | 3 (all from the branches above — same history, no extra surface) |
| Repo visibility | **PUBLIC** |
| Exposure window | 2026-06-22 → present (~2.5 months) |

---

## 2. The decisive point: rotation matters more than cleanup

**Rewriting history does not un-leak this password.** For ~2.5 months it was
publicly readable on GitHub. Assume it was already harvested — automated
scrapers index public repos continuously, and GitHub's own push-protection
partners see public commits.

Therefore:

- **Rotation ends the exposure.** (Pending — user performs it.)
- **Cleanup removes the artifact.** It is hygiene and prevents *future*
  accidental reuse, not remediation of the breach itself.

**Do not treat a completed history rewrite as "incident closed" if rotation
has not happened.** After rotation, the old value in history becomes inert —
at which point cleanup is genuinely optional and can be judged on
cost/benefit rather than urgency.

---

## 3. Options, with real trade-offs

### Option A — Rotate only; leave history as-is (RECOMMENDED)

Once the password is rotated, the string in `f21ff18` is a dead credential.

- **Pros:** zero disruption. No force-push, no broken clones, all 3 PRs and
  4 branches keep working, no risk of corrupting 194 commits of history.
- **Cons:** a dead secret remains visible in history; a future reader might
  mistake it for a live one; some compliance regimes require scrubbing.
- **Best when:** the credential is confirmed rotated and no policy requires
  removal — which is the likely situation here.

### Option B — Rewrite history with `git filter-repo` (thorough, disruptive)

```bash
# NOT RUN — for review only.
pip install git-filter-repo
git filter-repo --replace-text <(echo 'literal:<OLD_PASSWORD>==>REDACTED')
git push --force --all
git push --force --tags
```

- **Pros:** the value is gone from every commit on every branch.
- **Cons, all real:**
  - Rewrites **all 194 commits' SHAs** (every commit after the rewrite point
    changes identity) — every existing clone must be re-cloned, not pulled.
  - Requires `--force` push to 4 branches on a public repo.
  - The 3 existing PRs will show as diverged/broken; GitHub keeps the old
    objects reachable via PR refs, so **the old commits may still be
    retrievable through the GitHub API even after a force-push** unless
    GitHub Support is asked to purge them. Cleanup on a public repo is
    therefore *not* guaranteed complete without a support request.
  - Any external mirror/scrape already made is unaffected regardless.

### Option C — Squash-orphan the pre-leak history

Not recommended: loses 194 commits of real project history for a credential
that will already be inert post-rotation. Cost far exceeds benefit here.

---

## 4. Recommended sequence

1. **User rotates** the `postgres` password (Supabase → Database → Settings).
2. **User confirms** rotation is done.
3. Verify the app still functions: connectivity, `npm test`, `npm run build`,
   deployment health, and that no Vercel env var still holds the old value.
4. **Then decide on cleanup** — with the recommendation being **Option A**
   (leave history, secret is inert), unless a compliance requirement or the
   user's own preference calls for Option B, in which case its disruption
   (SHA rewrite across 194 commits, 4 force-pushes, 3 broken PRs, possible
   need for a GitHub Support purge request) should be accepted knowingly.
5. Regardless of choice: CI secret scanning is already in place
   (`.github/workflows/secret-scan.yml`) so this cannot silently recur.

---

## 5. Additional hardening worth considering (independent of cleanup)

- **Enable GitHub Push Protection** (Settings → Code security) — blocks
  commits containing recognized secret patterns *before* they land.
- **Consider whether this repo needs to be public at all.** A public repo for
  a multi-tenant SaaS handling student data raises the cost of every future
  mistake of this class. Making it private would not undo this leak, but it
  meaningfully shrinks the blast radius of the next one.
