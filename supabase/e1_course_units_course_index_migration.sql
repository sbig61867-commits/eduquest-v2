-- E1 — index course_units(course_id) (Post-Plan, owner's approval 2026-10-06).
--
-- The only index on course_units.course_id was partial (idx_course_units_order_flat, WHERE level_id IS NULL),
-- so every read filtering a course's units by course_id across BOTH shapes (levelled + flat) read the whole
-- table: the per-course unit count embedded in /admin/courses and /center/courses (course_units(count)),
-- get_course_progress (cu.course_id = p_course_id), and a hard delete of a course (FK course_units.course_id).
--
-- One plain single-column index, nothing else: the ordered paths are already covered by the two partial
-- unique indexes (order_flat, order_leveled). No table, policy, function, grant or other index change.
-- schema.sql does not define course_units (it comes from courses_migration.sql), so it is unchanged.
--
-- Idempotent (IF NOT EXISTS). Rollback: supabase/e1_course_units_course_index_rollback.sql.

CREATE INDEX IF NOT EXISTS idx_course_units_course ON public.course_units (course_id);
