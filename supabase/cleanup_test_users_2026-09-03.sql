-- ============================================================
-- Permanent cleanup: delete all users except the two accounts to keep.
-- Requested 2026-09-03. NOT applied automatically — run manually in the
-- Supabase SQL Editor. This is irreversible: deleting from auth.users
-- cascades (ON DELETE CASCADE) through public.users into every table that
-- references them (groups, group_students, lessons, exams,
-- exam_submissions, grades, invitations, etc.) for these 4 accounts only.
--
-- KEPT (verified via read-only query against production on 2026-09-03):
--   622217fa-6849-4734-a519-9b403934df4b  sbig61867@gmail.com      (super_admin)
--   cf097837-bde1-4361-9866-3747989f8190  ashaqoura@reklam.ps      (teacher, unchanged)
--
-- DELETED — all 4 match the seeded test-account pattern (…@eduquest.local),
-- not real pilot data:
--   7b124c10-3a2b-4abe-8b8a-12e669489139  super.test@eduquest.local
--   46eb1b71-1ec0-4965-8795-3c174c305330  Admin.university.test@eduquest.local
--   dc1672da-de1a-4f14-a859-745c6791ae39  teacher.test@eduquest.local
--   4d6ff716-da3b-4540-89cb-b218c25d3896  student.test@eduquest.local
--
-- Re-run the read-only check below FIRST if time has passed since
-- 2026-09-03 — new users may have signed up since, and this script only
-- ever touches the 4 IDs listed above, never a broader condition, so it's
-- safe against that drift by construction (it won't accidentally sweep up
-- anyone new) but won't clean up any *new* test accounts either.
--
--   SELECT id, email, full_name, role FROM public.users ORDER BY created_at;
--
-- UPDATE 2026-09-03: first run attempt failed with
--   ERROR 23502: null value in column "invited_by" of relation "invitations"
--     violates not-null constraint
-- Live schema drift: invitations.invited_by is NOT NULL on production, but
-- its FK is ON DELETE SET NULL (invitations_migration.sql:27,
-- fixes_migration.sql) — those two are mutually incompatible whenever the
-- inviting user is deleted. There is exactly one invitation row in the
-- whole table (verified read-only), created by
-- 46eb1b71-1ec0-4965-8795-3c174c305330 (Admin.university.test@eduquest.local,
-- one of the 4 being deleted) — it's the public teacher-invite link Ahmed
-- Shaqoura already used to join; deleting it now does not affect his
-- account or membership, it has already served its purpose. Deleting it
-- first avoids the constraint violation.

DELETE FROM invitations WHERE invited_by IN (
  '7b124c10-3a2b-4abe-8b8a-12e669489139',
  '46eb1b71-1ec0-4965-8795-3c174c305330',
  'dc1672da-de1a-4f14-a859-745c6791ae39',
  '4d6ff716-da3b-4540-89cb-b218c25d3896'
);

DELETE FROM auth.users WHERE id IN (
  '7b124c10-3a2b-4abe-8b8a-12e669489139', -- super.test@eduquest.local
  '46eb1b71-1ec0-4965-8795-3c174c305330', -- Admin.university.test@eduquest.local
  'dc1672da-de1a-4f14-a859-745c6791ae39', -- teacher.test@eduquest.local
  '4d6ff716-da3b-4540-89cb-b218c25d3896'  -- student.test@eduquest.local
);

-- Verify only the 2 kept accounts remain:
-- SELECT id, email, full_name, role FROM public.users ORDER BY created_at;
