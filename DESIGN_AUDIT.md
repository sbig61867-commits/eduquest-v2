# DESIGN_AUDIT.md — EduQuest Visual & Interaction Audit

**Phase 1 of 4.** This document *describes what exists*. It contains no design
decisions, no new tokens, and no code. Direction belongs in Phase 2
(`DESIGN_DIRECTION.md`), the system in Phase 3, the surfaces in Phase 4.

Audited: 2026-09-07 · commit `be209dd` · 131 `.tsx` files · 57 routes · 5 roles.
Method: static read of the whole `src/` tree plus aggregate counts over every
Tailwind utility in use. Every number below is reproducible from the repo.

---

## 0. Executive summary

EduQuest is a genuinely capable product — server-authoritative exam integrity,
RLS multi-tenancy, live proctoring, AI generation, five roles. **None of that
capability is visible in the interface.** The UI presents every role, every
domain and every level of consequence through one undifferentiated visual
treatment: a dark slate card on a dark slate page.

The three structural findings, in order of impact:

1. **There is no design system.** `globals.css` is still the unmodified Next.js
   starter file. All styling is ad-hoc Tailwind literals across 131 components:
   110 distinct color utilities, 9 radius values, 10 type sizes, 5 weights, no
   tokens, no primitives beyond 5 thin wrappers. Nothing is centrally
   changeable.
2. **The five dashboards are one template.** Student, Teacher, University
   Admin, Centre Manager and Super Admin all render the identical structure:
   `h2` + 4 stat cards (blue / emerald / violet / amber, in that order, every
   time) + one or two list panels. A teacher's working day and a platform
   owner's fleet view are rendered by the same 40 lines of JSX.
3. **The interface has no notion of "now".** Nothing anywhere surfaces state,
   urgency, or next action. There is no "continue", no "needs attention", no
   "due", no progress. Every surface is a passive inventory of rows.

Below that sit a measurable accessibility failure (`text-slate-500`, used 218
times, is 3.75:1 — below WCAG AA), a half-finished bilingual story (20 files
hard-code `dir="rtl"` inside an `<html lang="en">` app), and duplicated page
titles on all 46 content surfaces.

---

## 1. Foundations

### 1.1 The stylesheet is the framework default

`src/app/globals.css` — 27 lines, entirely unmodified from `create-next-app`:

```css
:root { --background: #ffffff; --foreground: #171717; }
@media (prefers-color-scheme: dark) { :root { --background: #0a0a0a; ... } }
body { font-family: Arial, Helvetica, sans-serif; }
```

Consequences, all live:

- **Zero design tokens.** No brand color, no spacing scale, no radius scale, no
  elevation scale, no type scale. Nothing exists to change.
- **The typeface is not the typeface.** `layout.tsx` loads Geist and sets
  `--font-geist`, but `globals.css` then hard-sets `body { font-family: Arial }`
  and `@theme inline` maps `--font-sans` to `--font-geist-sans`, a variable that
  is never defined (the layout defines `--font-geist`). **The entire product
  currently renders in Arial.** The loaded webfont is downloaded and unused.
- **The dark-mode block is dead and contradictory.** It sets a `#0a0a0a`
  background for `prefers-color-scheme: dark`, while `body` is hard-coded
  `bg-slate-950` in the layout and every component hard-codes slate darks. The
  app is dark-only, but claims to be theme-aware.

### 1.2 Color

1,615 slate + 327 blue + 184 red + 157 emerald + 95 violet + 74 amber + 16
purple + 11 green + 4 sky + 2 pink + 2 indigo + 2 cyan = **110 distinct color
utilities**, none named, none centralized.

| Family | Uses | Role in the product | Problem |
|---|---|---|---|
| slate | 1615 | every surface, border, text | 8 of 11 steps in use; no defined roles |
| blue | 327 | primary action **and** "lessons" **and** brand mark | overloaded |
| red | 184 | danger **and** the "problem" section on landing | acceptable |
| emerald | 157 | success **and** "students" **and** "published" | overloaded |
| violet | 95 | "exams" **and** "lessons" (admin) | inconsistent |
| amber | 74 | warning **and** "notifications" **and** "upcoming" | overloaded |
| purple/green/sky/pink/indigo/cyan | 37 | one-off strays | should not exist |

