# DESIGN_DIRECTION.md — EduQuest Visual Direction

**Phase 2 of 4.** Decisions only — no code, no component markup. Built on the
findings in [`DESIGN_AUDIT.md`](DESIGN_AUDIT.md). Phase 3 turns this into
tokens and shared components; Phase 4 applies it per surface.

---

## 0. References considered, and why they were rejected as literal models

Two references were supplied. Neither is adopted as a visual model — both are
useful as *counter-examples* that sharpen this direction.

**sanadedu.net** (Arabic ed-tech competitor). On inspection: full-bleed purple
gradient background, a floating laptop mockup, green-checkmark feature badges,
color-coded KPI stat tiles, a "Smart Assistant" section built entirely from
AI-sparkle visual language. This is the *generic AI-SaaS template* aesthetic —
the exact thing this direction exists to move away from. It is not used as a
model. It is useful as a negative example: it shows what "we compete on
features, not on craft" looks like, and EduQuest should read as the opposite of
it at a glance.

**The cinematic AI-infrastructure hero brief** (dark full-bleed video, "S/bolt"
mark, "The Next Layer of Intelligence"). Its *subject matter* — a black-void AI
startup — is wrong for a multi-tenant university platform and is not adopted.
Its *mechanics* are worth keeping and are carried into this direction as
methodology, not aesthetics:

- a locked, arithmetic unit system driving every position and size, instead of
  ad-hoc utility values chosen per component;
- a genuinely restrained color set (four or five named roles, not 110 literal
  utilities);
- one deliberate composition per screen, not a stack of interchangeable cards;
- a real type scale with named steps, not two sizes (`text-sm`/`text-xs`) doing
  every job;
- choreographed, purposeful entrance motion instead of `transition-colors`
  everywhere and nothing else.

Those five mechanics are the actual, reusable lesson from both references. The
rest of this document applies them to what EduQuest is — an institutional
system of record — not to what either reference is selling.

---

## 1. Brand personality

**EduQuest is infrastructure a university's IT department trusts, not a
product a startup is pitching.** The three words that should describe every
screen, in order: **precise, calm, legible.** Not: friendly, exciting, modern
(modern is a byproduct of precision, never a goal in itself).

Concretely, this means:

- Decisions are visible as **structure**, not decoration. Hierarchy comes from
  a type scale and a grid, not from color, glow, or animation.
- The product **never over-promises**. No fabricated numbers, no permanently
  "Operational" status with nothing behind it, no AI-sparkle iconography
  standing in for an actual feature. (Audit §3, §9 — this is a correctness
  requirement carried into design, not just an aesthetic one.)
- Every screen answers **"where am I, what changed, what do I do next"**
  before it answers "how much is there." Counts are the least important number
  on any dashboard (Audit §3).
- The five roles are **five different jobs**, and should look like five
  different, purpose-built tools that happen to share a chassis — not one
  dashboard re-skinned five times with different words.

### What we explicitly stop doing (per the brief, confirmed by the audit)

Purple/blue AI gradients · glow / blur halos · glassmorphism · rounded pill
badges as decoration · gradient text · oversized hero type inside the product
· AI-sparkle iconography as a recurring UI motif · cards nested in cards ·
uniform shadow-on-everything · animation with no state change behind it ·
dashboards that are only stat-card grids · generic "AI-powered ✨" labels ·
Sparkles icon as the default AI marker.

Every item on this list is independently confirmed present in the current
codebase (Audit §1.5, §1.6, §3, §5) — this is not a hypothetical risk list, it
is a removal list.

---

## 2. Visual principles

1. **Structure before color.** Hierarchy is established by size, weight,
   spacing and position first. Color is applied last, and only for meaning
   (status, category) — never for emphasis alone.
2. **One accent, everywhere the same meaning.** A single primary color carries
   "primary action" and only that. It does not also mean "this is a lesson"
   (Audit §1.2). Category color, where it exists at all, is a separate,
   smaller palette used only in data visualization contexts (charts, tags),
   never on interactive controls.
3. **Every empty and loading state is designed, not defaulted.** A grey line
   of text is not an empty state (Audit §4.4); a mismatched generic skeleton is
   not a loading state (Audit §4.5). If a state can be reached, it gets a
   deliberate version.
4. **Density serves the role, not the theme.** A super-admin fleet view is
   allowed to be dense (tables, small type, many rows). A student dashboard is
   not — it gets one primary focal action and air around it. The current
   product applies identical density to both (Audit §3); that stops.
5. **Real data or no data — never fabricated data.** A metric with nothing
   behind it does not ship (Audit §3, finding 9). If a feed doesn't exist yet,
   the UI says so, rather than showing a static number.
