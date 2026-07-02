-- Migration: seed ai_rate_limits key in platform_settings
-- Safe to run multiple times (ON CONFLICT DO NOTHING).
-- Apply in Supabase SQL Editor.

INSERT INTO public.platform_settings (key, value)
VALUES (
  'ai_rate_limits',
  '{"lesson_per_hour": 10, "exam_per_hour": 20}'::jsonb
)
ON CONFLICT (key) DO NOTHING;