Two independent color languages run on top of each other and are nowhere
distinguished: **semantic** (success / danger / warning) and **categorical**
(lessons / exams / students / groups). `emerald` means both "this succeeded" and
"this is a student". `amber` means both "careful" and "upcoming exam". A reader
cannot learn the code because there isn't one.

Six strays (`purple`, `green`, `sky`, `pink`, `indigo`, `cyan` — 37 uses) are
pure drift: `purple-600` and `violet-600` appear in the same product with no
distinction intended.

### 1.3 Typography

| Size | Uses | | Weight | Uses |
|---|---|---|---|---|
| `text-sm` | 510 | | `font-medium` | 210 |
| `text-xs` | 246 | | `font-bold` | 130 |
| `text-2xl` | 71 | | `font-semibold` | 97 |
| `text-3xl` | 31 | | `font-extrabold` | 3 |
| `text-lg` | 15 | | `font-normal` | 1 |
| `text-xl` | 13 | | | |
| `text-base` | 4 | | | |
| `text-4xl/5xl/6xl` | 6 | | | |

**756 of 896 type declarations (84%) are `text-sm` or `text-xs`.** The product
is typographically flat: almost everything is small, and the only hierarchy
signals available are weight and color. `text-base` — the natural body size — is
used 4 times in the entire codebase.

There is no named hierarchy. `text-2xl font-bold text-white` is retyped in 46
files as the page title. `text-3xl font-bold text-white` is the stat number.
`text-sm font-medium` is simultaneously a nav label, a table cell, a list-item
title and a button. Nothing distinguishes a heading from a value from a label
except the author's memory at the time.

### 1.4 Spacing, radius, elevation

- **Spacing** is applied but arbitrary: `p-5` (50), `p-4` (41), `p-3` (29),
  `p-6` (28), `p-2` (15), `p-8` (11), `p-1` (10), `p-1.5` (8), `p-2.5` (4),
  `p-10` (3), `p-7` (1). Card padding is `p-5` in dashboards, `p-6` on the
  landing page, `p-8` in error states — one component role, three values.
  `gap` follows the same pattern across 10 values.
- **Radius**: 9 distinct values. `rounded-lg` (250) and `rounded-xl` (184) are
  used interchangeably for the *same* element class — a card is `rounded-xl` in
  dashboards, `rounded-2xl` in modals, `rounded-xl` on landing. `rounded` (20)
  and `rounded-md` (4) are leftovers.
- **Elevation is effectively absent**: `shadow-2xl` (13), `shadow-lg` (3),
  `shadow` (2). Depth is instead communicated by a 1px `border-slate-800` on a
  `bg-slate-900` sitting on `bg-slate-950`. That is a defensible choice, but it
  is undeclared, so when a shadow *is* used it jumps straight to `2xl` with
  nothing in between.

### 1.5 Iconography

Single source (`lucide-react`), which is good. But:

- The sidebar hard-codes a **16-icon allowlist** (`ICONS` const in
  `sidebar.tsx`) with `IconName` as a union — adding a nav item requires editing
  the shared component. This is why `/admin` uses `BookOpen` for **both**
  "Courses" and "Lessons": there was no third book icon in the allowlist.
- Icon sizes are literals: `w-5 h-5`, `w-4 h-4`, `w-3.5 h-3.5`, `w-1.5 h-1.5`,
  with no rule tying icon size to text size.
- `Sparkles` appears in 8 files (28 uses) as the AI marker — precisely the
  "AI-generated product" signal to be avoided.

### 1.6 Motion

`transition-colors` (144) dominates; `transition-all` (12) is the lazy variant
and sits on the sidebar/shell width transitions (`duration-300`), which animates
`padding-left` on every layout — a layout-thrashing property. `animate-pulse`
(7) is skeletons plus a decorative "Operational" dot; `animate-spin` (6) is
loaders; `animate-bounce` (1) is a landing-page scroll hint. There is **no
motion vocabulary** — no enter/exit for modals (they hard-mount), no list
transitions, no state-change feedback.

---

## 2. Navigation & information architecture

### 2.1 The sidebar is a flat list at every scale

`Sidebar` takes `items: NavItem[]` and renders one flat, ungrouped, unlabelled
column. Item counts per role:

| Role | Items | Grouped? |
|---|---|---|
| University Admin | 14 | no |
| Teacher | 10 | no |
| Super Admin | 10 | no |
| Student | 8 | no |
| Centre Manager | 3 | no |

