# CLAUDE

Project-specific guidance for AI coding agents.

## What this site is becoming

danielhkuo.github.io is being rebuilt, on `feat/dragon-world`, as a world you explore on dragonback. A game-style title menu offers four ways in:

- **The Recruiter**: the whole site as one plain HTML page. Text only, quick on phones, readable by screen readers and search engines.
- **The Wayfarer**: fly a dragon over a procedural realm. Each tower is a project, and landing on it opens that project's entry.
- **The Artificer**: the existing terminal (`src/components/terminal/`), housed in the first tower, which is also About Me.
- **The Herald**: `agents.md` and `llms.txt` at the site root, for AI agents.

The site is a static export (`output: "export"`) deployed to GitHub Pages. There is no server and no custom response headers, so there is no cross-origin isolation and no `SharedArrayBuffer`.

Specs and plans live in `docs/superpowers/specs/` and `docs/superpowers/plans/`.

## One source of content

- **Profile and links:** `src/components/terminal/content.ts`.
- **Projects:** the six pinned GitHub repos, fetched at build time by `src/lib/github.ts`.

The towers, the Recruiter page, the terminal's filesystem and the agent files are all generated from these two sources. Never hand-copy content into any one of them.

## The world (game layer)

- **Software pixel renderer.** TypeScript writes a low-resolution RGBA buffer, which is scaled up with hard pixels. There is no WebGL scene graph, no three.js, and no meshes or polygons.
- **What it draws.** Terrain is a procedural heightmap drawn as stacked columns. The dragon and the towers are sprite stacks. The default camera is overhead.
- **Deterministic.** Everything derives from a seed through our own seeded RNG. Never call `Math.random()` in world code.
- **Off the main thread.** Baking, the expensive part, runs in a pool of workers. The main thread only composes baked chunks through the palette (about 2 ms a frame), so menus never wait on a bake.
- **Our own code.** The Forge demo that inspired the technique is reference only. Never copy its source.
- **Tuned in the bench.** The look is tuned on the tuning bench (seed and parameter sliders, screenshots) before it ships. Report any visual change with a screenshot.

## Art direction

- **Ink & Glyph.** Cream paper grain. The land in light washes with inked edges and hatched cliffs. IM Fell English type. Vermilion, teal and gold accents.
- **Title screen.** A stained-glass rose window, quatrefoil bullets that fill red when selected, and inked card borders with flourished corners.
- **Gothic, church-built ornament only:** rose windows, pointed arches, quatrefoils, knotwork, rubricated ¶, illuminated capitals, and crosses on spires. No pagan or occult motifs: no magic circles, runes, pentagrams or hexagrams, and no "grimoire" or "familiar".
- **Original work only.** No names, logos, characters or art from NieR, Witch Hat Atelier, Frieren, Tolkien or any other property. Inspiration is fine; copies are not.

## Where Astryx applies

The Astryx rules below govern the Recruiter page, the contact form and ordinary page chrome.

They do not govern the game layer: the renderer, title menu, HUD, Codex and rose window. That layer is hand-drawn canvas, SVG and CSS by design. Keep its styles inside the game layer, and use theme tokens for any colour it shares with the Recruiter page.

## Commands

- `npm run dev`: dev server (Turbopack). If CSS looks stale, check the served file and clear `.next/dev`.
- `npm test`: unit tests (`node --test`, `src/**/*.test.ts`).
- `npm run lint`, `npm run a11y`, `npm run doctor`: lint, axe accessibility check, React Doctor.
- `npm run build`: static export to `out/`. Needs `GITHUB_TOKEN` for real pinned repos.

<!-- ASTRYX:START -->
Astryx v0.6.2 · 164 components
CLI: run every command as `npx astryx <cmd>` (shown below as `astryx ...`).

SETUP (once, in your app entry e.g. main.tsx) — without these, components render unstyled:
  import "@astryxdesign/core/reset.css";
  import "@astryxdesign/core/astryx.css";

WORKFLOW — discover, don't guess. Before writing UI:
1. `astryx build "<idea>"` — START HERE: returns a kit (closest [page] + [block]s + [component]s). No args = full playbook.
2. `astryx template <name> [--skeleton]` — scaffold the [page]/[block]s it named, or study their layout. Templates are reference code.
3. `astryx component <Name>` — props + examples for every component you use.

RULES:
- No <div> — components do all layout/spacing, page frame included.
- Frame first: read `astryx docs layout` before writing any page or screen — page frame, region widths, breakpoint behavior.
- Dense data = rows (Table, List/Item), never Card-wrapped list items; Card is for standalone widgets. Status = StatusDot/Token; Badge = counts only.
- Custom styling: component props first; else Tailwind utilities backed by tokens (bg-surface, text-primary, rounded-lg) via tailwind-theme.css. No raw hex/px.
- Tokens for every value (`astryx docs tokens`). Brand/accent belongs in the theme (`astryx theme list` / `theme add <slug>`, or `astryx theme template` for a custom one) — never override --color-* in :root.
- SELF-CHECK before you finish: re-read the file and replace any style={{…}}, raw <div>/<span> layout, imported .css/@apply, or hardcoded/arbitrary value (e.g. bg-[#fff], p-[13px]) with the component or a token-backed utility. If unsure a component/prop exists, run `astryx component <Name>` / `astryx search "<thing>"`; don't hand-roll CSS.

MORE CLI:
  search "<query>"   find any component / hook / doc / template / block
  component --list   164 components by category
  template --list    page + block recipes
  docs <topic>       browser-support, cli-integrations, color, elevation, getting-started, icons, illustrations, internationalization, layout, migration, motion, principles, shape, spacing, styling-libraries, styling, theme, tokens, typography, working-with-ai
  swizzle <Name>     eject component source for deep customization
  upgrade --apply    run after any Astryx or integration dependency bump
<!-- ASTRYX:END -->
