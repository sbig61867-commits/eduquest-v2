# Sign-in, centre manager, design system (moved from CLAUDE.md)

## Sign-in (2026-09-29)

- **Google sign-in is hidden** (awaiting Google verification): `src/lib/google-sign-in.ts`, shown only with
  `NEXT_PUBLIC_GOOGLE_SIGNIN=on` (rebuild). `/auth/callback` is unchanged.
- **Sign-in by member ID**: the login field takes an email or an ID (`QOU-S48203917`, `src/lib/member-code.ts`);
  an ID goes to `POST /api/auth/login-id` (public prefix in the proxy, rate-limited per IP and per ID), which
  resolves it to the auth email with the service role and signs in server-side. Unknown ID = wrong password.
- **Student account by ID (no email)**: `create-user` with `login_mode: 'member_id'` (students only, needs
  `member_code_migration.sql` → else 409 `memberCodeNotReady`). Auth email = `<uuid>@no-email.invalid`
  (`src/lib/member-login.ts`); `public.users.email` is then set to the member code, so every screen shows the ID
  and `/api/mail/send` skips it. Returns `member_code` + a generated `temp_password` once. UI: «بمعرّف (بدون إيميل)»
  on the invitations screen (direct account) and the centre people dialog.
- **Forced password change**: every account `create-user` makes gets `app_metadata.must_change_password = true`
  (service-role only). `src/proxy.ts` sends such a user to `/change-password` (APIs answer 403) until
  `POST /api/auth/change-password` sets the new password (must differ from the temporary one) and clears the flag;
  the page then calls `refreshSession()` so the JWT drops it. Invitation/Google accounts chose their own password
  and never carry the flag.

## Centre manager panel

Each university has exactly one continuing-education centre, so `center_manager` is tenant-scoped (no `centers` table). **Naming rule:** the two admin accounts never share a label — `university_admin` is named after the institution (`getTerms().institutionAdmin`: «مدير الجامعة», «مدير مركز التدريب» …) and `center_manager` is named by institution type too (`getTerms().centerManager`, 2026-09-29: university/institute «مدير مركز التعليم المستمر», school «مدير مركز الأنشطة», training centre «مساعد مدير المركز», company «منسق التدريب») and never contains the institution admin's label. The role shows in the header only; the sidebar top is the EduQuest brand with the institution name beneath it (`components/shared/adaptive-name.tsx`: short form, full name on hover). Enforced by `src/__tests__/role-label-separation.test.ts`. **Who configures whom (owner's rule, 2026-09-28):** the owner (super_admin) grants each institution admin (`university_admin`, whatever the `institution_type` — a university or an independent training centre) its capabilities; inside that grant the admin runs its own institution freely — creates/invites/(de)activates/deletes its centre managers and sets their capabilities — but can never grant a capability it does not hold (`ungrantableCapabilities` in `/api/admin/permissions`, `canManageAccountOf` for accounts). Do NOT gate this on `institution_type` (tried in PR #15, reverted). **Adding a student (owner's rule, 2026-09-29):** by invitation link OR by creating the account directly (four-part name + temporary password), for the centre manager (`components/center/people-client.tsx`), the institution admin of every institution type, and teachers (the «حساب مباشر» option on the shared invitations screen, `components/shared/invitations-client.tsx`). All go through `/api/admin/create-user`; a teacher may create **students only, into one of their own groups** (`group_id` required, `addOwnGroupsOnly` / `teacherGroupRequired`), staff may add an optional group. Group seat cap + linked-course enrolment are the shared rules in `src/lib/group-enrolment.ts` (also used by `/api/group-students`); a failure after the auth account exists deletes it again. Its pages under `src/app/(center)/center/*` gate per capability via `src/lib/center-access.ts`; route handlers use `src/lib/staff-auth.ts` (`staffCan`, `canManageAccountRole` — a centre manager can only ever create/invite/(de)activate `teacher`/`student`). Capabilities added 2026-09-13: `manage_courses` (create a course, assign it to a teacher, enrol students via `/api/course-enrollments`) and `manage_attendance` (`/api/attendance`, also open to a group's own teacher). Staff-created groups/courses always carry a real `teacher_id`. Because `university_admin` defaults ON, admins can now also edit/delete any course in their tenant through `/api/courses`.

Course analytics (`/center/analytics`, `view_reports`) reads `get_course_analytics` + `get_tenant_engagement` and
shows strengths/weaknesses/suggestions from the rule-based `courseInsights()` — no AI on page load. AI phrasing is
**on demand only**: `/api/ai/course-suggestions` (POST `{course_id, days}`) re-computes the course's numbers
server-side through the user session, feeds them to `groqChat`, and is rate-limited 10/h per user + metered via
`meteredAiRoute`. Never call it from a render path.

Announcements tooling (free, no new storage): `components/announcements/banner-designer.tsx` renders a 1200×400 banner on a `<canvas>` in the author's browser (templates, RTL text, optional background photo) and uploads only the final WebP through `/api/announcements/upload`; `/api/ai/announcement-copy` suggests title/body/CTA via `groqChat` (text only, `manage_announcements` + 15/h rate limit). Datetime inputs are converted local→ISO in `announcements-manager.tsx` — a bare `datetime-local` string is stored as UTC by Postgres and shifts the window by the viewer's offset. The route rejects `image_url` values outside the project's `announcement-images` bucket.

## Design system (D3, 2026-10-06)

Tokens: `src/app/design-tokens.css` (imported by `globals.css`). Raw values are `--eq-*` on `:root` (dark, soft
navy since 2026-10-09) and on `:root[data-eq-theme="light"]`. **One theme system for the whole product** (owner,
2026-10-09): `THEME_BOOT_SCRIPT` always sets `<html data-eq-theme>` (cookie `eq_theme`, else system setting);
`globals.css` remaps the slate/accent palette for components still on raw classes. `ThemeToggle` (sun · moon pill)
sits in the public bars, the demo and the signed-in header. **A theme or language switch always reloads the page.**
Utilities: colours `canvas surface elevated line line-strong fg fg-2 fg-3 accent(-hover/-fg/-subtle) focus
success warning danger info (+ -subtle)` (old names `border fg-secondary fg-muted error` are aliases); type
`text-display h1 h2 h3 body body-sm meta label numeric-lg`; `num` (tabular figures); radius `rounded-control`
(4px inputs/buttons/badges) · `rounded-overlay` (8px modals/dropdowns) · none for sections/tables · `rounded-full`
avatars/status dots only; `shadow-overlay` for floating elements only; primitives `.eq-section`,
`.eq-section-index` (01/02/03 on meaningful main sections only), `.eq-row`, `.eq-divide`, `.eq-focus`. Fonts: IBM
Plex Sans Arabic + IBM Plex Sans (Latin) — no other font, no Plex Mono without a separate decision.
Ratchet: `src/__tests__/design-contract.test.ts` (+ `-scan.ts`, `-state.ts`) counts raw palette colours,
`text-[Npx]`, `rounded-xl/2xl/3xl`, gradients, coloured shadows, `backdrop-blur`, `p-5` per file in
`src/{app,components}` — shrink-only, new files must be clean. `design-tokens.test.ts` checks light parity and WCAG AA
pairs. Anti-patterns to avoid in new UI: KPI-card rows, icons in coloured boxes,
card inside card, decorative icons/colour/animation, more than one page-level primary action.

