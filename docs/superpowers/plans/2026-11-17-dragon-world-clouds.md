# Dragon world: clouds. Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Painted clouds over the realm in three art styles (watercolour, storybook, layered), which the owner compares on
the real world and picks from.

**Architecture:**
- At load, a seeded generator makes cloud **shapes** (a coverage mask and a dome height per pixel), and a **painter**
  turns each shape into a **sprite**. A seeded **field** scatters clouds over the torus and drifts them with the wind.
- Each frame, `sky.draw` copies the sprites in view over the frame in two passes: low clouds before the flier, banks and
  high streaks after it.
- The three styles are three painters behind one interface, so they build in parallel lanes without touching each other.

**Tech Stack:** TypeScript shared by Node 26 and the browser, `node --test`, the existing world runtime.

**Spec:** `docs/superpowers/specs/2026-11-17-dragon-world-clouds-design.md`

## Global Constraints

- All work on branch `world/clouds`; Cursor lanes branch from it and merge into it (CLAUDE.md, "How we work").
- Deterministic: shapes and the field derive from the world seed through `rngFor` (src/world/core/rng.ts); never
  `Math.random()`. The sky at time t is the same for every visitor.
- Main-thread cost of `sky.draw` (both passes) under 1 ms per frame, p95, unthrottled, on the flight page.
- Low cloud covers 15–35 % of a view on average; at most one bank on screen; about one bank per 20–40 s of cruising
  (1,200–2,400 cells at 60 cells/s).
- Wind about 3 cells a second (2–4), direction from the seed; high streaks at least 1.5× faster.
- Colours from the house palette: cream lit tops, cool blue-grey bellies, the ink colour; never vermilion or gold.
- No change to world.bin, the bake or the flight model. Game layer: hand-written, not Astryx.
- `.ts` suffixes on relative imports, no enums, no parameter properties, no path aliases inside src/world.

## Review Focus

