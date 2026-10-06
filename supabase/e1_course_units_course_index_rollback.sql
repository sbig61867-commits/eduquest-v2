-- Rollback for e1_course_units_course_index_migration.sql — removes the one index it adds.

DROP INDEX IF EXISTS public.idx_course_units_course;