Fourteen equally-weighted links is not information architecture; it is a
directory. There is no concept of section, no primary/secondary distinction, no
separation between "what I do daily" and "what I configure quarterly".
`Settings` carries the same visual weight as `Dashboard`.

Specific IA problems:

- **`/admin` has both "Courses" and "Lessons"** as siblings with the same icon
  and no expressed relationship (a course *contains* lessons — the teacher side
  models this correctly via `/teacher/courses/[id]`).
- **Duplicate icons within one sidebar**: admin uses `BookOpen` twice;
  super-admin uses `ShieldCheck` twice (Permissions, Audit Logs).
- **The Centre Manager sidebar is static while their abilities are dynamic.**
  `users.permissions` gates what they can actually do, yet all 3 nav items show
  unconditionally. A manager with zero capabilities still sees the full nav and
  discovers the wall only on click.
- **Collapsed state loses everything.** At `lg:w-16`, labels vanish with no
  `title` attribute and no tooltip — the collapsed sidebar is 10 unlabelled
  icons, several of them duplicates (above), so it is genuinely ambiguous.

### 2.2 Every page has two titles

`Header` renders a fixed title per route group — `"Student Portal"`,
`"Teacher Panel"`, `"Admin Panel"`, `"Centre Panel"`, `"Super Admin Panel"` —
which **never changes as you navigate**. Each page then renders its own
`<h2 className="text-2xl font-bold text-white">` (46 occurrences).

So on `/teacher/exams` the user sees "Teacher Panel" in the fixed bar and
"Exams" 24px below it. The persistent bar carries zero wayfinding information,
and the real title is not sticky. There are also no breadcrumbs anywhere —
`/teacher/courses/[id]` and `/teacher/lessons/[id]` are two levels deep with no
path back except the sidebar.

### 2.3 Layout mechanics

`ContentShell`, `Header` and `Sidebar` each independently read `sidebarOpen`
from the UI store and each apply their own offset (`lg:pl-64`/`lg:pl-16`,
`lg:left-64`/`lg:left-16`, `lg:w-64`/`lg:w-16`). The offset constant is written
out in three places. Every layout then does
`<main className="p-4 lg:p-6 !pt-20">` — an `!important` override compensating
for the fixed header, repeated in all five layouts.

---

## 3. The dashboards — the core problem

All five dashboards are structurally identical. Reduced to their skeleton:

```
h2 "…Dashboard"  +  p "…subtitle"
grid sm:2 lg:4  →  4 × { label, big number, tinted icon square }
grid lg:2       →  1–2 × { "Recent X" panel with ≤5 rows }
```

The four stat cards use the **same four colors in the same order in all five
roles**: blue, emerald, violet, amber. This is literal — the `cards` array in
each dashboard file is the same shape with the same color strings.

What this costs, role by role:

**Student** — `(student)/student/dashboard/page.tsx`
Available Lessons · Upcoming Exams · Exams Taken · Notifications, then "Recent
Lessons" and "My Grades" lists.
- Every number is a **count**, not a state. "Available Lessons: 12" does not
  tell a student what to do next; it reports the size of a backlog.
- **There is no "continue".** The student's actual intent — resume what I was
  doing — has no representation anywhere in the product.
- **There is no progress.** Course progress exists in the DB
  (`get_course_progress` RPC) and is not surfaced on the dashboard at all.
- "Upcoming Exams: 3" is a count with no *when*. The exam starting in two hours
  and the exam next month occupy the same pixel.
- **`Notifications` is hard-coded to `'0'`** (line 49) — a stat card
  structurally incapable of being true.
- All five "Recent Lessons" rows link to `/student/lessons` — the same generic
  href for every row, so the list looks navigable but isn't.

**Teacher** — `(teacher)/teacher/dashboard/page.tsx`
My Groups · Lessons Created · Exams Created · Upcoming Exams.
- Three of four cards are **lifetime vanity counts**. "Lessons Created: 47" is
  never actionable.
- The teacher's actual work is entirely absent: **nothing needs grading, nothing
  needs attention, no student is flagged, no exam is in progress.** The grading
  queue, the proctoring alerts and the student requests all exist as features
  and none appear here.
- It is the only dashboard whose cards link anywhere (`href` per card) — an
  improvement the other four didn't inherit.