1. Clouds crossing the world's edge (x or y = 0) draw without a seam or a jump: `a cloud across the seam is drawn on
   both sides` (Task 1).
2. A page left open for hours: positions stay exact, with no float creep: `drift after a million seconds wraps cleanly`
   (Task 1).
3. A view whose rectangle has negative coordinates (just past the y wrap) still draws its clouds: covered by the seam test
   with `rect.y < 0` (Task 1).
4. The most overcast view stays inside the frame budget: `the busiest view draws in under 3 ms in Node` (Task 1).
5. The flier is never hidden for long: `never two banks on one screen` and `about one bank every 1,200–2,400 cells`
   (Task 1).

---

### Task 1: Sky system with a plain painter, page hook and contact sheet

**Files:**
- Create: `src/world/sky/shapes.ts`, `src/world/sky/field.ts`, `src/world/sky/sprite.ts`, `src/world/sky/sky.ts`,
  `src/world/sky/styles.ts`, `src/world/sky/paint/plain.ts`
- Create stubs (each `export const paint<Name>: Painter = paintPlain;`, rewritten by Tasks 2a–2c):
  `src/world/sky/paint/watercolour.ts`, `src/world/sky/paint/storybook.ts`, `src/world/sky/paint/layered.ts`
- Create: `src/world/cli/clouds.ts`, `scripts/world-clouds.ts`; Modify: `package.json` (script `world:clouds`)
- Modify: `src/app/world/Flight.tsx`
- Test: `src/world/sky/shapes.test.ts`, `src/world/sky/field.test.ts`, `src/world/sky/sky.test.ts`

**Interfaces (produced):**
- `shapes.ts`:
  - `type CloudKind = "heap" | "wisp" | "bank" | "streak"`
  - `interface CloudShape { kind: CloudKind; w: number; h: number; cover: Float32Array; dome: Float32Array }`. Both
    arrays are w·h, row-major, 0–1.
  - `SHAPE_SIZES`: heap w 40–140, h 18–60; wisp w 60–200, h 8–24; bank w 120–220, h 50–110; streak w 100–260, h 3–8.
  - `makeShapes(seed: number, counts: Record<CloudKind, number>): CloudShape[]`, ordered by kind, then index.
  - `SHAPE_COUNTS = { heap: 18, wisp: 8, bank: 6, streak: 8 }` (about 40, per the spec), used by `createSky`.
- `sprite.ts`:
  - `interface Sprite { w: number; h: number; rgba: Uint32Array; alpha: Uint8Array }`
  - `interface CloudInks { lit: number; shade: number; ink: number }`, packed RGBA.
  - `MIDDAY_INKS`
  - `type Painter = (shape: CloudShape, inks: CloudInks, seed: number) => Sprite`
- `paint/plain.ts`: `paintPlain: Painter`, with rgba = lit everywhere and alpha = round(255·cover).
- `styles.ts`:
  - `interface CloudStyle { name: "watercolour" | "storybook" | "layered"; paint: Painter; high: boolean; lowAlpha: number; bankAlpha: number }`
  - `STYLES: Record<CloudStyle["name"], CloudStyle>`, where only `layered` has `high: true`.
  - `styleFrom(query: string | null): CloudStyle`, defaulting to watercolour.
- `field.ts`:
  - `type CloudLayer = "low" | "bank" | "high"`
  - `interface Cloud { shape: number; x: number; y: number; layer: CloudLayer; flip: boolean }`
  - `interface SkyField { n: number; clouds: Cloud[]; wind: { x: number; y: number }; highWind: { x: number; y: number } }`
  - `LOW_ALT = 40`, `BANK_ALT = 60`, `HIGH_ALT = 140`, each in units of screen offset.
  - `makeField(seed: number, n: number, shapes: readonly CloudShape[], high: boolean): SkyField`
  - `cloudAt(field: SkyField, c: Cloud, t: number): { x: number; y: number }`: the drifted position, wrapped into
    [0, n), exact for large t.
- `sky.ts`:
  - `interface Sky { draw(out: Uint32Array, rect: ViewRect, t: number, pass: "below" | "above"): void }`
  - `createSky(seed: number, n: number, style: CloudStyle): Sky`. The `below` pass draws low clouds at
    `style.lowAlpha`. The `above` pass draws banks at `style.bankAlpha`, then high streaks if `style.high`. A sprite's
    top-left is at screen `(x − rect.x, 0.8·y − alt − rect.y)`, nearest torus image, mirrored when `flip`.
    `out = mix(out, rgba, alpha · layerAlpha / 255²)` per channel.
- **Page:** in `Flight.tsx`, `createSky(manifest.seed, data.n, styleFrom(new URLSearchParams(location.search).get("clouds")))`;
  each frame `view.frame` → `sky.draw(…, "below")` → `drawFlier` → `sky.draw(…, "above")`, with t in seconds.
- **Contact sheet:** `npm run world:clouds` reads `public/world/current.json` and decodes `world.bin` with
  `decodeWorld`. For each style it draws four views (the manifest start, the town site, the highest ground in the
  world, open sea 600 cells off the start) through `createView`, the sky and a stand-in kite, plus one frame with a
  bank over the kite. It writes `.cache/world-clouds/sheet.png` (styles as columns, views as rows, 2× nearest) and
  each frame separately.

- [ ] **Step 1: Write the failing tests** (Claude writes and commits them):
  - `shapes.test.ts`:
    - the same seed gives identical shapes, and another seed different ones;
    - sizes lie inside SHAPE_SIZES;
    - cover is 0 on the 1-px border;
    - heaps and banks cover ≥ 25 % of their box above 0.5;
    - heaps sit on a flat base: the lowest covered row is at least half as wide as the widest row, and the topmost
      covered row is narrower than half of it;
    - wisps and streaks are at least 4× wider than tall;
    - dome is 0 where cover is 0 and peaks inside the shape;
    - no two shapes of a kind are identical.
  - `field.test.ts`:
    - deterministic;
    - wind speed 2–4 cells/s, and high wind ≥ 1.5× that;
    - over 200 seeded views of 400×281 cells, mean low-cloud cover (cover > 0.5) is 15–35 %; at least 10 % of views are
      under 5 % (clear), and at least 10 % over 40 % (overcast);
    - never two banks on one screen;
    - about one bank every 1,200–2,400 cells, along 40 straight flights;
    - drift after a million seconds wraps cleanly, into [0, n);
    - the high layer is empty unless asked for.
  - `sky.test.ts`:
    - a low cloud over the view's middle changes the middle pixels in the `below` pass and not in `above`;
    - a bank changes them only in `above`;
    - a cloud across the seam is drawn on both sides, with `rect.x < 0` and `rect.y < 0` cases;
    - clouds clip at the frame's edges without wrapping across them;
    - alpha 0 leaves a pixel unchanged;
    - a flipped cloud is the mirror image;
    - the busiest view draws in under 3 ms in Node (median of 50 frames; the browser budget of 1 ms is checked in
      Task 3).
- [ ] **Step 2:** Run `node --test src/world/sky/*.test.ts`. Expect a fail.
- [ ] **Step 3:** Implement as the interfaces say. Shapes come from seeded fbm (`core/noise.ts`), shaped per kind.
  Low clouds are scattered by blue-noise-like rejection, thinned by a broad weather fbm. Banks are scattered with at
  least 700 cells between them.
- [ ] **Step 4:** Run `npm test`, `npx tsc --noEmit` and `npm run lint`. Expect all clean. Run
  `npm run world:clouds`. Expect `.cache/world-clouds/sheet.png`.
- [ ] **Step 5:** Commit: `feat(world): sky system with plain clouds`.

**Builder:** Cursor, `grok-4.7-high`.

**As built.**
- `Sky` also exposes `field`.
- `sky.ts` exports `drawClouds(out, rect, field, sprites, t, layer, layerAlpha)`, so the drawing can be tested on
  hand-made fields.
- The first shapes rendered as domes on rectangular slabs with speckled halos, and the tests allowed it. Claude
  rewrote `shapes.ts` (lobed cumulus on a pinched flat base, two-tier banks, tapered ribbons) and added tests for:
  - rounded base corners;
  - one clean piece with no halo;
  - two or more crowns;
  - a smooth dome;
  - tapered wisps.

  These pass on 14 of 16 seeds; the other two miss a limit by under 1 %.

### Tasks 2a, 2b, 2c: the three painters (parallel lanes)

**Files (one lane each):**
- 2a: `src/world/sky/paint/watercolour.ts`, test `watercolour.test.ts`
- 2b: `src/world/sky/paint/storybook.ts`, test `storybook.test.ts`
- 2c: `src/world/sky/paint/layered.ts`, test `layered.test.ts`. This lane may also tune `styles.ts`'s `layered` entry
  alpha values, and nothing else in it.

**Interfaces:** each exports `paint<Name>: Painter` (from Task 1's `sprite.ts`), used by `STYLES`.

**The look (the brief carries this in full).** Every style is lit from the north-west, like the land, and carries
paper grain through the sprite:
- **2a, watercolour:** soft washed puffs; pigment pools darker at wash edges; cream tops fading to cool bellies; ink only
  as broken strokes on the sunlit (north-west) rims; paper grain through the wash; soft alpha falloff.
- **2b, storybook:** bold heaps with a continuous inked outline; flat cream tops; cool bellies with fine diagonal hatching
  in the shade; crisp edges, like a printed picture book.
- **2c, layered:** low heaps in a lighter wash, plus high streaks that are thin, pale and translucent, with feathered
  ends; little or no ink on streaks.

- [ ] **Step 1: Write the failing tests** (Claude), all styles:
  - deterministic;
  - alpha 0 where cover is 0;
  - the lit top third is at least 8 L* brighter than the bottom third, on heaps and banks;
  - no reddish pixels (R > G + 60);
  - size equals the shape's.

  Style tests:
  - **2a:** dark pixels (L* < 40) appear only in the top half and cover under 4 % of the sprite.
  - **2b:** at least 60 % of the outline ring (cover > 0 next to cover = 0) is ink-dark (L* < 35), and the bottom third
    has dark hatch pixels in diagonal runs.
  - **2c:** streak sprites have alpha ≤ 140 everywhere and no pixel darker than L* 60.
- [ ] **Step 2:** Run the lane's test. Expect a fail.
- [ ] **Step 3:** Implement the painter.
- [ ] **Step 4:** Run `npm test` and `npm run world:clouds`. Expect a pass and a sheet.
- [ ] **Step 5:** Commit: `feat(world): <style> clouds`.

**Builder:** Cursor. 2a and 2b on `grok-4.7-high`, 2c on `composer-2.5` (a different model gives a different eye).

### Task 3: Compare, show the owner, pick

- [ ] **Step 1:** Merge the three lanes into `world/clouds`. Run `npm run world:clouds` and look at the sheet.
- [ ] **Step 2:** Build the site. Fly each style with `scripts/world-fly.mjs` (`/world?clouds=<style>&stats`). Check
  that `sky.draw` stays under 1 ms p95, and save screenshots.
- [ ] **Step 3:** Send the owner the sheet and the screenshots. Ask for a pick and any changes; one tuning round
  through the lane that built the winner.
- [ ] **Step 4:** Make the pick the default. Keep the other styles behind `?clouds=` until the owner says to drop them.
  Update the roadmap, then merge `world/clouds` into `feat/dragon-world` with `--no-ff`.

**Builder:** Claude.
