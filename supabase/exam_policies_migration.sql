-- Migration: seed exam_policies key in platform_settings
-- proctoring_default_enabled: default state of the "Enable Proctoring" toggle
--   when a teacher creates a new exam (the teacher can still change it per exam).
-- violation_warning_threshold: number of proctoring violations after which the
--   student sees a strong persistent warning during the exam.
-- Safe to run multiple times (ON CONFLICT DO NOTHING).
-- Apply in Supabase SQL Editor.

INSERT INTO public.platform_settings (key, value)
VALUES (
  'exam_policies',
  '{"proctoring_default_enabled": false, "violation_warning_threshold": 5}'::jsonb
)
ON CONFLICT (key) DO NOTHING;