6. **Motion communicates a state change, never decorates.** An element appears
   because something happened (loaded, arrived, changed) — motion is the proof
   of that event, timed to be felt, not admired.
7. **RTL and LTR are both first-class**, not one primary layout with a
   sometime-`dir="rtl"` patch (Audit §6). Every spatial decision in Phase 3 is
   made in logical properties from the start.
8. **Accessibility is load-bearing, not a pass at the end.** Contrast ratios,
   focus states and accessible names are constraints the token system enforces
   structurally (Phase 3), not a checklist run after the fact (Audit §7).

---

## 3. Typography system

A seven-step named scale replaces the current two-value (`text-sm`/`text-xs`)
default. Every step has one job; components reference the step name, never a
raw size.

| Step | Role | Approx. size | Weight | Where |
|---|---|---|---|---|
| **Display** | Marketing hero only | 40–56px | 600 | Landing page hero, nothing inside the product |
| **H1** | Page title | 28px | 600 | One per page — replaces the duplicated Header-title + local-`<h2>` pattern (Audit §2.2) |
| **H2** | Section heading | 20px | 600 | Panel/card headers |
| **H3** | Subsection / list-group heading | 16px | 600 | Grouped list headers, table section headers |
| **Body** | Default reading text | 15px | 400 | Table cells, descriptions, form values |
| **Label** | Form labels, nav items, buttons | 14px | 500 | Interactive text |
| **Metadata** | Timestamps, counts, helper text | 13px | 400 | Must clear WCAG AA against its background — the audit's `text-slate-500`/`600` failures (§7.1) are a Metadata-step problem specifically, and Phase 3's token must fix it at the source, not per-component |

**H1 replaces the current dual-title pattern outright**: the fixed header stops
showing a static per-role string ("Teacher Panel") and instead shows the
current page's real H1, so the persistent bar finally carries wayfinding
information (Audit §2.2).

**One typeface, actually loaded.** Geist, loaded correctly (Phase 3 fixes the
broken CSS variable chain that currently silently falls back to Arial — Audit
§1.1). No second display face; the "IpsumMark"-style custom wordmark treatment
from the reference brief is exactly the kind of one-off flourish this system
exists to prevent.

---

## 4. Color system

### 4.1 Structure: neutral ramp + one ink + one signal color, not five

Replace 110 ad-hoc utilities with a **closed, named set**:

- **Neutral ramp** (8–10 steps): page background → surface → surface-raised →
  border-subtle → border → text-muted → text-secondary → text-primary. This
  single ramp does the job `slate` currently does, but every step is named by
  *role* (`surface`, `border`), not by *shade number* — so "what background
  does a card sit on" is one token, not a choice made fresh in every file.
- **Ink**: near-black / near-white pair (theme-dependent), used for primary
  text and the highest-contrast elements only.
- **One primary accent**: a single deliberate color standing in for "brand +
  primary action" and nothing else. It is not simultaneously "lessons" or
  "exams" (Audit §1.2). Candidate direction: a deep, restrained blue closer to
  ink than to the current bright `blue-600` — precise rather than energetic.
  Final hex is a Phase 3 decision made against real contrast math, not chosen
  here.
- **Semantic set** (success / warning / danger / info): exactly four colors,
  used only for status, never for category. This absorbs today's
  success-means-emerald-means-"students" overload (Audit §1.2, §4.2).
- **Categorical set** (optional, small): 4–6 colors reserved strictly for data
  visualization and tag/label contexts (a lesson-type chip, a chart series) —
  never applied to a button, a link, or a status.

Semantic and categorical are **visually distinct families** (e.g., semantic
stays saturated, categorical stays muted/desaturated) so a user can tell "this
is a status" from "this is a category" without reading the label.

Everything currently drawn from `purple`, `green`, `sky`, `pink`, `indigo`,
`cyan` (37 stray uses, Audit §1.2) is retired — it maps onto one of the sets
above or it doesn't ship.

### 4.2 Theme

The app is **dark-only today with a dead light-mode block** (Audit §1.1).
Direction: **ship both, dark as default for the working product, light
available and correct** — because the procurement-facing surfaces (landing,
and likely the university-admin console in an office context) are read in
daylight far more often than the "AI infrastructure" reference assumes. This is
flagged as an open question back to the owner in §8 below, but the token
architecture in Phase 3 should support both regardless of which ships first,
since retrofitting a light theme onto slate-hardcoded components later is far
more expensive than defining both ramps now.

---

## 5. Spacing, radius, elevation

### 5.1 Spacing