**University Admin** — `(admin)/admin/dashboard/page.tsx`
Teachers · Students · Lessons · Exams, plus "Recent Activity".
- "Recent Activity" is **five lessons relabelled as events** — the code comment
  admits it: *"Recent lessons stand in as the activity feed until a dedicated
  audit table exists."* An institution-level admin is shown a placeholder.

**Centre Manager** — `(center)/center/dashboard/page.tsx`
Same four cards (Arabic labels), plus a "your capabilities" chip list.
- That capability list is the most genuinely useful widget in any dashboard, and
  it is styled as an afterthought at the bottom.

**Super Admin** — `(super-admin)/super-admin/dashboard/page.tsx`
Total Tenants · Total Users · Active Features · Audit Events Today.
- **Two of four cards are fabricated**: `'Active Features': '12'` and
  `'Audit Events Today': '0'` are string literals (lines 25–26).
- "System Status" renders Database / Auth / Storage / Realtime as
  unconditionally **"Operational" with a pulsing green dot** — hard-coded, with
  no health check behind it. A status display that cannot report an outage, on
  the console of the person responsible for outages.

---

## 4. Components

### 4.1 The primitive layer is 5 files and is bypassed constantly

`src/components/ui/` contains `button`, `input`, `badge`, `modal`, `toast`.
That is all. Missing entirely: Select, Textarea, Checkbox, Radio, Switch, Table,
Tabs, Card, Progress, Skeleton, Dropdown, Tooltip, Avatar, EmptyState, Alert,
Pagination, Breadcrumb, Command menu.

Bypass rate:

| Primitive | Component used | Raw HTML used | Bypass |
|---|---|---|---|
| Button | 146 | 109 `<button>` | **43%** |
| Input | 34 | 73 `<input>` | **68%** |
| Modal | 18 | 4 raw overlays | 18% |
| Select | — | 22 `<select>` | **100%** |
| Textarea | — | 16 `<textarea>` | **100%** |
| Table | — | 11 `<table>` | **100%** |

Each of those 22 selects and 16 textareas carries its own hand-written
`bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 …` string, and they
are not identical to each other — the search input in `students-client.tsx` uses
`bg-slate-900 border-slate-800` while `ui/input.tsx` uses
`bg-slate-800 border-slate-700`. Two different form-field appearances on the
same page.

### 4.2 Primitive by primitive

**Button** — 4 variants (primary/secondary/danger/ghost), 3 sizes. No icon-only
size, so icon buttons use `size="sm"` with padding meant for text. No
`asChild`/link variant, so every navigating "button" is either a hand-styled
`<a>` or a `router.push` on a real button. The focus ring hard-codes
`focus:ring-offset-slate-950` — the component knows the page background, so it
can only ever exist on one background.

**Input** — label + error only. No hint text, no required marker, no
prefix/suffix slot (so all 6 search fields re-implement an absolutely positioned
icon), and no `id`/`htmlFor` wiring — **the `<label>` is not associated with the
`<input>`**, so clicking the label does nothing and screen readers don't pair
them. `error` renders text but sets no `aria-invalid` or `aria-describedby`.

**Badge** — variants are named by **color**, not meaning: `green`, `red`,
`blue`, `yellow`, `gray`. This is why the same green badge means "Active",
"Published" and "Passed" across the app, with no way to change one without the
others.

**Modal** — closes on Escape and on backdrop click, but: no focus trap, no focus
restore on close, no `aria-modal`/`aria-labelledby`, no body scroll lock, and no
enter/exit transition (it hard-mounts via `if (!open) return null`). Four
surfaces bypass it with raw `fixed inset-0` overlays.

**Toast** — the best-built primitive here (global emitter, no provider needed,
queue capped at 5, auto-dismiss). Gaps: fixed `bottom-4 right-4` regardless of
`dir="rtl"` surfaces; no `role="status"`/`aria-live`, so screen readers are
never told; the 4s dismiss is not pausable on hover; no action slot (no "Undo").

**`confirmDialog`** (`src/lib/confirm-dialog.tsx`) — a good idea (promise-based,
portal per call). But its default button labels are **Arabic literals**
(`'تأكيد'` / `'إلغاء'`) hard-coded for every caller in an otherwise English UI,
and it auto-detects direction by regex-testing the message for Arabic
characters. It also duplicates Modal's chrome instead of using it.

