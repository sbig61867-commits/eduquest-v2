# UI Regression Audit — 9 Sep 2026

Analysis only. No code was changed. Scope: the visual regressions reported after
today's redesign commits (`c68afc2` … `46dcce2`) plus `0ef4b5d` / `c28bcfd` from
the redesign phase.

Reproduction environment: local dev server on port 3000, in-app browser,
OS colour scheme = dark, not signed in.

---

## A. Confirmed live — the login screen renders blank

**Severity: blocking.** Reproduced twice, including after a fresh navigation.

The page markup is present and correct. The card is parked at `opacity: 0`
forever:

```
url    http://localhost:3000/login
inline style   opacity:0;transform:translateY(16px)
computed opacity   0
document.getAnimations().length   0
prefers-reduced-motion   false
```

### Cause

`src/app/(auth)/login/page.tsx:71` wraps the whole card in `RevealOnScroll`
with `mode="mount"`. That component (`src/components/shared/motion/RevealOnScroll.tsx`)
renders a framer-motion `motion.div` whose `hidden` variant is `opacity: 0`.
framer-motion writes that starting style, then never runs the `visible`
animation. Zero animations are registered on the document, so this is not a slow
animation, it is an animation that never starts.

Installed versions:

| package | version |
|---|---|
| framer-motion | 13.2.0 |
| react | 19.2.4 |
| next | 16.3.4 |

The same failure mode affects every `RevealOnScroll`, `StaggerGrid` and
`StaggerItem` in the app, because all three hide their content behind an
`opacity: 0` starting variant. That covers all five dashboards
(`src/app/(admin|teacher|student|center|super-admin)/*/dashboard/page.tsx`), the
student quick-access panel, and the remaining auth pages.

Note the irony: `src/app/globals.css` already carries a written warning about
exactly this hazard for the GSAP path. The comment says content must stay on the
page rather than being "parked at opacity 0 waiting for a callback". The
framer-motion path violates that rule.

### Suggested fixes, in order of preference

1. Make the reveal components fail open. Render the content visible by default
   and let the animation take it from visible to visible, or gate the
   `opacity: 0` starting state behind a `mounted` flag set in an effect. If the
   animation library is missing or wedged, the user still sees the page.
2. Separately, work out why framer-motion 13 does not animate under React 19 and
   Next 16. Check whether `motion` is being pulled in through a server component
   boundary, and try the `motion/react` entry point instead of `framer-motion`.
3. Consider dropping framer-motion from the auth and dashboard shells entirely.
   The project already loads GSAP for the landing page, so two animation runtimes
   are being shipped for overlapping jobs.

---

## B. Text fields lose focus after the first character

**Severity: high.** Affects every create and edit form, in all roles.

### Cause

`src/components/ui/modal.tsx:20-54`. The focus-trap effect is declared as:

```
useEffect(() => { ... }, [open, onClose])
```

Its cleanup calls `triggerRef.current?.focus()` and its body calls
`getFocusable()[0]?.focus()`.

Every single call site passes a freshly created arrow function for `onClose`:

```
<Modal open={showAdd} onClose={() => setShowAdd(false)} ... >
```

Twenty such call sites, verified across super-admin, teacher, and student code.
So `onClose` has a new identity on every parent render. Typing one character into
a controlled input inside the modal re-renders the parent, which changes
`onClose`, which tears the effect down and runs it again. The cleanup moves focus
to the remembered trigger and the re-run moves focus to the first focusable
element in the dialog. Either way focus leaves the input after one keystroke,
which is precisely the reported behaviour of a vanishing caret that needs a fresh
click per character.

There is a second defect in the same block: `triggerRef.current = document.activeElement`
is reassigned on every re-run, so the "restore focus on close" feature also loses
the real trigger.

### Suggested fix

Take `onClose` out of the dependency array and read it through a ref that an
effect keeps current. Depend on `[open]` alone, and set up the trap once per
open. Keyboard handling can read the ref.

This regression entered with `0ef4b5d`, the commit that added the focus trap. It
did not exist in `f21ff18`.

---

## C. Dark mode is forced on every dashboard, with no way out

**Severity: high.** This is the source of the "dark petroleum, painful to look
at" complaint.

### Cause

Two facts combine.

First, `src/app/globals.css` defines a full dark palette under
`@media (prefers-color-scheme: dark)`. Its canvas is `#050F1F`, a near-black
navy, and its surface is `#0A1B32`.