One 4px-based scale (4/8/12/16/24/32/48/64), referenced by role
(`space-xs`…`space-2xl`), not by raw Tailwind numbers chosen per component.
Card padding becomes **one** value system-wide, not `p-5`/`p-6`/`p-8` depending
on which file wrote it (Audit §1.4).

### 5.2 Radius

Three values only: `radius-sm` (inputs, badges, small controls),
`radius-md` (cards, buttons), `radius-lg` (modals, sheets). This replaces nine
inconsistent values including three (`rounded`, `rounded-md`, `rounded-3xl`)
that should not exist at all (Audit §1.4).

### 5.3 Elevation

A real two-or-three-step shadow scale (`elevation-1` hover/raised,
`elevation-2` popover/dropdown, `elevation-3` modal), tuned for the dark
surface first since that's the harder case. Everything below a modal
continues to rely primarily on the border + surface-step relationship already
working in the current UI (Audit §11.1) — elevation is not the primary depth
cue, it is reserved for genuinely floating layers.

---

## 6. Iconography

Stay on `lucide-react` (Audit §11.4 — this is a real asset, not a liability).
Two structural fixes:

- **The sidebar's hard-coded icon allowlist is removed** — any icon in the
  library becomes usable per nav item, ending the duplicate-icon problem
  (`BookOpen` used for both Courses and Lessons; `ShieldCheck` used twice in
  super-admin — Audit §2.1).
- **Icon size is derived from the adjacent type step**, not chosen per
  instance — an icon next to a Label is always the same size as every other
  icon next to a Label.

`Sparkles` is retired as the default "AI" marker (Audit §1.5). Where an
AI-generation entry point needs a glyph, it earns a single, deliberate,
consistently-used icon — not the generic sparkle repeated 28 times across 8
files as a stand-in for "trust us, it's smart."

---

## 7. Component philosophy

(Full inventory and API design is Phase 3. This section sets the rules Phase 3
builds against.)

1. **A primitive exists for every raw HTML element currently hand-styled.**
   Select, Textarea, Table, Card, Tabs, Checkbox, Radio, Switch, Tooltip,
   Avatar, EmptyState, Skeleton, Alert, Pagination, Breadcrumb are net-new — not
   because more components is a goal, but because their absence is *why* 100%
   of selects, 100% of textareas and 100% of tables in the current app are
   independently hand-styled (Audit §4.1, §4.3).
2. **No component may hard-code the page background it expects to sit on.**
   The current `Button`'s `focus:ring-offset-slate-950` is the specific
   failure mode this rules out (Audit §4.2) — it is also what makes a future
   light theme impossible without touching every component.
3. **Every interactive primitive ships with focus, hover, active, disabled,
   and loading states designed together**, not hover-only with the rest
   defaulted (Audit §8).
4. **Every form primitive wires its own accessible name.** Label-to-control
   association, `aria-invalid`, `aria-describedby` for error text — built into
   the primitive once, not re-solved per form (Audit §4.2, §7.2).