**Sidebar** — carries `handleSignOut`, Supabase client construction and auth
store reset. A navigation component owns the session lifecycle.

### 4.3 Tables

11 tables, all hand-built, no shared component. **Only 1 of 11 sits inside an
`overflow-x` wrapper.** The other 10 handle narrow screens by *hiding columns*:
16 × `hidden md:table-cell`, 12 × `hidden lg:table-cell`, 2 ×
`hidden sm:table-cell`.

On a phone the students table shows Name + Status + actions; **Email and Joined
are simply gone**, with no indication they exist and no way to reach them. That
is data loss, not responsive design.

Absent from every table: sorting, pagination, column config, row selection, bulk
actions, sticky header, and a real loading state. Search, where present, is
client-side `.filter()` over the already-fetched page.

### 4.4 Empty states

27 distinct empty-state strings, each rendered as a single line of
`text-slate-500 text-sm`. No icon, no explanation, no action — with three
exceptions on the teacher dashboard that include an inline link. Wording drifts
freely: "No lessons yet." / "No lessons yet" / "No lessons available yet." /
"No lessons assigned yet." — four phrasings of one state.

An empty state is the **first thing every new tenant sees on every screen.** It
is currently the least-designed element in the product.

### 4.5 Loading states

Four `loading.tsx` files (admin, student, teacher, super-admin) that are
**byte-identical**: a 48px bar, a 3-column grid of 112px blocks, a 256px block,
a 192px block. None matches the page it precedes — every dashboard is a
**4**-column stat grid and the skeleton shows 3. `(center)` has no `loading.tsx`
at all.

There is no `Skeleton` primitive; the shapes are inline `bg-slate-800 rounded`
divs. Client-side loading is 44 separate `setLoading(true/false)` pairs, mostly
rendering a spinner or nothing.

### 4.6 Error states

`ErrorFallback` is shared across every boundary — good. But it is the only place
in the product using **glassmorphism** (`bg-white/5 backdrop-blur-xl
border-white/10`), a treatment that appears nowhere else. It also renders the
error mark as a literal `"!"` text character in a rounded square, while
`lucide-react` is already a dependency.

---

## 5. Public / marketing surfaces

`landing.tsx`, `features-page.tsx`, `contact-page.tsx`, `policy.tsx` +
`shell.tsx`.

- **The marketing site and the product are two visually different products.**
  The landing page uses gradient text (`bg-gradient-to-b from-white via-white
  to-slate-400 bg-clip-text text-transparent`), a radial glow
  (`radial-gradient(ellipse_at_top, rgba(37,99,235,0.18)…)`), a blur halo
  (`-inset-4 bg-blue-600/10 blur-2xl`), `shadow-lg shadow-blue-600/25`,
  `text-6xl font-extrabold`, and `rounded-3xl`. **None of these appear anywhere
  inside the app.** 20 gradients exist in the codebase; 13 are on public/auth
  pages.
- The hero contains a **fake dashboard mockup with fabricated chart bars**
  (`CHART_BARS = [45, 70, 55, 90, 65, 100, 80]`) — the product is sold with an
  illustration of a dashboard that does not exist in the product.
- **The public site is fully bilingual (ar/en, persisted toggle); the product is
  not.** A visitor reads polished Arabic, signs in, and lands in an English-only
  UI. This is the sharpest credibility break in the whole experience.
- Auth pages (`login`, `forgot-password`, `reset-password`, `join/[token]`)
  follow the marketing treatment (gradients, glass) rather than the product
  treatment, so the visual language changes twice between landing and dashboard.

---

## 6. Internationalisation & direction

A structural finding, not a polish item.

- `<html lang="en">` is fixed in the root layout, with no `dir` attribute.
- **20 files hard-code `dir="rtl"` on a wrapper div**, including entire pages:
  the whole Centre Manager dashboard, `/student/schedule`, `/teacher/schedule`,
  `/admin/announcements`, `/admin/schedules`, `/super-admin/permissions`, plus
  shared components (`notification-bell`, `lesson-tabs`, `ai-progress`,
  `permissions-editor`, `requests-inbox`, `schedules-manager`).
- **The Centre Manager surface is 100% Arabic**; Admin, Teacher, Student and
  Super Admin are English; and some shared components rendered on *English*
  pages are RTL (`notification-bell`, `ai-progress`).
