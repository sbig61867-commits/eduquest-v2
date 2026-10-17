# PageSpeed Remediation Plan (PS)

Source: PageSpeed Insights run on 2026-10-06 against `https://eduquest-v2.vercel.app/` (report
`o5a5if7erj`), plus a Chrome timing check and `curl` checks the same day. Each item below is fixed
alone, on its own branch, with its own PR, and only after the owner approves that item.

## Baseline (2026-10-06, page `/`)

| | Mobile | Desktop |
|---|---|---|
| Performance | 97 | 82 |
| Accessibility | 89 | 92 |
| Best practices | 100 | 100 |
| SEO | 92 | 92 |
| Agentic browsing | 1/4 | 1/4 |
| FCP / LCP | 1.1 s / 2.6 s | 0.4 s / 0.6 s |
| TBT / CLS | 20 ms / 0 | 360 ms / 0 |

- Real-user data (CrUX): none. The site has too little traffic, and it is not indexed by Google.
- Not measured yet: `/ar`, `/en`, `/login` (the PageSpeed API daily quota was exhausted). PS-0 covers this.
- The slowness the owner feels is mostly their own network. Chrome reports it as `3g`, with
  700 ms RTT and 1.45 Mbps. The server answers in 0.2–0.45 s.

## Rules for every item

1. **One item = one branch from `origin/main` = one PR.** Never mix two items, and never mix with
   D4 (the D4 shell work is still uncommitted in the working tree and has its own blocker: the
   missing `term: 'groups'` on `/center/groups` in `src/lib/navigation.ts`). Before branching, the
   working tree state is decided with the owner (commit D4, or stash it) — never discard it.
2. **Fix only what the item names.** Anything else noticed on the way is written into
   "Found along the way" at the bottom of this file, not fixed.
3. **Read before changing.** Every "to verify" line is checked in the code first. If the
   verification contradicts the plan, stop and report before changing anything.
4. **Measure before and after** with the same tool: PageSpeed (the site, not the API) for the
   item's page, both form factors. A fix is done only when its finding is gone AND no other
   score dropped.
5. **No regressions:** `npx vitest run --pool=threads`, `npm run lint` and `npm run build` pass. The
   ratchets (`perf-contract`, `design-contract`, `i18n-no-hardcoded-strings`) never go up. The
   edge cache of `/<locale>/…` pages still answers `X-Vercel-Cache: HIT`, and the public HTML still
   does not depend on cookies (see `CLAUDE.md` → "Public page caching").
6. **Both languages:** every visual or markup change is checked in `ar` (RTL) and `en`.
7. **Owner approval** before: commit, push, PR, merge, and any change to `next.config.ts`, the
   proxy, dependencies or build targets.
8. After each merge, update the status table below with the PR number and the after-numbers.

## Status

| # | Item | Category | Priority | Status |
|---|---|---|---|---|
| PS-0 | Baseline for `/ar`, `/en`, `/login` | measurement | first | done 2026-10-10 |
| PS-1 | Canonical / hreflang on `/` | SEO | high | open |
| PS-2 | Invalid `<dl>` in the landing analytics card | accessibility | high | open |
| PS-3 | Links without an accessible name (mobile) | accessibility | high | open |
| PS-4 | `/` is not edge-cached | performance | high | open |
| PS-5 | Unused JavaScript on `/` (73 KB) + long main-thread tasks (desktop TBT 360 ms) | performance | high | open |
| PS-6 | Render-blocking CSS (570 ms mobile / 90 ms desktop) | performance | medium | closed 2026-10-17 — option 3 (accept); inlining measured worse |
| PS-7 | Legacy JavaScript polyfills (15 KB) | performance | medium | open |
| PS-8 | `llms.txt` / `ai-catalog.json` (agentic browsing 1/4) | agentic | low | open |
| PS-9 | Google indexing (Search Console, sitemap, own domain) | discovery | owner action | open |
| PS-10 | Colour contrast fails on `/en` (not `/ar`) | accessibility | high | open — found by PS-0, not yet investigated |

