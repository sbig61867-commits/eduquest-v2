# PRODUCT_COMPLETENESS_AUDIT

Date: 2026-09-09 · Branch `main`

Scope: does every role have a complete path through the product, and does every feature the backend
supports have a surface a user can reach? Nothing in this audit was fixed by adding mock data, fake
statistics or invented capabilities.

## Summary

EduQuest V2 is substantially complete. Five roles, 64 page routes and 49 API handlers cover
tenancy, invitations, groups, courses, lessons, exams, homework, proctoring, grading, reports,
announcements, schedules, staff requests and surveys.

Three real completeness defects were found. All three are fixed in this pass. One requires a
migration to be run manually.

## Defect 1 — students could not open a course (fixed)

The student course list is the entry point to the whole learning experience. Every card carries a
primary button labelled "Start Course" or "Continue Course". That button navigated to
`/student/courses/{id}`, and **no route existed there**.

The consequence: the data model supported levels, units and unit items, the teacher could author and
publish all of it, `student_progress` existed with working row-level security, and `get_course_progress`
was wired into the list page — but a student had no way to read a single line of that content. The
course player, the central student surface, was missing.

Fixed by adding `src/app/(student)/student/courses/[id]/`:

- **Server page.** Gates on an actual row in `course_enrollments` for the signed-in student, then on
  `courses.is_published`. Loads the level/unit/item tree for leveled courses and the flat unit tree
  for others, drops every unpublished level, unit and item, and loads the student's existing
  `student_progress` rows. Reads go through the user-session client, so RLS applies on top.
- **Client player.** Course outline with per-section completion marks, a reader that renders item
  bodies through the existing dependency-free `Markdown` component, previous/next navigation, a
  progress bar, and a "Mark complete" action. It opens on the first unfinished section, so returning
  to a course resumes where the student stopped.
- **Progress writes.** A plain insert into `student_progress`. That table's policy pins
  `student_id = auth.uid()` and `tenant_id = current_tenant_id()`, so neither value can be forged
  from the client even though both are passed in. `ON CONFLICT DO NOTHING` keeps re-marking idempotent
  and avoids needing an UPDATE policy the table does not have.

No schema change was required.

## Defect 2 — flat courses always reported 0% progress (fix written, needs to be run)

`get_course_progress` counts a course's items with:

```
JOIN course_units cu ON cu.id = ui.unit_id
JOIN course_levels cl ON cl.id = cu.level_id
```

That inner join goes through `course_levels`. Flat courses, which are courses created with
`has_levels = FALSE`, store their units with `course_units.level_id IS NULL`. The join drops every
one of their rows, so the function returns `total = 0, completed = 0, percent = 0` for a flat course
no matter how much the student has actually finished. The progress bar on `/student/courses` is
permanently empty for that entire class of course.

A second defect sits in the same function: `total_items` filters on `ui.is_published = TRUE` and
`completed_items` does not. A student who completed an item that was later unpublished can score
`completed > total`, producing a percentage above 100.

Both are fixed in `supabase/fix_get_course_progress_flat_courses_migration.sql` by counting through
`course_units.course_id`, which is `NOT NULL` for leveled and flat units alike, and applying the same
published filter to both counts. The authorization block is carried over verbatim from
`fix_get_course_progress_cross_tenant_idor_migration.sql` and the grant matrix is unchanged.

**This file has not been applied.** Per the repository's convention there is no migration CLI, so it
must be pasted into the Supabase SQL Editor. Until then, flat courses keep reporting 0%.

## Defect 3 — the centre manager had no error boundary (fixed)

`(center)` was the only authenticated route group with neither `error.tsx` nor `loading.tsx`. Any
error thrown inside a centre-manager page escaped to the root boundary, which renders without the
sidebar and header, so the user was dropped out of the application shell with no route back to
`/center/dashboard`. Both files were added, matching the other four groups.

## Coverage that was checked and found complete

- **Homework.** There is no separate student homework page and none is needed. Homework is modelled
  as an exam variant and surfaced in `/student/exams`, which splits each subject into homework and
  exams and labels the actions accordingly.
- **Notifications.** The bell in the shared header serves every role. `/student/notifications` is an
  additional full-page view for students, not a gap for the others.
- **Settings.** Present for the two roles that have tenant-level settings to change,
  `university_admin` and `super_admin`. Students have `/student/profile`. Teachers and centre
  managers have no tenant-level settings to own, so no page is missing.
- **Question bank.** Not a separate feature in this product. Questions belong to an exam and are
  authored or AI-generated inside the exam editor.
- **AI.** All generation paths route through the shared provider chain and are rate-limited per user
  and feature.

## Open item, not fixed here

The product is bilingual Arabic and English, but there is no internationalization layer. Individual
components hardcode `dir="rtl"` on their own container while `<html>` stays `lang="en"` with the
default direction. Because Tailwind's `rtl:` variants key off an ancestor's direction, they work only
inside those islands. Fixing this properly means introducing a locale, setting `lang` and `dir` on
the document from it, and moving strings into message catalogues. That is a large change that would
touch nearly every component, and doing it as part of this pass would put working functionality at
risk for no immediate user benefit. It is recorded here as the largest remaining structural gap.
