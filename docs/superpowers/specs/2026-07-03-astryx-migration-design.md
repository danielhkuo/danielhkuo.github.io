# Migrate the portfolio to the Astryx design system (chocolate theme)

**Date:** 2026-07-03
**Status:** Approved design — ready for implementation plan

## Goal

Replace the site's bespoke "kami / parchment" design with the [Astryx](https://github.com/facebook/astryx)
design system, adopting Astryx components **and** its stock **chocolate** theme
(warm brown tones, cozy beige; Fraunces + Albert Sans type). The site should look
noticeably like an Astryx-built site, not a re-skin of the old design — with one
deliberate exception: the interactive terminal keeps its Apple-terminal look.

This is a full visual redesign of a small static site (Next.js 16, React 19,
static export to GitHub Pages, ~13 components, ~1,800 lines), not a re-plumbing
that preserves the old look.

## Decisions (locked)

- **Theme:** `@astryxdesign/theme-chocolate`.
- **Terminal:** Keep the custom `Terminal` subsystem and the decorative hero
  "`$ whoami`" panel. They stay a **dark, monospace, Apple-terminal aesthetic**.
  Only reconcile their tokens so they sit cleanly beside the new theme — no
  structural rewrite. Everything *around* them adopts chocolate.
- **Dark mode:** Keep the manual light/dark toggle (nav + terminal `theme`
  command), but wire it to Astryx's `<Theme mode>` instead of the old `.dark`
  class. Default mode is `system` (follows OS).
- **Tailwind:** Keep Tailwind v4 as an override layer, backed by Astryx tokens
  via Astryx's `tailwind-theme.css` (utilities like `bg-surface`, `text-primary`,
  `rounded-lg` resolve to Astryx tokens). No raw hex/px in new component code.

## Constraints from the existing project

- **Static export:** `next.config.ts` sets `output: "export"` and
  `images.unoptimized: true`. All theme wiring must be SSR/SSG-safe and must not
  regress the pre-paint no-flash behavior.
- **No-flash today:** `layout.tsx` runs a blocking inline script that sets the
  `.dark` class on `<html>` before paint from `localStorage`/OS preference.
- **Build-time data:** `fetchPinnedRepos()` runs at build (SSG); the project data
  flow and the JSON-serializable slice passed to the terminal are unchanged.
- **Third-party logic to preserve verbatim:** web3forms submission + hCaptcha in
  `ContactForm`, the GitHub fetch in `lib/github.ts`, scroll-spy in `HoverMenu`,
  `useSyncExternalStore` patterns in `theme.ts`/`LiveTime`.

## Architecture: theme wiring (recommended approach A)

Use the **pre-built CSS** path for SSR/SSG safety (no runtime style injection):

- Import `@astryxdesign/theme-chocolate/built` (theme object) plus its
  `theme.css`, alongside `@astryxdesign/core/reset.css` and
  `@astryxdesign/core/astryx.css`.
- Add a small `"use client"` `AstryxThemeProvider` that wraps `children` in
  `layout.tsx`. It reads the persisted mode from `localStorage`, renders
  `<Theme theme={chocolateTheme} mode={mode}>`, and exposes the toggle through
  the rewritten `theme.ts`.
- Rewrite `lib/theme.ts` so `getTheme`/`setTheme`/`useThemeMode` drive Astryx's
  mode (whatever attribute/class Astryx uses) instead of toggling `.dark`. Keep
  the `useSyncExternalStore` binding and the custom-event mechanism so the nav
  and terminal `theme` command stay in sync.
- Keep an inline pre-paint script in `layout.tsx`, updated to set **whatever
  attribute/class Astryx's mode uses** (resolved in Phase 1) so there is no flash.

Rejected — **Approach B (runtime injection):** default `@astryxdesign/theme-chocolate`
import with `<Theme mode="system">`. Simpler imports, but Astryx docs note weaker
SSR support and it injects styles at runtime → theme flash and a perf hit on a
static, perf-tuned site.

## Component mapping

Rules (per Astryx agent guidance): components do layout/spacing — **no `<div>` or
raw HTML for layout**, **no `style={{}}`**. Use `VStack`/`HStack`/`Grid`/`Stack`/
`Card`/`Container` etc.; values come from design tokens; brand/accent via the
theme, never by overriding `--color-*` in `:root`. Discover exact component names
and props with the CLI (`astryx build`, `astryx component <Name>`,
`astryx template <name>`) rather than guessing.