- Directional utilities are physical, not logical, essentially everywhere:
  `left-3`, `right-4`, `pl-10`, `ml-auto`, `text-left`,
  `slide-in-from-bottom`. The single place that used a logical property
  (`end-1.5` on the landing page) proves it wasn't a policy. **Every RTL surface
  is therefore laid out LTR** — the search icon on an RTL page still sits left,
  the toast still slides in bottom-right, the sidebar is still on the left.
- `formatDate` hard-codes `'en-US'`, so an Arabic page renders `Sep 7, 2026`.
- `confirmDialog` defaults to Arabic labels for every caller, English or not.

There is no i18n library, no dictionary, and no locale state inside the app
(only the public pages have `useLang`). Roughly a quarter of the product's
strings are Arabic literals scattered inline in JSX.

---

## 7. Accessibility

Measured, not estimated.

### 7.1 Color contrast — failing

| Utility | Uses | On `slate-900` | On `slate-950` | WCAG AA (4.5:1) |
|---|---|---|---|---|
| `text-slate-400` | 343 | 6.96:1 | 7.86:1 | pass |
| `text-slate-500` | 218 | **3.75:1** | **4.24:1** | **fail** |
| `text-slate-600` | 57 | **2.36:1** | **2.66:1** | **fail (badly)** |
| `placeholder-slate-500` | 29 | **3.75:1** | — | **fail** |

`text-slate-500` is the product's standard **metadata** color — dates, group
names, counts, and **27 of 27 empty-state messages**. `text-slate-600` is used
for de-emphasised icons. Together: **304 declarations of failing body text.**

### 7.2 Everything else

- **`aria-*` attributes in the entire 131-file codebase: 14.** (10 `aria-label`,
  3 `aria-hidden`, 1 `aria-selected`.) `role=`: 5 total.
- **19 icon-only buttons carry no accessible name** — the delete, edit, toggle,
  copy and close controls in tables and modals are unlabelled to a screen
  reader.
- **`focus-visible:` is used 0 times**; `focus:` 231 times. Focus rings show on
  mouse click as well as keyboard, which historically leads teams to remove
  them — and `focus:outline-none` already appears on every input.
- `Modal` has no focus trap, no focus restore, no `aria-modal`.
- `Input`'s label is not associated with its control (no `id`/`htmlFor`).
- `Toaster` has no `aria-live` region — toasts are silent to assistive tech.
- Skeletons have no `aria-busy`; the pulsing "Operational" dot is decorative
  motion with no `prefers-reduced-motion` guard (there is none anywhere).
- Heading order starts at `<h2>` on every page (the `<h1>` is the fixed header
  title), then jumps to `<h3>` for panels — no page has a correct outline.

---

## 8. Interaction & feedback

The framing *"the interface lacks interaction"* is accurate, and the cause is
not missing animation. It is **missing system response**.

- **No optimistic UI.** Every mutation is `fetch()` → `if (res.ok)` → local
  `setState` → `router.refresh()`. The whole route re-renders on every toggle.
- **Failure is frequently silent.** `students-client.tsx` `toggleStatus` and
  `deleteStudent` both check `if (res.ok)` and have **no `else`** — a failed
  request produces no toast, no error, no visual change at all. The row simply
  doesn't update. The pattern repeats across the admin clients.
- **Destructive actions are undifferentiated.** `confirmDialog('Remove this
  student?')` is one line of text. There is a full soft-delete/archive system
  behind it (nothing is destroyed; the admin can restore) and the UI never says
  so — so the safest delete in the product feels like the scariest.
- **No cross-surface consequence.** Completing a lesson updates no progress
  indicator, logs to no activity feed, and advances no "next lesson"
  affordance — because none of those exist.
- **Hover is the only interaction state consistently implemented**
  (`transition-colors`, 144). Active/pressed, selected, disabled-with-reason,
  loading-in-place and drag states are essentially absent.
- **Search does not indicate it is local.** Client-side `.filter()` over an
  already-loaded array reads as full search and silently misses everything not
  on the page.

---

## 9. Responsive

- Breakpoint usage is thin and top-heavy: `sm:` 99, `lg:` 59, `md:` 39,
  `xl:` 13. Layouts jump 1 → 2 → 4 columns with nothing considered between.
- **Tables lose data on mobile** (§4.3) — the most severe responsive defect.
- The sidebar drawer is correct (backdrop, closes on route change), but the
  collapsed desktop rail is unlabelled (§2.1).