5. **One dialog primitive, no exceptions.** `confirmDialog` keeps its
   promise-based call API (it's good) but is rebuilt on top of the same Modal
   primitive everything else uses, with focus trap, focus restore, and
   locale-aware button labels instead of hard-coded Arabic defaults (Audit
   §4.2). The four remaining raw `fixed inset-0` overlays in the app are
   migrated onto it.
6. **Tables scroll horizontally on narrow viewports; they do not silently drop
   columns.** Column-hiding-by-breakpoint (used in 10 of 11 current tables) is
   replaced by a horizontal-scroll container with a persistent first column,
   so no data present on desktop becomes unreachable on mobile (Audit §4.3,
   §9).
7. **Empty states are a primitive with three parts**: icon, one-line
   explanation, and — where an action exists — the action itself. This
   replaces 27 ad-hoc grey-text strings with four current phrasings of the
   same state (Audit §4.4).
8. **Skeletons are built per surface shape, generated from the real layout**,
   not one generic 3-block skeleton reused under a 4-column page (Audit §4.5).

---

## 8. Dashboard philosophy

This is the direction's most consequential call, because it reverses the
audit's single largest finding: **the five dashboards stop sharing a
template.** Each role gets a purpose-built primary surface answering that
role's actual first question, not a 4-stat-grid answering "how many."

| Role | The real first question | What the dashboard leads with |
|---|---|---|
| **Student** | "What do I do right now?" | One primary **Continue** module (the lesson/exam actually in progress, with real progress — Audit §3 notes `get_course_progress` exists and is unused on this screen) above a secondary "this week" strip (due dates, not counts). Counts move to a supporting position, not the top. |
| **Teacher** | "What needs me today?" | A **work queue** first: ungraded submissions, flagged proctoring events, open student requests — the things the current dashboard has zero of (Audit §3). Lifetime totals ("Lessons Created: 47") move down or off the dashboard entirely; they belong on the Lessons list, not the front page. |
| **University Admin** | "Is anything wrong, and what changed?" | Institution health at a glance plus a **real** activity feed — not lessons relabelled as events (Audit §3's explicit callout). If a genuine audit-log feed doesn't exist yet, the dashboard says "activity log coming soon," not a fake substitute. |
| **Centre Manager** | "What am I actually allowed to do, and is it done?" | The capability list — already the best-designed element in the current product (Audit §11) — is promoted from an afterthought at the bottom to the dashboard's organizing structure, since this role's job *is* defined by that list. |
| **Super Admin** | "Is the fleet healthy?" | A tenant-health view with real status, not a permanently-green four-row list with nothing behind it (Audit §3, finding 9). If service health isn't wired to a real check yet, this section does not ship claiming "Operational." |

No dashboard drops metrics entirely — counts remain available — but none of
them lead with a 4-card grid of same-order, same-color tiles as the *first*
thing the role sees. The audit's finding that "a teacher's working day and a
platform owner's fleet view are rendered by the same 40 lines of JSX" is the
specific problem this table exists to end.

---

## 9. Motion philosophy

- **Entrance motion is purposeful and once**: a panel that loads gets one
  deliberate fade/rise on arrival, not a decorative loop.
- **State-change motion is mandatory, not optional**, for anything the current
  audit found silent (Audit §8): a toggle succeeding, a row being removed, a
  save completing all get a visible transition tied to the actual event —
  replacing today's pattern where `setState` on success and *nothing at all*
  on failure look identical to the user.
- **`transition-all` is banned**; every transition names the specific
  property it animates, and layout-affecting properties (`padding`, `width`)
  are never animated on a container that reflows the whole page on toggle
  (Audit §1.6, §2.3 — the sidebar/shell resize is the concrete case to fix).
- **`prefers-reduced-motion` is respected everywhere**, including the
  currently-unguarded decorative pulse (Audit §7.2).

---

## 10. Language & direction

This document does not resolve the open question — that's explicitly deferred
to the owner (§11, below) — but it sets the non-negotiable engineering
constraint regardless of the answer: **Phase 3's component layer is built with
CSS logical properties from day one** (`padding-inline-start` not `pl-`,
`text-start` not `text-left`, `inset-inline-end` not `right-`), so that
whichever language strategy is chosen, RTL is a property of the token system,
not a per-file patch applied to 20 components after the fact (Audit §6). This
also fixes the specific defect where an RTL page today keeps LTR-positioned
icons and toasts (Audit §6) — logical properties make that class of bug
structurally impossible rather than something to remember to test for.

---

## 11. Open questions carried to the owner (from Audit §13, now sharpened)

Phase 3 cannot start on these specific points until answered:

1. **Language strategy.** Arabic-first, English-first, or a real bilingual
   toggle inside the product (matching what the marketing site already has)?
   This determines whether Phase 4 ships one language per surface or a locale
   switcher, and it is the single highest-leverage unanswered question in the
   whole plan.
2. **Theme default.** Ship dark-only first (fastest, matches today) or both
   themes at launch (right for a procurement-facing admin console, per §4.2)?
3. **Primary accent color — final hex.** This document sets the *role* (one
   accent, brand + action only); the exact color is a Phase 3 decision that
   needs to be checked against real contrast ratios in both themes before it's
   locked.
4. **Does the Manara/Beacon concept become a literal recurring visual device**
   (a progress/wayfinding motif reused across surfaces — a path indicator, a
   directional marker in navigation) **or stay a naming/brand idea only?** If
   the former, Phase 3 needs one concrete execution of it to test before it's
   applied system-wide.
5. **Marketing-to-product convergence.** Does the landing page's visual
   language pull toward the (calmer) product direction in this document, or
   does the product's dashboard chrome stay deliberately more restrained than
   marketing, the way most enterprise software does? Recommendation: the
   latter — marketing is allowed more visual ambition than a daily-use
   console — but this is the owner's call.
6. **Accessibility scope for this pass.** Contrast fixes and accessible names
   (cheap, high-value, directly caused by current token choices) are assumed
   in-scope for Phase 3 by default. Full keyboard/screen-reader workflow
   testing is a separate workstream this document does not claim to cover
   unless the owner says otherwise.

---

*End of Phase 2. No component code has been written. Next: Phase 3 —
`DESIGN_SYSTEM.md` and the rebuilt shared component library, gated on answers
to §11 where the answer changes the API (language and theme, specifically).*