---

## PS-0 — Baseline for the other public pages

- **Why:** the plan only knows `/`. Fixes PS-1…PS-7 may affect `/ar`, `/en` and `/login` too.
- **Do:** run PageSpeed (the site) on `/ar`, `/en` and `/login`, mobile and desktop. Record the
  scores, metrics and failing audits in this file.
- **If** a page shows a failing audit that is not in this plan, add it as a new PS item. Do not
  fix it inside another item.
- **No code change.**

### Result (2026-10-10, pagespeed.web.dev, Lighthouse 13.5.0)

The API quota was exhausted again; measured on the site. Reports: `/ar` `gey9zslj4f`, `/en` `j5wu7rfmd9`,
`/login` `7jonydg0ll`.

| Page | Form | Perf | A11y | BP | SEO | Agentic | FCP | LCP | TBT | CLS |
|---|---|---|---|---|---|---|---|---|---|---|
| `/ar` | Mobile | 96 | 89 | 100 | 100 | 1/4 | 1.1 s | 2.6 s | 90 ms | 0 |
| `/ar` | Desktop | 99 | 89 | 100 | 100 | 1/4 | 0.4 s | 0.7 s | 60 ms | 0 |
| `/en` | Mobile | 96 | 85 | 100 | 100 | 1/4 | 1.1 s | 2.7 s | 50 ms | 0 |
| `/en` | Desktop | 100 | 89 | 100 | 100 | 1/4 | 0.3 s | 0.6 s | 50 ms | 0 |
| `/login` | Mobile | 98 | 100 | 100 | 100 | 2/4 | 1.2 s | 2.4 s | 10 ms | 0 |
| `/login` | Desktop | 100 | 100 | 100 | 100 | 2/4 | 0.3 s | 0.5 s | 10 ms | 0 |

Failing audits per page (mapped to existing items):
- `/ar`, `/en`: invalid `<dl>` (PS-2); links without a name on mobile (PS-3); render-blocking CSS
  570–580 ms mobile / 80–150 ms desktop (PS-6); unused JS 70–73 KB and 2–4 long tasks (PS-5);
  legacy JS 15 KB (PS-7); one non-composited animation (part of PS-5).
- `/login`: render-blocking CSS 590 ms mobile / 170 ms desktop (PS-6); unused JS **116–118 KB** (PS-5
  should cover `/login` too); legacy JS 15 KB (PS-7). Accessibility 100.
- SEO is 100 on `/ar` and `/en` (canonical/hreflang already correct there — PS-1 is `/` only).
- **New, not in the plan:** `/en` fails colour contrast (mobile and desktop); `/ar` does not → PS-10.

## PS-1 — Canonical / hreflang on `/`

- **Finding:** "The document does not have a valid rel=canonical. It points to another hreflang
  location (`https://eduquest-v2.vercel.app/`)."
- **Evidence (live HTML):** `/` declares `canonical = /en` while the same page lists itself as
  `hreflang="x-default" href="/"`. `/en` declares the same set. So `/` is canonicalised to a
  locale URL while also being the `x-default` alternate.
- **Code:** `src/app/page.tsx` → `marketingMetadata('home', '/')`
  (`src/components/public/marketing-page.tsx`) → `marketingAlternates(path, locale)` in
  `src/i18n/public-routes.ts`. The canonical comes from the request's locale (cookie / default).
- **To verify first:** how `marketingAlternates` builds canonical vs `x-default` for `/`, and
  whether `/` is served by the proxy as-is or rewritten. Also confirm the same pattern on
  `/features`, `/pricing`, `/contact`, `/privacy`, `/terms` (the other marketing paths).
- **Fix direction (decide after verifying):** `/` must not canonicalise to a locale page while it
  is the `x-default`. Either `/` gets `canonical = /` (a language chooser / default page), or `/`
  redirects to a locale URL and stops being indexable. This is an owner decision because it
  changes what Google indexes.