- `!pt-20` in all five layouts is a fixed compensation for a fixed 64px header;
  any header height change breaks all five.
- The student `QuickAccessPanel` is a fixed floating panel with no awareness of
  the mobile drawer — two overlay systems, neither knowing about the other.
- Landing-page nav at the smallest widths compresses to `gap-0.5 px-1.5`, taking
  tap targets below the 44px minimum.

---

## 10. Consistency table (same role, different treatment)

| Element | Variants found in the product |
|---|---|
| Card background | `bg-slate-900` · `bg-gradient-to-b from-slate-900 to-slate-900/50` · `bg-white/5 backdrop-blur-xl` |
| Card radius | `rounded-xl` (dashboards) · `rounded-2xl` (modals, errors) · `rounded-lg` (small panels) |
| Card padding | `p-5` · `p-6` · `p-8` |
| Form field | `bg-slate-800 border-slate-700` (`ui/input`) · `bg-slate-900 border-slate-800` (inline searches) |
| Page title | `Header title` prop **and** a local `<h2>` — both, on all 46 pages |
| Primary button | `Button variant="primary"` · raw `bg-blue-600 …` (landing, auth, error) |
| Avatar | `rounded-full bg-blue-600` (header) · `bg-emerald-600` (students table) · `bg-blue-600 rounded-lg` (sidebar mark) |
| Empty state | 27 strings, 4 phrasings for "no lessons" |
| Dialog | `Modal` · `confirmDialog` · 4 raw `fixed inset-0` overlays |
| Direction | `dir="rtl"` on 20 files inside `<html lang="en">` with no `dir` |

---

## 11. What is already good (do not discard in Phase 3)

An audit that lists only faults produces a rewrite. These work and should
survive:

1. **`cn()` + `clsx` + `tailwind-merge`** is set up correctly — the override
   mechanism a token system needs already exists.
2. **The toast emitter pattern** (no provider, global listeners, capped queue)
   is genuinely good architecture; it needs `aria-live` and RTL, not a rewrite.
3. **`confirmDialog`'s promise-based portal-per-call API** is the right shape;
   only its chrome and its hard-coded language are wrong.
4. **One icon library, no illustration dependency, zero images** — the product
   is entirely CSS-rendered. That is a real asset for a design system.
5. **`ErrorFallback` is shared** across every boundary and surfaces the Sentry
   digest to the user. Correct behaviour, wrong skin.
6. **The teacher dashboard's linked stat cards** (`href` per card) — the one
   place a metric is a doorway rather than an ornament.
7. **Clean server/client split**: pages are RSC, `*-client.tsx` holds
   interaction. Phase 3 can replace presentation without touching data access.
8. **The Centre Manager capability chips** — the only widget in the product that
   explains the user's own position in the system.

---

## 12. Findings ranked by impact

| # | Finding | § | Severity |
|---|---|---|---|
| 1 | No design system: starter `globals.css`, zero tokens, 110 ad-hoc color utilities | 1 | critical |
| 2 | Product renders in **Arial**; the loaded Geist webfont is unused (broken CSS var) | 1.1 | critical |
| 3 | Five roles share one dashboard template with an identical 4-card color order | 3 | critical |
| 4 | No notion of "now": no continue, no attention queue, no progress, no urgency | 3, 8 | critical |
| 5 | `text-slate-500`/`600` fail WCAG AA — 304 declarations of unreadable metadata | 7.1 | critical |
| 6 | 10 of 11 tables drop columns on mobile instead of scrolling (data loss) | 4.3 | high |
| 7 | Bilingual marketing site → English-only product; 20 files hard-code RTL in an LTR shell | 5, 6 | high |
| 8 | Primitives bypassed 43–100%; no Select/Textarea/Table/Card/Progress/Skeleton | 4.1 | high |
| 9 | Fabricated data shown as real: `'12'`, `'0'`, permanent "Operational" | 3 | high |
| 10 | 14 aria attributes total; 19 unlabelled icon buttons; no focus trap; no `aria-live` | 7.2 | high |
| 11 | Silent failure: mutations with `if (res.ok)` and no `else` | 8 | high |
| 12 | Two page titles on every screen; fixed header carries no wayfinding; no breadcrumbs | 2.2 | medium |
| 13 | Flat 14-item sidebar, no grouping; duplicate icons; unlabelled collapsed rail | 2.1 | medium |
| 14 | 84% of type is `text-sm`/`text-xs`; no named hierarchy | 1.3 | medium |
| 15 | Empty states are one grey line, 4 phrasings for one state | 4.4 | medium |
| 16 | Skeletons don't match their pages; `(center)` has none | 4.5 | medium |
| 17 | Marketing/auth visual language (gradients, glass, glow) unrelated to the product's | 5 | medium |
| 18 | Semantic and categorical color share one palette, so neither reads | 1.2 | medium |
| 19 | `transition-all duration-300` animating `padding-left` on every layout | 1.6, 2.3 | low |
| 20 | Sidebar owns sign-out + Supabase client; 16-icon hard-coded allowlist | 2.1, 4.2 | low |