Second, only the public marketing pages opt out. Five files pin the light theme
in an effect:

- `src/components/public/landing.tsx:574`
- `src/components/public/pricing-page.tsx:170`
- `src/components/public/policy.tsx:261`
- `src/components/public/ai-assistant-page.tsx:79`
- `src/components/public/live-monitoring-page.tsx:69`

No dashboard route group does this, and no theme toggle exists anywhere in the
codebase. So any user whose operating system is set to dark gets the dark navy
dashboard whether they want it or not, with no control to change it.

The palette itself is also the weakest part of the design. In dark mode the
brand roles swap: navy becomes the ground and blush `#F2C4CE` becomes the accent.
That means primary buttons turn pale pink on near-black, and the accent surface
token `--color-accent-subtle` is `#24172150`, an eight-digit hex with a `50`
alpha. Layered on a nearly black canvas that reads as almost nothing, which is
why cards look flat and muddy rather than layered.

### Suggested fixes

1. Ship a real theme control. Default the dashboards to light, persist the
   choice, and set `data-theme` on the root element before first paint to avoid
   a flash. The token system already supports `data-theme="light"` and
   `data-theme="dark"`, so only the control and the persistence are missing.
2. Until that exists, pin `data-theme="light"` in the five role layouts the same
   way the public pages do. That is a one-line change per layout and immediately
   removes the unwanted dark theme.
3. Re-tune the dark palette rather than deriving it by swapping brand roles.
   Lift the canvas off near-black, and give `--color-accent-subtle` an opaque
   value instead of a low-alpha one.

---

## D. Clipped and half-hidden icons

Two distinct offenders were found by reading the layout code. Neither was
confirmed visually, because signing in was not possible without a test password.

### D1. The sidebar collapse chevron

`src/components/shared/sidebar.tsx:117`. When the sidebar is collapsed the toggle
button gets:

```
absolute end-0 translate-x-1/2 top-5
```

Its nearest positioned ancestor is the `fixed` `<aside>`, not the brand row, and
`translate-x-1/2` deliberately pushes half the button outside the sidebar's own
edge so it floats over the page. That is a fragile construction. It overlaps page
content, it sits on top of the fixed header's stacking context, and the icon
reads as buried in the edge rather than as a control. This matches the reported
symptom and it is present in all five role layouts, because all five render the
same sidebar.

### D2. The student quick-access tab

`src/components/student/quick-access-panel.tsx`. The toggle uses physical
`right-0` with `border-r-0` and `rounded-l-xl`, flush against the viewport edge.
Physical `right` is also inconsistent with the rest of the shell, which uses
logical properties (`start-0`, `end-0`, `ps-`) for right-to-left support. In an
Arabic right-to-left layout this tab lands on the wrong side.

More broadly, the codebase mixes physical and logical direction properties. The
sidebar and header use logical properties; the quick-access panel, the toast
container and the notification panel use physical `right`. Worth a sweep.

### Suggested fixes

- Give the sidebar brand row `position: relative` so the chevron anchors to the
  row it belongs to, and stop pushing it outside the panel. Put it inline in the
  collapsed rail instead.
- Convert `right-*` to `end-*` in the quick-access panel, the toaster and the
  notification panel.

---

## E. Smaller findings

**The dev server did not serve `/contact`.** A request stayed open for more than
three minutes with no response. This may be a slow first compile in development
rather than a real fault, but it is worth confirming against a production build.

**Two animation runtimes ship together.** GSAP drives the landing page,
framer-motion drives everything else. Both are in the client bundle.

**The landing section bands are expensive.** `globals.css` gives each band two
blurred orbs at `filter: blur(72px)`, sized to 420% and 380% of the band height,
each animating `transform` and `opacity` on a 22 and 28 second loop, plus a third
sheen sweep. Large blurred surfaces are the most expensive thing to composite,
and these never stop. Consider pausing them off-screen.

**Contrast claims are undocumented for the dark palette.** The light palette in
`globals.css` carries measured contrast ratios in comments. The dark palette
carries none. Given that this is the theme users are actually seeing, it should
be measured.

---

## Priority order

1. **B** — the focus bug makes every form in the product unusable.
2. **A** — the login screen is blank, which blocks everything behind it.
3. **C** — pin light mode on the dashboards as an immediate stopgap, then build
   a real toggle.
4. **D** — icon placement.
5. **E** — cleanup.

Items A and B are both regressions from the redesign work and both have small,
contained fixes.
