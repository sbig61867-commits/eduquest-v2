-- =============================================================================
-- Exam logic audit 2026-09-30 — B1: a blank answer earns an essay's full marks.
-- =============================================================================
-- finalize_exam_submission awards a question's points when
--   lower(btrim(answer)) = lower(btrim(correct_answer))  and correct_answer IS NOT NULL.
-- Essay questions are stored with correct_answer = '' (generate-homework-from-file
-- writes "" explicitly; /api/exams/individual defaults to ''), so an unanswered
-- essay matches '' = '' and scores in full — while a real essay answer scores 0
-- until the teacher grades it. Observed live 2026-09-30: MCQ answered WRONG +
-- both essays left BLANK = 10/12, written to exam_submissions AND grades.
--
-- Expected (fixed by exam_grading_window_fix_migration.sql, applied 2026-09-30):
-- B1-01 score 0 (only an auto-gradable question with a non-empty key can score),
-- B1-02 the same in grades, B1-03 a correct MCQ still 2. Before the fix B1-01 /
-- B1-02 read 10/12.
--
-- SAFE TO RUN ANYTIME: one transaction, always rolled back, zero residue.
-- =============================================================================

begin;

insert into auth.users (id, email) values
  ('90000000-0000-0000-0000-0000000000a2','g-teacher@test.local'),
  ('90000000-0000-0000-0000-0000000000a3','g-student@test.local'),
  ('90000000-0000-0000-0000-0000000000a4','g-student2@test.local');
insert into public.tenants (id, name, slug, is_active) values
  ('90000000-0000-0000-0000-00000000000a','__g_a__','__g-a__',true);
insert into public.users (id, email, full_name, role, tenant_id, is_active) values
  ('90000000-0000-0000-0000-0000000000a2','g-teacher@test.local','GT','teacher','90000000-0000-0000-0000-00000000000a',true),
  ('90000000-0000-0000-0000-0000000000a3','g-student@test.local','GS','student','90000000-0000-0000-0000-00000000000a',true),
  ('90000000-0000-0000-0000-0000000000a4','g-student2@test.local','GS2','student','90000000-0000-0000-0000-00000000000a',true)
on conflict (id) do update set role=excluded.role, tenant_id=excluded.tenant_id;
insert into public.groups (id, tenant_id, teacher_id, name) values
  ('90000000-0000-0000-0000-0000000000c1','90000000-0000-0000-0000-00000000000a','90000000-0000-0000-0000-0000000000a2','GG');
insert into public.group_students (group_id, student_id) values
  ('90000000-0000-0000-0000-0000000000c1','90000000-0000-0000-0000-0000000000a3'),
  ('90000000-0000-0000-0000-0000000000c1','90000000-0000-0000-0000-0000000000a4');
-- As generate-homework-from-file stores it: 1 MCQ (2 pts) + 2 essays, correct_answer "" (5 pts each).
insert into public.exams (id, tenant_id, teacher_id, group_id, type, title, questions, duration_minutes, is_published) values
  ('90000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-00000000000a','90000000-0000-0000-0000-0000000000a2','90000000-0000-0000-0000-0000000000c1','exam','Grading probe',
   '[{"id":"q1","type":"mcq","options":["A","B"],"correct_answer":"A","points":2},{"id":"q2","type":"essay","correct_answer":"","points":5},{"id":"q3","type":"essay","correct_answer":"","points":5}]'::jsonb, 60, true);

create temp table r (test text, outcome text) on commit drop;

select public.start_exam_attempt('90000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-0000000000a3','90000000-0000-0000-0000-00000000000a');
insert into r select 'B1-01 wrong MCQ + both essays blank (must be score 0)',
  (public.finalize_exam_submission('90000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-0000000000a3','{"q1":"B"}'::jsonb,'[]'::jsonb,0,0))::text;
insert into r select 'B1-02 grades row for that attempt (must be 0/12)',
  (select score||'/'||max_score from public.grades where exam_id='90000000-0000-0000-0000-000000000001' and student_id='90000000-0000-0000-0000-0000000000a3');

select public.start_exam_attempt('90000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-0000000000a4','90000000-0000-0000-0000-00000000000a');
insert into r select 'B1-03 correct MCQ + written essays (must be score 2)',
  (public.finalize_exam_submission('90000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-0000000000a4','{"q1":"A","q2":"An answer","q3":"Another"}'::jsonb,'[]'::jsonb,0,0))::text;

select test, outcome from r order by test;

rollback;