- **Must not change:** the `/ar/…` and `/en/…` canonicals, `sitemap.ts` entries, edge caching,
  and the cookie-free public HTML.
- **Done when:** the PageSpeed SEO audit passes on `/`, the canonical/hreflang tags of every
  marketing page are listed before and after in the PR, and only `/` (and any page with the same
  pattern, listed in the PR) changed.

## PS-2 — Invalid `<dl>` in the landing analytics card

- **Findings:** "`<dl>` does not contain only properly-ordered `<dt>` and `<dd>` groups…" and
  "Definition list items are not wrapped in `<dl>` elements".
- **Code:** `src/components/public/landing.tsx` lines ~425–441: the `<dl>` contains `<div>`
  wrappers, and the recommendation `<dt>` sits inside a `<div class="flex …">` with the
  mode-toggle buttons, so it is no longer a direct `<dt>`/`<dd>` pair.
- **Fix:** restructure only that `<dl>`: each `<dt>`/`<dd>` pair grouped in a `<div>` directly
  under `<dl>` (valid HTML), and the mode buttons moved out of the `<dt>`'s wrapper. Visual result
  identical.
- **To check as well (same pattern, not yet flagged):** the other `<dl>` users —
  `components/public/features-page.tsx`, `components/shared/account-panel.tsx`,
  `app/(auth)/join/[token]/page.tsx`. Inspect them. If any is invalid, record it under "Found along
  the way" and propose it as its own item — do not fix it in PS-2.
- **Must not change:** the card's text, colours, layout or the rule/AI toggle behaviour.
- **Done when:** both audits pass on `/` in mobile and desktop. A before/after screenshot in `ar`
  and `en` shows no visual change.

## PS-3 — Links without an accessible name (mobile only)

- **Finding:** "Links do not have a discernible name". It appears on mobile, not on desktop.
- **To verify first:** open the mobile audit's element list on PageSpeed and record each flagged
  link (selector + file). Likely candidates are icon-only links in the mobile public header or
  footer (`components/public/public-nav.tsx`, `components/public/shell.tsx`), but this is a guess
  until verified.
- **Fix:** add an accessible name (visible text, `aria-label` from the `public` messages in both
  languages, or `aria-hidden` on decorative duplicates) to exactly the flagged links.
- **Must not change:** link targets, prefetch behaviour, layout.
- **Done when:** the audit passes on mobile. New message keys exist in `en` and `ar`
  (`i18n-messages.test.ts` passes).

## PS-4 — `/` is not edge-cached

- **Finding (curl):** `/` answers `X-Vercel-Cache: MISS` with
  `Cache-Control: private, no-cache…` on every request, while `/en` answers `HIT` with
  `Cdn-Cache-Control: public, max-age=300, stale-while-revalidate=86400`.
- **Code:** `withEdgeCache()` in `src/proxy.ts` only covers `/<locale>/…` paths.
- **Depends on PS-1:** if PS-1 makes `/` a redirect, PS-4 is closed with no change. If `/` stays a
  page, it can only be cached when its HTML does not depend on the request's cookie. Today the
  canonical of `/` follows the locale, so caching it as-is could serve one visitor's language to
  everyone. So PS-1 is decided first.
- **Must not change:** caching of signed-in pages, RSC/prefetch responses, or any response that
  sets a cookie (the existing rules in `withEdgeCache`).
