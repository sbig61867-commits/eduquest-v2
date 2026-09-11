# DESIGN_SYSTEM.md — EduQuest Visual Grammar

**Phase 3 of 4.** Decisions and specification only — **no component code**.
Built on [`DESIGN_AUDIT.md`](DESIGN_AUDIT.md) (what exists) and
[`DESIGN_DIRECTION.md`](DESIGN_DIRECTION.md) (where we're going). This
document is itself sequenced as a grammar — each section only uses vocabulary
defined above it — because a components list written before this exists is
exactly how the current product ended up as 110 uncoordinated color literals
over a template.

Three decisions came back from the owner and are locked for everything below:

1. **True bilingual, Arabic + English, both RTL and LTR as first-class.**
   Direction is set once at the application root; every component is written
   in logical properties from its first line. `dir="rtl"` never appears inside
   an individual component again.
2. **Light-first, dark-ready.** The system is designed and shipped light. Dark
   is a second, complete value-set on the same tokens — not an afterthought,
   but not the design target either. Every token gets both values now, so nothing
   is retrofitted later.
3. **Neutral foundation + one accent, semantic colors kept structurally
   separate from category/decorative color.** No "four cards, four colors"
   reflex anywhere in the system.

Plus one process constraint, also from the owner, that shapes this whole
document: **grammar before components.** The order below —
Foundation → Tokens → Typography → Layout → Navigation → Interaction Patterns
→ Components → Role Compositions — is the actual build order for Phase 3B/4,
not just an outline. Nothing in "Components" may introduce a value that
doesn't already exist in "Tokens."

---

## 1. Foundation

### 1.1 What "foundation" means here

Before any token has a value, four things are decided, because every token
downstream depends on them:

**Base unit.** All spacing, sizing and (where sensible) radius are multiples of
**4px**. No spacing value in the system is ever a non-multiple of 4. This is
the practical alternative the owner asked for in place of a viewport-relative
unit system — fixed, predictable, and every developer already knows what `16`
means.

**Direction model.** The application sets `dir` once, at `<html>`, computed
from the active locale (`ar` → `rtl`, `en` → `ltr`). Nothing below the root
ever sets `dir` again. Every token and every component is authored so that
flipping the root's `dir` is sufficient — no component-level RTL branches, no
`dir="rtl"` wrappers, no `if (lang === 'ar')` conditional class strings for
layout. This is not a convention teams are asked to follow; §1.4 makes the
alternative structurally unavailable.

**Color model.** Two complete value sets — Light and Dark — bound to the same
token *names*. A component reads `surface.primary`; the value it resolves to
depends only on the active theme, never on the component's own logic. Light is
the default and the design target; Dark is complete and correct from day one,
not a `filter: invert()` afterthought.

**Density model.** One 4px unit serves both a dense super-admin table and an
airy student focal card — density is achieved by *which* spacing step a
composition uses, not by a separate scale. This keeps the system to one
spacing scale instead of two competing ones.

### 1.2 Logical properties — the actual RTL/LTR mechanism

This is a foundation-level rule, not a components-level detail, because it
determines how every later section is written.

| Physical (never used again) | Logical (used everywhere) |
|---|---|
| `margin-left` / `margin-right` | `margin-inline-start` / `margin-inline-end` |
| `padding-left` / `padding-right` | `padding-inline-start` / `padding-inline-end` |
| `left` / `right` (positioning) | `inset-inline-start` / `inset-inline-end` |
| `text-align: left/right` | `text-align: start/end` |
| `border-left` / `border-right` | `border-inline-start` / `border-inline-end` |
| `flex-direction: row` assumed left-to-right | `flex-direction: row` (browser already flips this under `dir`) with no manual reversal |
| directional slide-in animation (`slide-in-from-left`) | `slide-in-from-inline-start` (a token-level animation name, resolved per direction) |

Icons are the one category logical properties don't solve automatically: a
"back" chevron must visually point toward the start edge in both directions.
The icon token layer (§2.6) carries a `mirror: true` flag on the small set of
genuinely directional icons (back/forward chevrons, indent controls) that the
icon-rendering primitive flips under `dir="rtl"`; everything else (a bell, a
book, a calendar) is direction-agnostic and is never flipped.

**Numerals, dates, and text.** Arabic UI text runs RTL; numerals inside it
(prices, counts, IDs) stay LTR per standard Arabic typographic convention —
this is a rendering rule the type layer honors (`unicode-bidi: plaintext` on
numeric spans), not a per-page decision.

### 1.3 Breakpoints

Five steps, named by role rather than device, since "tablet" and "small
laptop" increasingly overlap:

| Token | Width | Role |
|---|---|---|
| `bp.xs` | 0 | Phone, portrait |
| `bp.sm` | 640px | Phone, landscape / small tablet |
| `bp.md` | 768px | Tablet |
| `bp.lg` | 1024px | Small laptop — sidebar becomes persistent |
| `bp.xl` | 1280px | Desktop — full data density available |

Mobile-first: every rule is written for `bp.xs` and progressively enhanced.
This matches the current codebase's convention (Audit §9) and is kept.

### 1.4 Container widths

| Token | Max width | Use |
|---|---|---|
| `container.content` | 1120px | Standard app content column (dashboards, forms, detail views) |
| `container.wide` | 1440px | Data-dense surfaces (super-admin tables, reports) |
| `container.narrow` | 640px | Single-column forms, auth screens, empty focal states |
| `container.marketing` | 1280px | Public/landing pages only |

No page picks an ad-hoc max-width; every page's outermost content wrapper
uses one of these four.

---

## 2. Tokens

Every value used anywhere in the product traces back to a token defined here.
A component may not introduce a new spacing, color, radius, shadow, or
duration value locally — if a design needs one, it's added here first, with a
reason, not invented inline. This is the direct fix for Audit §1 (110 colors,
9 radii, 10 type sizes with no source of truth).

### 2.1 Spacing scale

```
space.0   = 0
space.1   = 4px
space.2   = 8px
space.3   = 12px
space.4   = 16px
space.5   = 20px
space.6   = 24px
space.7   = 32px
space.8   = 40px
space.9   = 48px
space.10  = 64px
```

Ten steps, exactly the set the owner specified. Every margin, padding, and gap
in the product resolves to one of these — no more `p-5` in one file and `p-6`
in another for the same role (Audit §1.4). Component-level spacing roles
(defined once components exist, Phase 3B) reference these by name — e.g. "card
padding = `space.6`" — so changing card padding system-wide is a one-line
change, not a find-and-replace across 60 files.

### 2.2 Color tokens

Two-layer system: **primitive** values (raw hex, private to the token file)
feeding **role** tokens (what components actually reference). Components never
touch a primitive directly — this indirection is what makes theme-switching
and re-tuning possible without touching component code.

**Neutral ramp** (the foundation the owner asked for) — 11 steps, `neutral.50`
(lightest) → `neutral.950` (darkest), generated for both themes so that
`neutral.50` in Light is near-white and `neutral.50` in Dark is near-black —
i.e., the *role* names below stay stable across themes even though which raw
step they point to inverts:

| Role token | Light resolves to | Dark resolves to | Used for |
|---|---|---|---|
| `color.canvas` | neutral.50 | neutral.950 | Page background |
| `color.surface` | neutral.0 (pure white) | neutral.900 | Card / panel background |
| `color.surface-raised` | neutral.0 + elevation.1 | neutral.850 | Popover, dropdown, modal |
| `color.border-subtle` | neutral.150 | neutral.800 | Dividers, table row lines |
| `color.border` | neutral.250 | neutral.750 | Card borders, input borders |
| `color.text-primary` | neutral.900 | neutral.50 | Headings, primary body text |
| `color.text-secondary` | neutral.600 | neutral.300 | Secondary body, table cells |
| `color.text-muted` | neutral.500 | neutral.400 | Metadata, timestamps, helper text — **the specific token that fixes Audit §7.1**; its contrast ratio against `color.surface` is a hard test in CI, not a hope |
| `color.text-disabled` | neutral.400 | neutral.550 | Disabled control text |

**Accent** (one, not a rainbow of "brand colors"):

| Role token | Purpose |
|---|---|
| `color.accent` | Primary action only: primary buttons, active nav state, focus rings, links, selected state. Nothing else. |
| `color.accent-subtle` | Accent-tinted backgrounds (selected row, active nav item background) at low opacity — not a second accent color, a weaker application of the same one |
| `color.accent-emphasis` | Hover/pressed state of accent surfaces |

The exact hue is a swatch decision made against real contrast math for both
themes (carried over as an open item, §7) — but its *role* is now singular and
fixed: this token is never reused to mean "this is a lesson" the way
`blue-600` currently is (Audit §1.2).

**Semantic set** — exactly four, status only, never category:

| Role token | Meaning | Never used for |
|---|---|---|
| `color.success` | A positive outcome / completed / passed / active | A role, a content type, a decorative accent |
| `color.warning` | Needs attention / pending / approaching a limit | — |
| `color.danger` | Destructive / failed / blocked | — |
| `color.info` | Neutral informational callout | — |

Each ships as a triplet — `*.text`, `*.surface` (a tinted background), `*.border`
— so a "Passed" badge and a "Passed" alert banner draw from the same source
without either being an ad-hoc opacity hack (today's `bg-emerald-500/10` style,
Audit §1.2, done consistently instead of per-component).

**Categorical set** — small, explicitly *not* for interactive elements:

4–6 muted, desaturated hues (`category.1`…`category.6`) reserved for data
visualization and content-type tags (a "Lesson" chip vs. an "Exam" chip in a
list, a chart series). A categorical color never appears on a button, a link,
a focus ring, or a status badge — that boundary is what stops the current
product's habit of "we needed a fourth color for the fourth stat card, grab
violet" (Audit §3).

### 2.3 Typography tokens

Font family: **one** — Geist, loaded correctly this time (the specific
`--font-geist-sans` / `--font-geist` mismatch from Audit §1.1 is a Phase 3B
implementation bug to fix, not a design decision, but it's recorded here so
it isn't lost: the token layer must actually resolve to the loaded font).

Seven-step scale (locked in Phase 2, sized here):

| Token | Size | Line height | Weight | Letter spacing |
|---|---|---|---|---|
| `type.display` | 40px | 48px | 600 | -0.01em |
| `type.h1` | 28px | 36px | 600 | -0.005em |
| `type.h2` | 20px | 28px | 600 | 0 |
| `type.h3` | 16px | 24px | 600 | 0 |
| `type.body` | 15px | 24px | 400 | 0 |
| `type.label` | 14px | 20px | 500 | 0 |
| `type.metadata` | 13px | 18px | 400 | 0.005em |

Line-heights are set generously (roughly 1.4–1.6× size) specifically because
Arabic script needs more vertical room than Latin at the same point size —
picking Latin-tight line-heights and hoping Arabic fits is how bilingual
products end up with clipped diacritics. One scale serves both scripts by
being sized for the harder case.

A single numeric scale also drives spacing derived from type (e.g. the gap
under a heading before body copy) — those derived gaps reference `space.*`
tokens by role (`type.h1` is followed by `space.2` before body text), not a
fresh judgment call per page.

### 2.4 Radius tokens

Three, as specified:

| Token | Value | Use |
|---|---|---|
| `radius.sm` | 6px | Inputs, badges, small controls, chips |
| `radius.md` | 10px | Cards, buttons, panels |
| `radius.lg` | 16px | Modals, sheets, large surfaces |
| `radius.full` | 9999px | Avatars, pills, dots — circular/pill shapes only |

Nine current values (Audit §1.4) collapse to four, and every component's
radius is a lookup, not a choice.

### 2.5 Elevation / shadow tokens

Three steps, tuned per theme (shadows read very differently on white vs.
near-black surfaces — this is why they're theme-aware tokens, not a single
CSS value):

| Token | Use | Light | Dark |
|---|---|---|---|
| `elevation.0` | Resting card | none (border only) | none (border only) |
| `elevation.1` | Hover/raised card, dropdown | soft, small offset | soft, small offset, lower opacity |
| `elevation.2` | Popover, menu | medium | medium, lower opacity |
| `elevation.3` | Modal, dialog | pronounced | pronounced, lower opacity |

Border-plus-surface-step remains the *primary* depth cue at rest (this is
already working in the current product, Audit §11) — elevation shadows are
reserved for genuinely floating/overlaying layers, never applied to every card
by default (the current `shadow-2xl`-or-nothing pattern, Audit §1.4, is
retired).

### 2.6 Border tokens

| Token | Value |
|---|---|
| `border.width.default` | 1px |
| `border.width.emphasis` | 1.5px (focus rings, selected states) |
| `border.width.heavy` | 2px (rare — active tab indicator, similar) |

Border color is always a `color.border*` role token (§2.2), never a raw
neutral value chosen per component.

### 2.7 Motion tokens

| Token | Duration | Easing | Use |
|---|---|---|---|
| `motion.instant` | 100ms | ease-out | Hover color/background changes |
| `motion.fast` | 160ms | ease-out | Focus rings, small toggles |
| `motion.base` | 220ms | cubic-bezier(0.2, 0, 0, 1) | Panel/card entrance, dropdown open |
| `motion.slow` | 320ms | cubic-bezier(0.2, 0, 0, 1) | Modal/sheet entrance, page-level transitions |

Every transition names its specific animated property (`background-color`,
`transform`, `opacity`) — `transition-all` is not a token and does not exist
in the system (Direction §9). All motion tokens respect
`prefers-reduced-motion` by collapsing to `motion.instant` or nothing,
enforced once at the token layer, not per-component.

### 2.8 Icon tokens

| Token | Size | Paired type step |
|---|---|---|
| `icon.sm` | 16px | `type.metadata` / `type.label` |
| `icon.md` | 20px | `type.body` / `type.h3` |
| `icon.lg` | 24px | `type.h2` |
| `icon.xl` | 32px | `type.h1` / `type.display` |

Icon size is looked up from the adjacent type step, never chosen freely
(Direction §6). The small `mirror: true` set (§1.2) is enumerated once here,
not decided per usage.

---

## 3. Typography (applied)

With tokens fixed, this section is the *rule set* for using them — still no
component code.

- **One H1 per page, and it is the only page title.** It replaces both the
  current static Header-bar string and the duplicated local `<h2>` (Audit
  §2.2) — the fixed top bar now renders the real, current H1, so it finally
  carries wayfinding information instead of a role name that never changes.
- **Heading levels are sequential**, not skipped. `H1 → H2 → H3`, never `H1 →
  H3`. This fixes the current broken outline (Audit §7.2) as a rule, not a
  patch.
- **`type.metadata` is a controlled vocabulary**, not a dumping ground. It is
  used only for genuinely secondary information (timestamp, row count,
  helper text) — never for a table's primary content cell, which is the
  specific misuse that produced 304 failing-contrast declarations in the
  current product (Audit §7.1). The token's color pairing is fixed at
  `color.text-muted`, verified against `color.surface` at both themes.
- **Numerals and dates render locale-aware**, not hard-coded to `en-US`
  (Audit §6) — a date formatter token/utility takes the active locale, always.

---

## 4. Layout

### 4.1 The page shell, once

One shell serves all five role layouts (replacing five independently
hand-offset layouts that each reimplement the sidebar-width calculation —
Audit §2.3): a fixed-width **rail** region (sidebar), a **bar** region (top
header), and a **content** region, with the content region's inline-start
offset (not "left" — §1.2) computed from one shared layout token, read once,
not recalculated in three separate files.

The current `!pt-20` override compensating for a fixed header (present in all
five layouts, Audit §2.3) is eliminated structurally: the shell reserves the
header's height as layout space, not as a padding hack applied downstream.

### 4.2 Content column

Every content page sits inside `container.content` (§1.4) by default;
data-dense role surfaces (super-admin, reports) opt into `container.wide`.
No page picks a bespoke max-width.

### 4.3 Grid

A 12-column grid at `bp.lg` and above, collapsing to 4 columns at `bp.sm`–`bp.md`
and a single column below `bp.sm`, with gutters fixed at `space.6`. Dashboard
compositions (§8) are specified in this grid's column spans, not in ad-hoc
`grid-cols-4` literals chosen per page.

### 4.4 Density modes, not a second scale

Two named layout densities, both built from the same `space.*` tokens (§1.1):

- **Comfortable** (default: student, teacher, centre manager) — generous
  vertical rhythm, one primary focal element per view.
- **Compact** (default: super-admin, data tables, reports) — tighter rhythm,
  more rows visible, still 4px-grid-aligned.

A page declares its density once; every spacing token inside it resolves at
that density's step, so "compact" is a systematic downshift (e.g., card
padding `space.6` → `space.4`), not a separate value chosen per component.

---

## 5. Navigation

Direct response to Audit §2.1 (flat 14-item sidebar, duplicate icons,
unlabelled collapsed state) and Audit §2.2 (dual page titles).

### 5.1 Sidebar structure

Grouped, not flat. Every role's nav items are organized into 2–3 named
sections reflecting actual usage frequency, not database-table order:

```
[ Primary — daily work ]
[ Manage — people, content, configuration ]
[ System — settings, audit, account ]   (roles that have this tier)
```

Section labels are `type.metadata`, uppercase, low emphasis — present but
quiet. This is the concrete fix for "Settings sits at the same visual weight
as Dashboard" (Audit §2.1): grouping alone establishes the primary/secondary
distinction the flat list couldn't.

### 5.2 Item rules

- **No two items in one sidebar share an icon.** This is enforced by removing
  the current icon allowlist (Direction §6) — any Lucide icon becomes
  eligible, ending the Courses/Lessons and Permissions/Audit-Logs collisions
  (Audit §2.1) by construction.
- **The collapsed (icon-only) rail state carries a native tooltip on every
  item** — the current collapsed state (10 unlabelled icons, several
  duplicated) becomes fully legible once both fixes above land.
- **A role's nav reflects what that user can actually do.** The Centre
  Manager's nav is capability-aware (Audit §2.1's specific finding: a manager
  with zero granted capabilities currently still sees a full, clickable nav)
  — an item the user's permissions don't cover is either hidden or shown
  disabled with a reason, never a silent dead end.

