-- Removes everything supabase/demo_seed.sql created, and nothing else:
-- the two demo tenants (slug demo-…) and every login ending in
-- @demo.eduquest.test. Deleting the auth users cascades their profiles and
-- everything they own; deleting the tenants cascades the rest.
BEGIN;
DELETE FROM auth.users   WHERE email LIKE '%@demo.eduquest.test' AND id::text LIKE 'dd000000-%';
DELETE FROM public.tenants WHERE slug IN ('demo-alnoor-training', 'demo-alamal-university');
COMMIT;