- **Done when:** `/` answers `HIT` on the second signed-out full page load, and it serves the same
  HTML for `ar` and `en` visitors (or the plan's PS-1 decision makes that moot).

**Measured (2026-10-17) — no change for now.** `/` renders the cookie's language, and the CDN cannot
key on the cookie, so the only safe way to cache it is a redirect to `/<locale>`. A redirect is a
proxy round trip of its own. Owner's link, 6 samples each, median TTFB: `/` today ≈ 1.8 s, a 307
from the proxy ≈ 1.3 s, `/ar` from the edge ≈ 1.1 s — redirect + HIT ≈ 2.4 s, slower than today.
On a fast link the gain would be ~0.15 s. Every internal link already points at `/ar` or `/en`;
`/` is only reached by typing the bare domain. Revisit together with PS-1 (an owner SEO decision).

## PS-5 — Unused JavaScript on `/` + long main-thread tasks

- **Findings:** unused JS 73 KB (`2p3ep6xv0yt5f.js` 46 KB unused of 74, `0cmvg450bcbw3.js` 27 of 64).
  Desktop: TBT 360 ms, JS execution 1.5 s, longest task chain 703 ms (`2p3ep6xv0yt5f.js`
  161 ms, `1g6lhoqq95-zx.js` 150 ms, the HTML document 97 + 91 ms, `1_40wurnzv_b7.js` 82 ms).
  This is the main reason for the desktop score of 82.
- **To verify first:** map each chunk to its modules (`next build` output / source maps, or
  `ANALYZE` if available without adding a dependency), and list which client components on `/`
  pull them in (`components/public/landing.tsx` and its interactive demos are the likely source).
- **Fix direction:** load below-the-fold interactive parts of the landing page on demand
  (dynamic import / render when visible) so they are not part of the first load. No feature
  removed, no visual change.
- **Must not change:** the "no global prefetch change" and "no streaming / loading UI" decisions
  in `CLAUDE.md` and `PERFORMANCE_CONTRACT.md`. Adding a dependency (e.g. a bundle analyser) needs
  owner approval.
- **Done when:** desktop TBT ≤ 200 ms and the unused-JS saving on `/` drops by at least half,
  with mobile performance not below 97.

## PS-6 — Render-blocking CSS

- **Finding:** `2lzn-sl7rjp03.css` (22.4 KB, 210 ms) and `3tsh3ep-6tqmj.css` (3.1 KB, 50 ms) block the
  first render. Estimated saving: 570 ms mobile, 90 ms desktop.
- **To verify first:** what each file contains (global Tailwind CSS + tokens vs the fonts' CSS)
  and what options Next 16 offers (e.g. inlining CSS) without new dependencies. Record the options
  in this file.
- **Fix:** only after the owner picks an option. A `next.config.ts` change is a build-wide change
  and needs approval (rule 7).
- **Must not change:** the D3 font stack (`font-stack.test.ts`), the theme boot script, edge caching.
- **Done when:** the audit's estimated saving drops on mobile, and FCP/LCP do not get worse.

### Verification (2026-10-10, live `/ar`)

Two stylesheets, both from the root layout, so every page (public and signed-in) loads both:

| File (hash changes per deploy) | Raw | Gzip | Content |
|---|---|---|---|
| `3y6d6rie8nom6.css` | 12.7 KB | 1.6 KB | 36 `@font-face` rules (IBM Plex Sans Arabic + Plex Sans, `next/font`), `font-display: swap` |
| `28xezojf_h4iz.css` | 153 KB | 23 KB | Tailwind v4 output + design tokens for the **whole app** (every route group, lesson builder, proctoring…) |

The block is not the size so much as one extra round trip on the throttled mobile profile. Real
returning users have both files cached (`immutable`).

Options (no new dependency in any of them):
1. **`experimental.inlineCss: true`** (`next.config.ts`, documented in
   `node_modules/next/dist/docs/…/inlineCss.md`). Removes the round trip, so the 570 ms finding goes
   away. Cost: ~25 KB gzip added to **every** HTML response and no cross-page CSS cache; the flag is
   experimental. Public pages are edge-cached, so the server cost is small; must be checked that the
   theme boot script and CSP (`style-src 'unsafe-inline'` already allowed) still work.
2. **Shrink the global CSS** (find what makes 153 KB — e.g. Tailwind scanning non-UI sources,
   unused utilities, legacy palette remaps in `globals.css`) and keep the `<link>`. Smaller gain,
   no behaviour change, more work; can be done before or with option 1.
3. **Accept it.** Lab-only cost on a first visit; FCP is already 1.1 s mobile, score 96.

Recommendation: 2 first (measure what 153 KB is made of), then decide on 1 with numbers.

**Option 2 measured (2026-10-10):** `@layer utilities` is 127 KB of the 153 KB (theme 6.6 KB, base 3.7 KB,
tokens/remaps ≈ 4 KB). 1 507 utility classes, of which ≈ 40 are not found in `src/` (the other ~100
"misses" are escaping/number artefacts of the scan) — dead code is a few KB at most. The largest
groups are `bg-*` 16 KB, `border-*` 11 KB, gradients (`from/via/to`) ≈ 14 KB, `shadow-*` 4 KB,
`backdrop-*` 3 KB: mostly legacy patterns the design ratchet already shrinks over time. Conclusion: no
quick, safe CSS diet worth a PR here — the size falls naturally as D3 migration removes raw palette,
gradients and blur. The remaining decision is option 1 (inline) vs option 3 (accept).

**Option 1 measured (2026-10-17) — rejected.** Same commit (main 10aa2b1) built twice locally,
`next start`, gzip sizes of the HTML document:

| Page | `<link>` (today) | `inlineCss: true` | Change |
|---|---|---|---|
| `/ar` | 41 KB | 117 KB | +76 KB |
| `/login` | 14 KB | 90 KB | +76 KB |
| `/demo/student` | 29 KB | 105 KB | +76 KB |

The CSS is 25 KB gzip as files, but inlined it lands twice (the `<style>` tag and the RSC payload,
as the Next docs warn), so every full page load grows by ~76 KB. On the owner's link (230 ms ping,
~1.45 Mbps) that is ~0.4 s more transfer on every load, against one saved round trip (~0.23 s) on a
first visit only; returning students and teachers lose the cached stylesheet. **Decision: option 3,
keep the `<link>`.** Revisit only if the global CSS shrinks a lot (D3 migration).

## PS-7 — Legacy JavaScript polyfills

- **Finding:** `1g6lhoqq95-zx.js` ships 15.4 KB of polyfills for `Array.prototype.at`, `flat`,
  `flatMap` and `Object.fromEntries`, which every supported browser already has.
- **To verify first:** where Next 16 takes its browser targets from (`browserslist` in
  `package.json` / `.browserslistrc` — neither exists today), and whether those polyfills come from
  Next itself or from a dependency.
- **Fix:** only after verifying, and with owner approval (it changes which browsers are
  supported). Record the target list that will be set.
- **Done when:** the audit passes or the saving drops, with no runtime error in the supported
  browsers.

## PS-8 — `llms.txt` / `ai-catalog.json` (agentic browsing 1/4)

- **Finding:** "llms.txt does not follow suggestions", "ai-catalog.json schema invalid",
  "accessibility tree not well-formed".
- **Evidence:** `/llms.txt` and `/.well-known/ai-catalog.json` answer `307` (redirected by the
  proxy, most likely to `/login`). Neither file exists.
- **Owner decision first:** whether the platform wants to be described for AI agents at all.
  If yes, add a static `public/llms.txt` (and the catalog only if a valid schema is agreed), and make
  sure the proxy serves them without a redirect. If no, record the decision here and close the item.
- **The "accessibility tree" part** is expected to improve with PS-2 and PS-3. Re-check after them.

## PS-9 — Google indexing (owner action, not code)

- **Finding:** searching Google for `eduquest-v2.vercel.app` returns other "eduquest" sites, not
  this one. There is no CrUX data.
- **Steps (owner):** add the site to Google Search Console, submit `/sitemap.xml` (already generated
  by `src/app/sitemap.ts`), and consider a custom domain instead of `*.vercel.app`.
- **Code impact:** only if a custom domain is added (`NEXT_PUBLIC_APP_URL` / `siteUrl()`), as a
  separate item.
- **Do after PS-1**, so Google indexes the corrected canonical tags.

---

## Found along the way (not fixed — each becomes its own item if approved)

- (empty)