### 5.3 Header / title bar

The fixed top bar stops rendering a static per-role string. It renders:

- the current page's real **H1** (§3), so it changes with navigation and
  finally does its job;
- a **breadcrumb trail** for any route nested more than one level deep
  (`/teacher/courses/[id]`, `/teacher/lessons/[id]` — currently dead ends with
  no path back except the sidebar, Audit §2.2);
- the existing notification/account cluster, unchanged in position.

---

## 6. Interaction patterns

Reusable behavioral rules, defined once so every component and every role
surface applies them identically — this is the layer that turns "a button
that changes color on hover" into an actual interaction system (Direction §9,
Audit §8).

### 6.1 The five states every interactive element must define

Default → Hover → Focus-visible → Active/Pressed → Disabled. A sixth,
Loading-in-place, applies to anything that triggers an async action. No
element ships with only Default + Hover, which is the current de facto
standard (Audit §8, §7.2 — 0 uses of `focus-visible` anywhere in the product).

`focus-visible` (not bare `focus`) is the system-wide rule — focus rings
appear for keyboard navigation, not for every mouse click, which is exactly
what today's 231 `focus:` (0 `focus-visible:`) pattern gets backwards (Audit
§7.2).

### 6.2 Feedback is mandatory, not optional, on every mutation

Every user-triggered write follows one shape: **optimistic or pending state →
success confirmation → explicit failure state.** The current pattern of
`if (res.ok) { setState }` with no `else` (Audit §8, confirmed in
`students-client.tsx` and repeated across admin clients) becomes structurally
impossible once mutations flow through one shared pattern rather than being
freehand per component — Phase 3B's data-mutation helper enforces the
success/failure branch, it isn't left to each call site's discretion.

