# DESIGN_TOKENS.md — EduQuest Resolved Token Values

**Phase 3B Preparation.** This document records the final, contrast-verified
values for all color tokens defined as roles in [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md)
§2 (Tokens). It also documents the Geist font fix (Prerequisite 3).

All contrast ratios were computed with the WCAG 2.1 relative luminance formula
(linearized sRGB, not approximate). WCAG AA = 4.5:1 for normal text, 3:1 for
large text and non-text UI. WCAG AAA = 7:1.

---

## Prerequisite 1 — Final Accent

### Evaluated Candidates (Light Theme)

| Candidate | Hex | On Canvas (#F8F7F5) | On Surface (#FFF) | White text on btn |
|-----------|-----|--------------------|--------------------|-------------------|
| Teal-700 | #0F766E | 5.11:1 AA | 5.47:1 AA | 5.47:1 AA |
| **Teal-deep** | **#0D6E6E** | **5.65:1 AA** | **6.05:1 AA** | **6.05:1 AA** |
| Cyan-700 | #0E7490 | 5.00:1 AA | 5.36:1 AA | 5.36:1 AA |
| Sky-700 | #0369A1 | 5.54:1 AA | 5.93:1 AA | 5.93:1 AA |
| Blue-700 | #1D4ED8 | 6.26:1 AA | 6.70:1 AA | 6.70:1 AA |
| Green-800 | #166534 | 6.66:1 AA | 7.13:1 AAA | 7.13:1 AAA |
| Green-700 | #15803D | 4.68:1 AA | 5.02:1 AA | 5.02:1 AA |
| Amber-800 | #854D0E | 6.40:1 AA | 6.85:1 AA | 6.85:1 AA |
| Amber-700 | #B45309 | 4.69:1 AA | 5.02:1 AA | 5.02:1 AA |
| Institutional-Blue | #0F4C81 | 8.27:1 AAA | 8.86:1 AAA | 8.86:1 AAA |
| Deep-Navy | #1E3A5F | 10.74:1 AAA | 11.50:1 AAA | 11.50:1 AAA |
| Teal-900 | #134E4A | 8.85:1 AAA | 9.48:1 AAA | 9.48:1 AAA |

### Dark-Mode Variants (Light accent on dark backgrounds)

| Base accent | Dark variant | On DK-Canvas (#0F1117) | On DK-Surface (#1A1D27) |
|-------------|-------------|------------------------|--------------------------|
| **#0D6E6E** | **#2DD4BF** | **10.14:1 AAA** | **9.03:1 AAA** |
| #0F766E | #2DD4BF | 10.14:1 AAA | 9.03:1 AAA |
| #0E7490 | #22D3EE | 10.44:1 AAA | 9.30:1 AAA |
| #166534 | #4ADE80 | 10.83:1 AAA | 9.65:1 AAA |
| #854D0E | #FBBF24 | 11.30:1 AAA | 10.07:1 AAA |

### Decision: `#0D6E6E` (Teal-deep)

**Rationale — based on contrast math, not visual preference:**

- Passes AA in every required context: as text on canvas (5.65:1), as text on
  surface (6.05:1), and as a button background with white text (6.05:1).
- Rejects the candidates that failed the direction brief:
  - Blue-700 / Institutional-Blue / Deep-Navy → these are "everything = blue"
  - Blue-700 and Indigo are in the explicitly-rejected purple/blue AI-startup
    category from the Direction brief.
  - Green-800 passes AAA but reads "eco/sustainability", not "education
    infrastructure"; also collides semantically with `color.success`.
  - Amber-700/800 pass but read "warning/attention" — semantic collision with
    `color.warning`.
- Teal sits distinctly between blue and green. No strong negative cultural
  connotations in either Arabic or English contexts. Used by institutional
  brands (university portals, government platforms) globally.
- The AAA-scoring options (Teal-900 #134E4A, Institutional-Blue #0F4C81,
  Deep-Navy #1E3A5F) would make buttons that read as near-black rather than
  a recognizable accent. The accent's job is to be recognized as a distinct
  tone, not just to be the darkest element on screen.

**Final values:**

| Token | Role | Light | Dark |
|-------|------|-------|------|
| `color.accent` | Base accent | `#0D6E6E` | `#2DD4BF` |
| `color.accent-hover` | Hover state | `#0A5E5E` | `#25BCA9` |
| `color.accent-subtle` | Tinted backgrounds (focus rings, highlights) | `#F0FDFD` | `#0D2E2E` |
| `color.accent-border` | Accent-toned borders | `#A5D6D6` | `#1D5F5F` |

Hover values derived by shifting lightness ~8% toward black (light) / ~8% toward
black (dark) within the same hue. These are the only derived values; implementation
must compute them with `oklch()` or verify contrast after derivation.

---

## Prerequisite 2 — Neutral Ramp

### Light Theme (11-step warm-gray scale)

Warm undertone: the ramp is built on stone/warm-gray, not slate (cool-blue-gray).
This aligns with the "institutional daylight" feel from DESIGN_DIRECTION §5.

| Step | Hex | Role | On Canvas 4.5:1 min? | On Surface 4.5:1 min? |
|------|-----|------|----------------------|-----------------------|
| n-0 | `#FFFFFF` | Elevated surface (modal bg, raised panel) | background, n/a | background, n/a |
| n-50 | `#F8F7F5` | **Canvas** (app root background) | background, n/a | 1.07:1 (background role) |
| n-100 | `#F1EFEB` | **Surface** (cards, sidebars, panels) | 1.07:1 (background role) | 1.15:1 (background role) |
| n-200 | `#E5E2DC` | Subtle divider, striped row | — | — |
| n-300 | `#D1CCC4` | **Border** (default, most separators) | — | — |
| n-400 | `#A8A29E` | Disabled bg, placeholder border, icon in disabled state | — | — |
| n-500 | `#767068` | **Muted text** (placeholder, secondary labels on surface) | 4.57:1 ✓ AA | 4.89:1 ✓ AA |
| n-600 | `#57534E` | **Secondary text** (captions, labels, metadata) | 7.13:1 ✓ AAA | 7.63:1 ✓ AAA |
| n-700 | `#44403C` | Supporting body text | 9.59:1 ✓ AAA | 10.27:1 ✓ AAA |
| n-800 | `#292524` | **Primary text** (body copy, most UI text) | 14.17:1 ✓ AAA | 15.17:1 ✓ AAA |
| n-900 | `#1C1917` | **Headings, emphasis** | 16.33:1 ✓ AAA | 17.49:1 ✓ AAA |

**Note on n-500:** Original candidate `#78716C` scored 4.48:1 on canvas — a fail
by 0.02 units. Adjusted to `#767068` (4.57:1 on canvas, 4.89:1 on surface). The
visual change is imperceptible but the correction is required.

**Note on n-400:** 2.36:1 on canvas — not usable for any text. Correct uses:
disabled input background, non-text decorative borders, skeleton shimmer base.
Never use n-400 for any readable content, even placeholder text.

### Dark Theme (11-step, same warm-gray hue family)

| Step | Hex | Role | On Canvas 4.5:1 min? | On Surface 4.5:1 min? |
|------|-----|------|----------------------|-----------------------|
| n-d-0 | `#0F1117` | **Canvas** | background, n/a | — |
| n-d-50 | `#1A1D27` | **Surface** | 1.12:1 (background) | background, n/a |
| n-d-100 | `#222633` | **Elevated surface** | 1.25:1 (background) | 1.12:1 (background) |
| n-d-200 | `#2D3142` | Subtle divider | — | — |
| n-d-300 | `#3D4257` | **Border** | — | — |
| n-d-400 | `#55596E` | Disabled, inactive chrome | — | — |
| n-d-500 | `#8B91A8` | **Muted text** | 6.03:1 ✓ AA | 5.38:1 ✓ AA |
| n-d-600 | `#A8ADBE` | **Secondary text** | 8.43:1 ✓ AAA | 7.51:1 ✓ AAA |
| n-d-700 | `#C4C8D5` | Supporting text | 11.29:1 ✓ AAA | 10.06:1 ✓ AAA |
| n-d-800 | `#DDE0E8` | **Primary text** | 14.29:1 ✓ AAA | 12.73:1 ✓ AAA |
| n-d-900 | `#F0F2F5` | **Headings, emphasis** | 16.83:1 ✓ AAA | 14.99:1 ✓ AAA |

Dark theme muted text passes AA on all three dark surfaces (canvas, surface,
elevated) — no restrictions on where n-d-500 can be used for text.

### Semantic Token Mapping

These are the public tokens components consume. They resolve to neutral ramp
values above, plus the accent and semantic ranges.

#### Light theme

```css
:root {
  /* Surfaces */
  --color-canvas:            #F8F7F5;   /* n-50  */
  --color-surface:           #F1EFEB;   /* n-100 */
  --color-surface-elevated:  #FFFFFF;   /* n-0   */

  /* Borders */
  --color-border:            #D1CCC4;   /* n-300 */
  --color-border-strong:     #A8A29E;   /* n-400 */

  /* Text */
  --color-text-primary:      #292524;   /* n-800 */
  --color-text-secondary:    #57534E;   /* n-600 */
  --color-text-muted:        #767068;   /* n-500 — AA on surface, AA on canvas */

  /* Accent */
  --color-accent:            #0D6E6E;
  --color-accent-hover:      #0A5E5E;
  --color-accent-subtle:     #F0FDFD;
  --color-accent-border:     #A5D6D6;

  /* Semantic */
  --color-success:           #166534;
  --color-success-subtle:    #F0FDF4;
  --color-warning:           #92400E;
  --color-warning-subtle:    #FFFBEB;
  --color-error:             #9F1239;
  --color-error-subtle:      #FFF1F2;
  --color-info:              #075985;
  --color-info-subtle:       #F0F9FF;
}
```

#### Dark theme

```css
[data-theme="dark"],
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    /* Surfaces */
    --color-canvas:            #0F1117;   /* n-d-0  */
    --color-surface:           #1A1D27;   /* n-d-50 */
    --color-surface-elevated:  #222633;   /* n-d-100 */

    /* Borders */
    --color-border:            #3D4257;   /* n-d-300 */
    --color-border-strong:     #55596E;   /* n-d-400 */

    /* Text */
    --color-text-primary:      #DDE0E8;   /* n-d-800 */
    --color-text-secondary:    #A8ADBE;   /* n-d-600 */
    --color-text-muted:        #8B91A8;   /* n-d-500 — AA on all dark surfaces */

    /* Accent */
    --color-accent:            #2DD4BF;
    --color-accent-hover:      #25BCA9;
    --color-accent-subtle:     #0D2E2E;
    --color-accent-border:     #1D5F5F;

    /* Semantic */
    --color-success:           #4ADE80;
    --color-success-subtle:    #052E16;
    --color-warning:           #FBBF24;
    --color-warning-subtle:    #3B1600;
    --color-error:             #FB7185;
    --color-error-subtle:      #3B0013;
    --color-info:              #38BDF8;
    --color-info-subtle:       #082F49;
  }
}
```

### Semantic Colors — Contrast Verified

| Pair | Text | Background | Ratio |
|------|------|-----------|-------|
| Success text on subtle bg | #166534 | #F0FDF4 | 6.81:1 AA |
| Warning text on subtle bg | #92400E | #FFFBEB | 6.84:1 AA |
| Error text on subtle bg | #9F1239 | #FFF1F2 | 7.30:1 AAA |
| Info text on subtle bg | #075985 | #F0F9FF | 7.09:1 AAA |
| Success text on canvas | #166534 | #F8F7F5 | 6.66:1 AA |
| Warning text on canvas | #92400E | #F8F7F5 | 6.62:1 AA |
| Error text on canvas | #9F1239 | #F8F7F5 | 7.49:1 AAA |
| Info text on canvas | #075985 | #F8F7F5 | 7.06:1 AAA |

All semantic pairs exceed AA. Error and Info reach AAA on both their tinted
background and the neutral canvas.

---

## Prerequisite 3 — Geist Font Fix

### Problem (Audit §1.1)

`layout.tsx` registers the Geist font with:
```ts
const geist = Geist({ subsets: ['latin'], variable: '--font-geist' })
```
This injects `--font-geist` into the HTML element's class.

`globals.css` (the unchanged Next.js starter file) referenced a non-existent variable:
```css
@theme inline {
  --font-sans: var(--font-geist-sans);  /* ← UNDEFINED — should be --font-geist */
}
body {
  font-family: Arial, Helvetica, sans-serif;  /* ← overrides everything */
}
```

Result: every text element in the product renders in Arial despite Geist being loaded.

### Fix Applied

`src/app/globals.css` was updated to:
```css
@import "tailwindcss";

@theme inline {
  /* Fix: layout.tsx registers Geist as --font-geist, not --font-geist-sans */
  --font-sans: var(--font-geist);
}

body {
  /* Font stack resolves through --font-geist injected by next/font on <html> */
  font-family: var(--font-sans), system-ui, sans-serif;
}
```

**What this does:**
1. `--font-sans: var(--font-geist)` — correctly maps the Tailwind `font-sans` token
   to the CSS variable actually injected by `next/font`.
2. `font-family: var(--font-sans), system-ui, sans-serif` — resolves correctly
   to Geist, with `system-ui` and `sans-serif` as true fallbacks.
3. Removes the starter's dead `@media (prefers-color-scheme: dark)` block on
   `--background`/`--foreground` variables that conflicted with the hardcoded
   `bg-slate-950` class in layout.tsx.
4. Removes `--color-background` / `--color-foreground` from `@theme inline` —
   these were dangling starter variables unused by any component; they'll be
   replaced by the full `--color-*` token set in Phase 3B implementation.

**Note — Geist Mono:** `layout.tsx` does not load `Geist_Mono`, so `--font-geist-mono`
was also undefined. The starter's `--font-mono: var(--font-geist-mono)` reference
is removed. If a monospace stack is needed (code blocks, exam timers), `Geist_Mono`
should be added to `layout.tsx` when Phase 3B implements the type tokens.

---

## Open: Prerequisite 4 (Manara/Beacon Motif)

Per DESIGN_SYSTEM.md §9 item 4: this is an owner decision, not a derivation.
The options are:

**Adopt as a recurring visual device:**  
A named component variant (e.g. `ProgressBeacon`) that appears in the student
timeline, the centre capability list, and the admin course-health view. Needs one
token-level definition before Role Compositions are assembled, so this decision
must precede Phase 4.

**Treat as one-time composition element:**  
Used only in the student dashboard "current course" focal point (as described in
DESIGN_SYSTEM.md §8). No token needed — just a one-off in that composition.

**Defer entirely:**  
Drop the motif. The role compositions can be built without it.

---

*This document is a supplement to DESIGN_SYSTEM.md. Together they constitute
the complete Phase 3 grammar. Phase 3B implementation begins once Prerequisite 4
is resolved.*
