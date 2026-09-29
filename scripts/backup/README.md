# Database backups

Supabase's free plan keeps **no** backups. `.github/workflows/db-backup.yml`
takes one on the **1st and 15th of every month** (owner's choice), and on demand.

```
supabase db dump (roles, schema, data) → pack → brotli → AES-256-GCM (key wrapped with the owner's RSA-4096 public key)
  → 20 MiB parts → Cloudflare Workers KV  backup/<id>/part-NNN … backup/<id>/manifest.json
  → read back and verified → only then older copies beyond the newest 8 are deleted
```

- The plain dump exists only on the GitHub runner and is deleted at the end.
- Only the owner's **private key** can open a backup; GitHub and Cloudflare cannot.
- Not included: files in Storage buckets, proctoring evidence (never backed up by
  policy, `src/lib/evidence-keys.ts`), and Supabase-managed settings (see
  "After a restore").
- Budget: one backup may be up to 400 MB encrypted, and free KV holds 1 GB for the
  whole account. Past that, move backups to R2 (S3 API).

## One-time setup (owner)

1. **Key pair.** `node scripts/backup/keygen.mjs` writes `~/eduquest-backup-key.pem`
   and prints the public key. Keep the `.pem` in two safe places, outside this
   repository. Without it, no backup can ever be opened.
2. **Cloudflare.** A KV namespace for backups: create `eduquest-backups`, or reuse
   `eduquest-evidence` (keys never collide: `backup/…` vs `evidence/…`). A token
   with *Workers KV Storage: Edit*; the existing evidence token works.
3. **Supabase.** Dashboard → Connect → **Session pooler** connection string
   (IPv4; GitHub runners have no IPv6), with the database password filled in.
4. **GitHub secrets** (Settings → Secrets and variables → Actions):
   `SUPABASE_DB_URL`, `BACKUP_PUBLIC_KEY` (the whole PEM block),
   `BACKUP_KV_ACCOUNT_ID`, `BACKUP_KV_NAMESPACE_ID`, `BACKUP_KV_API_TOKEN`.
   With none set the job does nothing; with some set it fails and says which.
5. Push, then run it once by hand (below) and check that it lists.

## Take a copy now

Actions → **Database backup** → Run workflow, or:

```bash
gh workflow run db-backup.yml -f reason="before <migration name>"
```

Take one before applying any migration to the live database.

## List and open backups

On any machine with Node 24, from the repository, with the three `BACKUP_KV_*`
values in `.env.local` (or the environment):

```bash
node --env-file=.env.local scripts/backup/restore.mjs --list
node --env-file=.env.local scripts/backup/restore.mjs --id latest --key ~/eduquest-backup-key.pem
```

The second command downloads, checks every hash, decrypts and writes
`roles.sql`, `schema.sql`, `data.sql` to `~/eduquest-restore/<id>/`. It never
touches a database. Set `BACKUP_KEY_PASSPHRASE` if the key was made with one.

## Restore

Load the files into an **empty** Supabase project (the free plan allows two
projects), never over the live one. This is Supabase's documented command, with
the new project's Session pooler string:

```bash
psql --single-transaction --variable ON_ERROR_STOP=1 --file roles.sql --file schema.sql \
     --command 'SET session_replication_role = replica' --file data.sql --dbname "<connection string>"
```

To recover a few rows deleted by mistake, restore into the spare project and copy
just those rows across; do not restore the whole backup over live data.

### After a restore

The dump does not carry changes made inside Supabase-managed schemas. Re-run:
- `supabase/fix_auth_flow.sql` — the `on_auth_user_created` trigger on `auth.users`.
- `supabase/live_proctoring_channel_migration.sql` — the `realtime.messages` policies.
- `supabase/phase2_permissions_announcements_migration.sql` — the `announcement-images` bucket and its read policy.
- `supabase/individual_tasks_migration.sql` — the private `exam-files` bucket.

Then set the project's URL and keys in the app's environment, the Auth settings
(site URL, redirect URLs, Google provider), and re-upload any Storage files.

## Notes

- The repository is public, so workflow logs are public. The job prints sizes
  and ids only, and masks the database password.
- GitHub disables scheduled workflows in a public repository after 60 days
  without repository activity (it emails first). Re-enable it from the Actions tab.
- A failed scheduled run emails the account that last changed the schedule.
- Tests: `src/__tests__/db-backup.test.ts`.
