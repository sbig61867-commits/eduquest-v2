-- Rollback for users_column_update_lockdown_migration.sql — restores the prior
-- state read on the live DB 2026-10-16: authenticated held table-level UPDATE on
-- public.users and there were no column-level ACLs (pg_attribute.attacl all NULL).
-- Column grants are removed first, so the column ACLs return to NULL; the
-- table-level grant then restores UPDATE on every column.

REVOKE UPDATE (full_name, locale) ON public.users FROM authenticated;
GRANT UPDATE ON public.users TO authenticated;
