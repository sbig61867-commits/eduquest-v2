-- ============================================================
-- Migration: store the uploaded file's text on the course
-- so AI content generation stays STRICTLY bound to that file
-- (no outside/internet knowledge). Apply in Supabase SQL Editor.
-- ============================================================

ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS source_text TEXT;
-- Holds the extracted text of the PPTX/PDF/DOCX the course was imported from.
-- Used by /api/courses/generate-item-content to write each section from the source only.

-- Verify
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'courses' AND column_name = 'source_text';
