# CLAUDE

Project-specific guidance for AI coding agents.

## What this site is becoming

danielhkuo.github.io is being rebuilt, on `feat/dragon-world`, as a world you explore on dragonback.

The title screen at `/` is the site's own terminal (`src/components/terminal/`), floating over the live world. Below it are an "Enter world" button and small links to the other ways in. It is built (`src/components/title/`, design `docs/superpowers/specs/2026-11-20-title-terminal-design.md`). The four ways in:

- **Minimal version**: `/minimal`, the whole site as one plain page dressed as nano viewing `daniel.txt`. It is text only, complete without JavaScript, quick on phones, and readable by screen readers and search engines. `/recruiter` forwards to it, and phones default to it.
- **Enter world**: fly a dragon over a procedural realm. The projects are kept in one projects hall beside the home town. After the first-flight lesson the visitor may join an opt-in "get to know Daniel" quest to five things across the world, led by an arrow at the screen's edge (`docs/superpowers/specs/2026-11-19-story-destinations-design.md`). The other landmarks are scenery; the abbey also opens the terminal.
- **agents.md**: `agents.md` and `llms.txt` at the site root, for AI agents.
- **Settings**: the world's options.

Never call any of these the "AI version".

The site is a static export (`output: "export"`) deployed to GitHub Pages. There is no server and no custom response headers, so there is no cross-origin isolation and no `SharedArrayBuffer`.

Specs and plans live in `docs/superpowers/specs/` and `docs/superpowers/plans/`.

## One source of content

- **Profile and links:** `src/components/terminal/content.ts`.
- **Projects:** one Markdown file per project in `projects/`, read at build time by `src/lib/projects.ts`. The owner
  edits them in the browser, on github.com or with Pages CMS (`.pages.yml`).

`/minimal`, the terminal's filesystem, the agent files and the world's Codex are all generated from these two sources. Never hand-copy content into any one of them.

## The world (game layer)

- **Software pixel renderer.** TypeScript writes a low-resolution RGBA buffer, which is scaled up with hard pixels. There is no WebGL scene graph, no three.js, and no meshes or polygons.
- **What it draws.** Terrain is a procedural heightmap drawn as stacked columns. The dragon and the towers are sprite stacks. The default camera is overhead.
- **Deterministic.** Everything derives from a seed through our own seeded RNG. Never call `Math.random()` in world code.
- **Off the main thread.** Baking, the expensive part, runs in a pool of workers. The main thread only composes baked chunks through the palette (about 2 ms a frame), so menus never wait on a bake. Sound runs in a worker and an audio worklet, and stays silent until the visitor's first gesture.
- **Streamed.** The shipped world (10240 cells, seed 3) is a core file plus 64 region files under `public/world/<id>/`. `public/world/current.json` names the current world, and workers fetch the regions near the flier. The coordinator builds and ships worlds.
- **Phones.** Touch flight with its own controls. Phones open the minimal version by default.
- **Our own code.** The Forge demo that inspired the technique is reference only. Never copy its source.
- **Tuned in the bench.** The look is tuned on the tuning bench (seed and parameter sliders, screenshots) before it ships. Report any visual change with a screenshot.

## Art direction

- **Ink & Glyph.** Cream paper grain. The land in light washes with inked edges and hatched cliffs. IM Fell English type. Vermilion, teal and gold accents.
- **Title screen.** The site's terminal window over the live world.
  - Nothing fades: things arrive by steps, slides, presses and hard cuts.
  - "Enter world" minimizes the window into the world the way macOS does.
  - Any symbol is drawn as pixel art, never as thin line icons.
- **Gothic, church-built ornament only:** rose windows, pointed arches, quatrefoils, knotwork, rubricated ¶, illuminated capitals, and crosses on spires. No pagan or occult motifs: no magic circles, runes, pentagrams or hexagrams, and no "grimoire" or "familiar".
- **Original work only.** No names, logos, characters or art from NieR, Witch Hat Atelier, Frieren, Tolkien or any other property. Inspiration is fine; copies are not. The story borrows *The Little Prince*'s shape and tone only, none of its characters, lines or art.