### 6.3 Destructive actions carry their real consequence

A confirmation dialog states what actually happens, using the platform's real
semantics — "This moves the student to the archive. An admin can restore them
anytime." — never a bare "Remove this student?" (Audit §8). This is a content
rule as much as a component rule: the confirm-dialog primitive (§7) takes a
required consequence string, not just a title.

### 6.4 Search indicates its own scope

Any search control that filters only the currently-loaded page says so
(placeholder or helper text: "Search this page" vs. "Search all students") —
today's silent client-side `.filter()` (Audit §8) reads as complete search and
isn't.

---

## 7. Components (grammar-constrained inventory)

This section is a **specification of what each primitive must satisfy**, not
its implementation — implementation is Phase 3B, explicitly out of scope for
this document per the owner's instruction. Every primitive below is required
to consume only tokens from §2 and patterns from §6; none may introduce a new
value.

| Primitive | Required states (§6.1) | Token dependencies | Fixes from audit |
|---|---|---|---|
| Button | all 6 | `color.accent*`, `radius.md`, `type.label`, `motion.instant` | icon-only size variant added; no hard-coded background assumption (Audit §4.2) |
| Input | all 6 + error | `color.border*`, `radius.sm`, `type.body` | label/control association wired in; `aria-invalid`/`aria-describedby` built in (Audit §4.2, §7.2) |
| Select | all 6 + error | same as Input | net-new — ends the 100% hand-styling rate (Audit §4.1) |
| Textarea | all 6 + error | same as Input | net-new — same |
| Checkbox / Radio / Switch | all 6 | `color.accent*`, `radius.sm`/`full` | net-new |
| Badge | static (no interaction) | `color.success/warning/danger/info` or `category.*` | renamed by **meaning** (`status="success"`) not by raw color (Audit §4.2's `variant="green"` problem) |
| Card | hover only where interactive | `color.surface*`, `radius.md`, `elevation.0/1`, `space.6` | one padding value, one radius, replacing 3 backgrounds / 3 radii / 3 paddings in use today (Audit §1.4, §10) |
| Table | row hover, sort-active, selected | `color.border-subtle`, `type.body/metadata` | horizontal-scroll container replaces column-hiding (§6.7 below, Audit §4.3) — no column is ever unreachable |
| Modal / Sheet | focus-trapped, all 6 on internal controls | `elevation.3`, `radius.lg`, `motion.slow` | focus trap + restore + `aria-modal` built in; `confirmDialog` rebuilt on this primitive instead of duplicating its chrome (Audit §4.2) |
| Toast | dismiss, hover-pause | `color.success/warning/danger`, `elevation.2`, `motion.base` | `role="status"`/`aria-live` added; direction-aware position (`inset-inline-end`, not `right-4` — Audit §4.2, §6) |
| Tabs | all 6 per tab, `aria-selected` | `color.accent`, `type.label` | net-new shared primitive (currently one-off in `lesson-tabs.tsx`) |
| EmptyState | static, optional action button | `icon.xl`, `type.h3/body`, `space.6` | one component, three required slots (icon, message, optional action) — ends 27 ad-hoc strings across 4 phrasings (Audit §4.4) |
| Skeleton | shimmer (respects reduced-motion) | `color.surface-raised`, `radius.md` | generated per-surface shape in Phase 3B, not one generic 3-block skeleton reused everywhere (Audit §4.5) |
| Tooltip | appears on focus AND hover | `elevation.2`, `type.metadata` | required for the collapsed-sidebar fix (§5.2) |
| Avatar | static | `radius.full`, `color.accent-subtle` (fallback initial) | one consistent fallback-color rule, replacing the current per-context guess (blue in header, emerald in students table — Audit §10) |
| Breadcrumb | link states | `type.metadata`, `color.text-secondary` | net-new (§5.3) |
| Pagination | all 6 per control | `color.accent`, `type.label` | net-new — currently absent everywhere |

**Explicitly not started before this table exists**: this is the direct
answer to the owner's constraint. Nothing above gets implemented until this
inventory, its token bindings, and §6's interaction rules are reviewed and
approved — a component built before this table would have nowhere defined to
pull its values from.

---

## 8. Role-specific compositions (specification, not code)

Carrying forward Direction §8's dashboard table into layout-grammar terms —
still descriptions, not markup. Each composition is expressed as a sequence of
grid regions (§4.3) at a named density (§4.4).

**Student** — Comfortable density.
Row 1 (12 cols): one **Continue** module — real progress bar, real "resume"
action — sized as the single largest element on the screen (spans 8 of 12
columns; a compact "this week" list fills the remaining 4). Row 2: supporting
counts, demoted to a quiet single-line strip, not stat cards. Row 3: recent
grades / announcements as secondary panels.

**Teacher** — Comfortable density, work-oriented.
Row 1 (12 cols, split 8/4): a **work queue** panel (ungraded submissions,
flagged proctoring events, open requests, each a real actionable row with a
destination) beside a compact "today" agenda. Row 2: lesson/exam lists,
demoted from the current top position.

**University Admin** — Compact density.
Row 1: institution health strip (real signals only — no fabricated
"Operational"). Row 2 (12 cols): a genuine activity feed once one exists; until
then, an explicit EmptyState ("Activity log coming soon") rather than lessons
relabelled as events (Audit §3's specific finding).

**Centre Manager** — Comfortable density.
Row 1: the capability list, promoted to the organizing element of the page —
what's granted determines what else renders on this dashboard, not a fixed
four-card grid regardless of permissions.

**Super Admin** — Compact density.
Row 1: tenant fleet table (using the Table primitive, §7) with real per-tenant
health, sortable. Aggregate counts move to a slim header strip, not four
large cards competing with the fleet table for attention.

None of the five leads with a 4-card, same-color-order grid as the first
thing rendered — the specific pattern Audit §3 identifies as the product's
core dashboard failure.

---

## 9. What Phase 3B needs before implementation starts

This document is the grammar. Before a single component is coded:

1. **Final accent hex** (Direction §11.3) — checked against `color.canvas`
   and `color.surface` in both themes at real WCAG AA/AAA ratios, not chosen
   by eye.
2. **Neutral ramp generation** — the 11-step scale for both themes, produced
   and contrast-checked as a set (this is mechanical once the accent is fixed,
   but must happen before any component references `color.text-muted`).
3. **Confirmation that Geist loads correctly** (Audit §1.1's broken CSS
   variable) — a one-line fix, but it must land before the type tokens in §2.3
   mean anything in the browser.
4. **A decision on the Manara/Beacon motif** (Direction §11.4) — if it's
   adopted as a recurring visual device, it needs one token-level definition
   (likely a progress/wayfinding component variant) before Role Compositions
   (§8) are built, not bolted on after.

Nothing else blocks starting Phase 3B. The grammar above — Foundation, Tokens,
Typography, Layout, Navigation, Interaction Patterns, Component
specification, Role Compositions — is complete and internally consistent, and
is the order implementation should proceed in as well: tokens exist before any
component references them, layout and navigation shells exist before
components are placed inside them, and role compositions are assembled last,
from primitives that already satisfy §6's interaction rules.

---

*End of Phase 3 (grammar). No component code has been written. Phase 4 applies
this grammar to each of the five role surfaces plus the public site, starting
only once §9's four items are resolved.*
