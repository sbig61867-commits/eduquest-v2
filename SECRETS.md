# Secret management

Written 2026-09-07 in response to a CRITICAL incident: a production Postgres
superuser password was hardcoded in `scripts/run-migration.mjs` and committed
to this **public** repository on 2026-06-22, going undetected for ~2.5 months
until a `gitleaks` history scan found it. See `FINAL_AUDIT_STATUS.md` for the
incident record.

## Rules

1. **Never hardcode a credential in source — not even in a "local dev only"
   script.** The leaked password lived in exactly such a script. Scripts get
   committed like everything else.
2. **Never put a secret in a comment, a doc, a commit message, a test
   fixture, or a log line.** Reports in this repo reference secrets by
   *location and type*, never by value.
3. **Real secrets live only in:** `.env.local` (gitignored, never committed)
   for local work, and the Vercel/Supabase dashboards for deployed
   environments. `.env*` is gitignored except `.env.example`.
4. **`.env.example` holds placeholder names only**, never real values.
5. **A script that needs a credential must read it from the environment and
   fail loudly if it is missing** — never fall back to a default, and never
   embed one. `scripts/run-migration.mjs` is the reference example after its
   fix: it reads `SUPABASE_DB_PASSWORD` and `process.exit(1)`s if unset.

## Enforcement

- **CI:** `.github/workflows/secret-scan.yml` runs `gitleaks` on every push
  and PR with `fetch-depth: 0` (full history — a secret deleted from the
  working tree but still in history must still fail the build).
- **Local (recommended, opt-in):** install the same scanner as a pre-commit
  hook so a secret is caught before it ever reaches a commit:

  ```bash
  # one-time: download gitleaks, then
  gitleaks protect --staged --redact -v
  ```

  Wire that into `.git/hooks/pre-commit` (or a husky/lefthook config if the
  project later adopts one).

## If a secret is ever exposed again

1. **Treat it as compromised immediately** — assume it was scraped, even if
   the repo is private. Public-repo secrets are scraped within minutes by
   automated bots.
2. **Rotate first, clean history second.** Rotation is what actually ends
   the exposure; history rewriting only removes the artifact. A rewritten
   history with an un-rotated credential is still fully compromised.
3. **Rewriting history requires a force-push** and breaks every existing
   clone, fork, and open PR — plan it deliberately, never reflexively.
4. Record the incident (discovery method, affected file, first commit,
   exposure window, rotation status, cleanup status) — **without the value.**
