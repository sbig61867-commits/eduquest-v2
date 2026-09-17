-- exam_draft_migration.sql
-- Adds answers_draft column to exam_submissions for cross-device resume.
-- Applied manually in the Supabase SQL Editor.

ALTER TABLE public.exam_submissions
  ADD COLUMN IF NOT EXISTS answers_draft JSONB DEFAULT NULL;

-- Update start_exam_attempt to return the saved draft on resume.
CREATE OR REPLACE FUNCTION public.start_exam_attempt(
  p_exam_id  UUID,
  p_student_id UUID,
  p_tenant_id  UUID
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _actor_tenant UUID;
  _real_tenant  UUID;
  _row          RECORD;
BEGIN
  -- Re-derive actor's tenant from the DB (ignore caller-supplied value)
  SELECT tenant_id INTO _actor_tenant FROM public.users WHERE id = auth.uid();
  SELECT tenant_id INTO _real_tenant  FROM public.exams WHERE id = p_exam_id;

  IF _actor_tenant IS NULL OR _real_tenant IS NULL THEN
    RAISE EXCEPTION 'TENANT_MISMATCH';
  END IF;
  IF auth.uid() <> p_student_id THEN
    RAISE EXCEPTION 'STUDENT_MISMATCH';
  END IF;
  IF _actor_tenant <> _real_tenant THEN
    RAISE EXCEPTION 'TENANT_MISMATCH';
  END IF;

  SELECT * INTO _row
    FROM public.exam_submissions
   WHERE exam_id = p_exam_id AND student_id = p_student_id
   LIMIT 1;

  IF FOUND THEN
    IF _row.grading_status = 'submitted' THEN
      RAISE EXCEPTION 'ALREADY_SUBMITTED';
    END IF;
    RETURN jsonb_build_object(
      'started_at',    _row.started_at,
      'resumed',       TRUE,
      'answers_draft', COALESCE(_row.answers_draft, '{}'::jsonb)
    );
  END IF;

  INSERT INTO public.exam_submissions (exam_id, student_id, tenant_id, started_at, grading_status)
    VALUES (p_exam_id, p_student_id, _real_tenant, NOW(), 'in_progress')
    RETURNING * INTO _row;

  RETURN jsonb_build_object(
    'started_at',    _row.started_at,
    'resumed',       FALSE,
    'answers_draft', '{}'::jsonb
  );
END $$;