---

## 13. What Phase 2 must answer

Carried forward as open questions, deliberately unanswered here:

1. **One dashboard or five?** Findings 3 and 4 cannot both be resolved by a
   shared template. Does each role get a purpose-built surface?
2. **Language.** Is EduQuest Arabic-first, English-first, or genuinely
   bilingual — and does the product get the toggle the marketing site already
   has? Everything in §6 depends on this single answer.
3. **Dark-only, light-only, or both?** The code is dark-only with a dead
   light/dark block. University procurement contexts are overwhelmingly light.
4. **Does the marketing surface converge on the product, or stay distinct?**
5. **What is the primary color, and what does it mean?** Blue currently means
   brand *and* action *and* "lessons" simultaneously.
6. **What visual device carries the Manara / Beacon idea** — guidance, progress,
   pathway — as a reusable element rather than a logo?
7. **How much of §7 is in scope?** Contrast and accessible names are cheap; full
   keyboard/AT support is its own workstream.

---

*End of Phase 1. No code has been modified. Next: `DESIGN_DIRECTION.md`.*

---

# Addendum — re-audit 2026-09-09

Phase 1 above was written on 2026-09-07 against commit `be209dd` and describes the
pre-token state. The token system, the role-differentiated surfaces and the light
theme have since landed. This addendum records what the same measurements say
today, so the numbers above are read as history rather than current state.

## What the earlier findings look like now

**Finding 1, "there is no design system": resolved.** `globals.css` is no longer
the starter file. It declares a full token set for surfaces, borders, foreground,
accent and the four semantic states, with a light default, a
`prefers-color-scheme` dark block and an explicit `data-theme` override, plus a
static block for radius, type scale, elevation and motion.

**Finding 2, "the five dashboards are one template": resolved.** Each route group
has its own layout, sidebar navigation and dashboard composition.

**Finding 3, "no notion of now": largely resolved, with one gap that this pass
closed.** The student surfaces carry a quick-access panel, announcement banners
and per-course progress. The gap was that "continue" had nowhere to go: the
course card's primary button pointed at a route that did not exist. That is
covered in `PRODUCT_COMPLETENESS_AUDIT.md`.

**The `text-slate-500` contrast failure: resolved.** That utility no longer
appears anywhere in the application shell.

**The bilingual finding: still open, and still the largest piece of design debt.**
Components continue to hardcode `dir="rtl"` on their own containers inside an
`<html lang="en">` document. Question 2 in the open list above has not been
answered, and everything in §6 still depends on it.

## Current measurement

Raw Tailwind palette utilities, meaning colours written as literal scale values
rather than tokens, counted across `src/app`, `src/components` and `src/lib`,
excluding the deliberately art-directed marketing pages under
`src/components/public`:

| Date | Raw palette utilities in the application shell |
|---|---|
| 2026-09-07 (Phase 1) | 370 |
| 2026-09-09 (this addendum) | 48 |

The 48 remaining are overlay scrims, the printed report surface and switch knobs.
Each is justified individually in `DESIGN_OVERHAUL_REPORT.md`.

## Newly found and fixed on this pass

The single most damaging visual defect in the product was not in the earlier
audit, because it only appears in light mode and the app was dark-only when
Phase 1 was written. The authentication pages paint a hardcoded dark gradient
and then set their text with theme tokens. Once the light theme shipped, that
combination put deep navy text on a near-black background across sign-in,
password reset and invitation acceptance. Details and the fix are in
`DESIGN_OVERHAUL_REPORT.md`.

*End of addendum.*