| Current | → Astryx target |
|---|---|
| `page.tsx` — `<main>`, sections, grids, spacing | `Container`/`VStack`/`HStack`/`Grid`/`Stack` + `Card`; keep section `id`s (`#about`, `#work`, `#contact`) and scroll anchors for the nav |
| `Masthead` hero | `Card` + `Grid` + `Heading`/`Text` + `Button`; headshot via `next/image` (grayscale/sepia treatment preserved) |
| `HoverMenu` floating nav | Keep the fixed floating-pill shell + `IntersectionObserver` scroll-spy + terminal-open dispatch + theme toggle; rebuild the inner controls with Astryx `Button`/links and tokens |
| `ProjectCard` | `Card` + `Heading`/`Text` + `Badge`/`Tag` for meta chips + `Button` for repo/live links; language-mix bars via Astryx `Meter`/progress primitive (or a tokened bar if none fits) |
| `ContactForm` | `TextField`/`TextArea`/`Button` for the fields and submit; **web3forms fetch + hCaptcha + validation logic unchanged** (hCaptcha `theme` prop keeps following the mode) |
| `LiveTime`, `CopyButton`, `LocationMap`, `ShellHint` | Logic unchanged; restyle wrappers with Astryx tokens/components |
| `Terminal` subsystem + hero "`$ whoami`" panel | **Keep** dark Apple-terminal look and monospace; only reconcile tokens so it coexists. No structural rewrite. |

## Fonts

Chocolate uses **Fraunces** (display) + **Albert Sans** (body). Load both via
`next/font/google` and feed the families into the theme (theme packages reference
font families but do not bundle font files). Remove the old Charter/serif and
JetBrains Mono declarations except the mono stack the terminal still needs.

## globals.css

Strip the large bespoke token blocks (`--bg`, `--accent`, spacing/radius/type
scales, Tailwind/legacy aliases). Keep:

- Tailwind import + Astryx CSS imports + Astryx `tailwind-theme.css`.
- The terminal **"ink" panel tokens** (`--panel-ink`, `--panel-ink-2`,
  `--panel-on`, `--panel-accent`) — the terminal stays dark in both modes.
- Minimal global resets not covered by Astryx's `reset.css`.

Any bespoke utility classes still referenced (`paper-panel`, `capsule-shell`,
`kami-tag`, `caps-label`, `font-display`, etc.) are removed once their consumers
are migrated; audit for stragglers in the cleanup phase.

## Phased implementation

0. **Setup** — install `@astryxdesign/core` + `@astryxdesign/theme-chocolate`;
   add the `astryx` npm script (`node node_modules/@astryxdesign/cli/bin/astryx.mjs`);
   import `reset.css`, `astryx.css`, theme `theme.css`.
1. **Theme + fonts + no-flash** — `AstryxThemeProvider`, `theme.ts` rewrite,
   resolve the exact mode mechanism (`astryx component Theme`), matching pre-paint
   script, load Fraunces + Albert Sans.
2. **Page shell** — rebuild `page.tsx` sections on Astryx layout primitives,
   preserving section ids and the SSG data flow.
3. **Components** — Masthead, HoverMenu, ProjectCard, ContactForm, then the small
   components.
4. **Terminal reconcile** — token cleanup only, verify dark look in both modes.
5. **Cleanup** — prune `globals.css`, remove dead bespoke utility classes, verify
   the Tailwind override layer resolves to Astryx tokens.
6. **Verify** — `npm run build` (static export succeeds), `npm run lint`,
   `npm run a11y` + `npm run contrast`, and a visual pass in light and dark.

## Open item (resolve in Phase 1)

Exact mode mechanism Astryx uses (class vs. `data-*` attribute vs. media query) —
required to write a correct no-flash pre-paint script. Determined by inspecting
`astryx component Theme` (and the built theme CSS) once `@astryxdesign/core` is
installed.

## Success criteria

- Site builds and statically exports with no errors; deploys unchanged.
- Chocolate theme is visibly applied across all non-terminal UI, in light and dark.
- Manual light/dark toggle works from both the nav and the terminal `theme`
  command, persists across visits, and produces no theme flash on load.
- Terminal (interactive + hero panel) retains its dark Apple-terminal look.
- web3forms contact submission + hCaptcha still work; GitHub project data still
  renders at build time.
- `lint`, `a11y`, and `contrast` checks pass.
- No `<div>`/`style={{}}` for layout in migrated components; no raw hex/px;
  no `--color-*` overrides in `:root`.
