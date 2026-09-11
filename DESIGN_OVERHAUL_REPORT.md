# DESIGN_OVERHAUL_REPORT

Date: 2026-09-09 · Branch `main`

This report records what changed in the visual layer during this pass, why, and what is still open.
`DESIGN_TOKENS.md` remains the source of truth for hex values. `DESIGN_AUDIT.md` and
`DESIGN_SYSTEM.md` describe the system itself; this file describes the work done against it.

## The headline defect: the authentication pages were unreadable in light mode

`src/app/globals.css` opens with a stated rule: no literal color value appears anywhere except that
file. The authentication pages broke it in the worst possible way. They painted a fixed dark
background with `bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900`, then set their text
with the theme tokens `text-fg` and `text-fg-secondary`.

In dark mode this happens to look right, because `--color-fg` resolves to a light grey. In light
mode `--color-fg` is `#0B3658`, a deep navy. The result was navy text on a near-black gradient
across the login page, the forgot-password page, the reset-password page and the invitation
acceptance page. The first screen every user sees, and the screen an invited student lands on, was
close to illegible for anyone whose device is set to light.

This was not a subtle contrast miss. It was the token system being half-applied: theme-aware text on
a theme-blind background.

All four surfaces now build from the tokens. The page ground is `bg-canvas` with a soft accent
radial wash, the card is `bg-elevated` over `border-border`, inputs sit on `bg-canvas`, and the
primary action uses `bg-accent` with `text-accent-fg`. Both themes were checked in the browser.

## Contrast on primary actions

Several primary buttons used `text-fg` on `bg-accent`. In light mode that is navy on `#4E9AD9`; in
the explicit dark theme it is a light grey on the teal `#2DD4BF`. `--color-accent-fg` exists for
exactly this pairing and flips correctly with the theme. Every one of those buttons now uses it,
including the shared error boundary, the confirmation dialog and the invitation join button.

The confirmation dialog's danger button also carried `bg-error hover:bg-error`, meaning the hover
state was identical to the resting state and the button had no affordance. It now darkens on hover.
The same pattern was fixed on the super-admin message delete button.

## Raw palette classes mapped onto tokens

The application shell carried 370 raw Tailwind palette classes such as `text-red-400`,
`bg-red-500/10`, `border-slate-700` and `ring-violet-500`. These bypass the theme entirely: they are
identical in light and dark, so a status message tuned for a dark background becomes a low-contrast
smear on a light one. They were also semantically inconsistent, with error states variously rendered
in `red-300`, `red-400` and `red-500` across different screens.

Each raw class was mapped to the token that carries its meaning: the red family to `error`, green and
emerald to `success`, amber to `warning`, blue and sky to `info` or `accent` depending on whether the
element was informational or interactive, and the slate and gray families to the surface and
foreground scale.

| Scope | Raw palette classes before | After |
|---|---|---|
| Application shell (`src/app`, `src/components`, `src/lib`, excluding marketing) | 370 | 48 |

The 48 that remain are deliberate and documented:

- **Overlay scrims.** `bg-black/40` and `bg-black/60` behind modals, the mobile sidebar and the
  confirmation dialog, plus the `from-black/80` gradient over live proctoring video. A scrim should
  be neutral black regardless of theme.
- **The printed report.** `super-admin/reports` renders a print surface that is deliberately white
  paper with a slate table, because it is exported and printed rather than viewed in the theme.
- **Toggle knobs.** `bg-white` on the sliding knob of switch controls, which reads correctly against
  both the accent-filled and the neutral track.

The marketing pages under `src/components/public` were left alone. They are a separate, deliberately
art-directed surface that pins itself to light mode, and they are outside the application shell's
token contract.

## Missing states

- **404.** The application had no `not-found.tsx` at any level. Every `notFound()` call, and every
  bad URL from a signed-in user, fell through to the unstyled Next.js default. A branded 404 now
  sits at the root, built from tokens, with a route back into the product.
- **Centre manager.** The `(center)` route group had neither an error boundary nor a loading state.
  An error there dropped the user out of the application shell entirely. Both were added.
- **Auth loading.** `(auth)` gained a skeleton so the sign-in route does not flash blank.

## Accessibility fixes

- Three icon-only buttons had no accessible name: back-to-users in the super-admin user detail,
  send-reply in the requests inbox and refresh in the invitations list. A screen reader announced
  each as an unlabelled button. All three now carry an `aria-label`, with the icon marked
  `aria-hidden`.
- Decorative icons inside the error boundary and the message delete button were hidden from the
  accessibility tree so they are not read out as content.
- The new course player exposes its progress bar with `role="progressbar"` and the matching value
  attributes, marks the outline as a labelled `nav`, sets `aria-current` on the active section and
  `aria-expanded` on each level toggle, and gives completed sections a screen-reader-only
  "(completed)" suffix so completion is not conveyed by icon colour alone.

## Correctness fixes surfaced by linting

ESLint reported four errors and ten warnings; the project now reports zero of both.

Two were real React defects rather than style issues. The landing page's count-up hook called
`setState` synchronously inside an effect body for non-numeric stats, and the student quick-access
panel triggered a fetch, and its loading `setState`, directly in an effect body. Both cause cascading
renders. The count-up now derives the non-numeric case during render instead of writing state, and
the panel defers its fetch out of the commit phase.

The rest were unescaped quote entities and unused imports. Five of the unused imports were
`PageTitle` on pages that imported it and never rendered it, which is covered in `ROUTE_QA_REPORT.md`
as a wayfinding gap rather than a lint nit.

## Verification

| Check | Result |
|---|---|
| TypeScript `tsc --noEmit` | clean |
| ESLint | 0 errors, 0 warnings |
| Vitest | 63 of 63 passing |
| Login page, light and dark | verified in browser |
| Browser console | no errors |
| Dev server log | no errors |

One test in `mutations-extended.test.tsx` selected delete buttons by the literal class `red-400`,
which the token migration renamed. Rather than reintroduce the raw class, the selectors were moved
onto the token class name, and the one button that did not fit the pattern was given an `aria-label`
and selected by that instead. Selecting by accessible name is the more durable choice and the
direction the remaining selectors should move in.

## Not done, and why

The product mixes Arabic and English with no internationalization layer. Components hardcode
`dir="rtl"` on their own containers while the document stays `lang="en"` and left-to-right, so
Tailwind's `rtl:` variants only work inside those islands. Physical-direction utilities such as
`right-3` appear where logical properties belong. A correct fix means introducing a locale, driving
`lang` and `dir` from it, moving strings into catalogues and sweeping physical properties to logical
ones. That touches nearly every component and would put working functionality at risk. It is the
largest remaining design debt and is recorded in `PRODUCT_COMPLETENESS_AUDIT.md` as such.