## Where Astryx applies

The Astryx rules below govern the contact form and ordinary page chrome.

They do not govern the game layer or the terminal-styled pages: the renderer, title screen, HUD, Codex, the terminal and `/minimal`. Those are hand-drawn canvas, SVG and CSS by design. Keep their styles to themselves, and use theme tokens for any colour they share with ordinary pages.

## How we work

- **Roadmap.** `docs/superpowers/roadmap.md` is the one list of next steps, ideas and backlog. Update it in the same
  branch as the work that changes it.
- **Branches.**
  - `feat/dragon-world` is the integration branch until the world ships to `main`.
  - For now `world/bigmap` collects finished work below it. Session branches (named by the app,
    `claude/<topic>-<id>`) merge into `world/bigmap` with `git merge --no-ff` once tests, types, lint and e2e pass and
    any visual change has been judged on renders.
  - The owner decides when `world/bigmap` merges into `feat/dragon-world`.
  - Other work gets its own branch: `world/<topic>`, `fix/<topic>` or `docs/<topic>`.
  - Delete a branch after its merge.
  - Nothing is pushed without the owner's say-so.
- **Coordination.** One coordinator session runs the side sessions, merges their branches and ships worlds. Sessions
  send their questions to it, and it brings the owner only the decisions that are theirs, a few at a time, each with a
  recommendation.
- **Who builds.** Claude Opus runs every session; Fable has not been used since 2026-11-19.
  - Cursor builds whatever tests or a precise brief can pin. The session writes the brief and the failing tests, then
    runs `cursor-agent -p --force --model grok-4.7-xhigh "<brief>"` in its own worktree. Use the CLI, not the
    cursor-delegate plugin, whose state is shared across worktrees.
  - Claude reviews every diff, runs the checks and judges the renders. It implements only where Cursor fails twice, or
    where the work is judged by eye. Art is never Cursor's alone: the owner rejected Cursor-built clouds on 2026-11-18.
  - Creative work gets a hard audit before the owner sees it: Claude's own review on renders, plus critics held to the
    rules below. The owner spot-checks.
- **Critic rules** (owner, 2026-11-21: critics must be constructive, and must not loop).
  - Before any critic runs, write a short rubric from the brief: three to five criteria, each with what passing looks
    like.
  - A critic scores each criterion. For every one that fails, it gives a concrete fix: what to change, where, and why
    that would pass. A complaint without a fix doesn't count.
  - A later round is given the earlier findings and what was changed. It checks whether each fix worked and doesn't
    reopen settled points. A new point is allowed only if it is severe, and is marked as new.
  - At most two critic rounds on one piece. Then Claude decides on the renders, or brings the best version and the open
    points to the coordinator.
  - No yes-or-no "spot the odd one" tests: they say nothing about how to improve.
  - When critics contradict each other, choose one with a stated reason; don't chase both.

## Commands

- `npm run dev`: dev server (Turbopack). If CSS looks stale, check the served file and clear `.next/dev`.
- `npm test`: unit tests (`node --test`, `src/**/*.test.ts`).
- `npm run lint`, `npm run a11y`, `npm run doctor`: lint, axe accessibility check, React Doctor.
- `npm run build`: static export to `out/`. Reads `projects/`; with `GITHUB_TOKEN` it adds each repo's stars and languages.
- `npm run e2e`: builds, then runs the Playwright suite (`e2e/`) in Chromium and WebKit. It must pass without
  `GITHUB_TOKEN`. `npm run test:minimal` runs only the `/minimal` projects, against the `out/` already built.
- `npm run test:mobile`: phone flight tests (Puppeteer, touch emulation).
- `npm run world:build -- --seed 3 --n 10240 --cache`: builds the shipped world into `public/world/`.

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
