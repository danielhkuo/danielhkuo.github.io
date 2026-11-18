# Dragon world: first flight. Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** You open `/world`, the realm appears within two seconds, and you steer a stand-in flier over the real generated land at 60 fps, with the land painted in background workers ahead of you.

**Architecture:**
- The owner's machine generates the world once. It is written to `public/world/<worldId>/` and committed, as one `world.bin` file of compressed sections plus a `manifest.json`.
- In the browser, a small pool of workers each loads `world.bin` and bakes 256² chunks on request.
- The main thread holds only the ground and occlusion fields. It plans which chunks to want from the flier's position and velocity, composes each frame through the palette, and draws a hazy overview wherever a chunk is not baked yet.
- A pure flight model drives the camera. A stand-in sprite with a shadow takes the dragon's place until the dragon project.

**Tech Stack:**
- TypeScript, shared by Node 26 and the browser.
- Next.js 16 static export, Web Workers with transferable buffers, and `DecompressionStream('deflate-raw')`.
- `node --test` for tests; Puppeteer for browser timing.

**Spec:** `docs/superpowers/specs/2026-11-16-dragon-world-terrain-design.md` (sections 5.4, 5.5, 5.9 and tasks 21, 22, 27 and 28). This plan departs from the spec in two places, both originally Claude's calls:

1. **One world file instead of 25 spatial packs.** The bake needs neighbour aprons and whole-world river and road indexes, and spatial packs would mean stitching all of them. The file is fetched while the page opens. Pack streaming can be added later behind the same `decodeWorld` if load time demands it.
2. **Budget.** The spec set 0.5 MB before first flight and 3 MB in all; this plan loads the whole world before first flight. Measured with the encodings below, seed 3 comes to about 3.1 MB, so the build gates at 3.5 MB, about 0.6 s on a 50 Mbit/s link.

## Global Constraints

- **Hosting:** static export on GitHub Pages. No custom headers, no `SharedArrayBuffer`, and workers exchange only transferable buffers.
- **Determinism lint:** world code under `gen/`, `bake/`, `look/`, `pack/`, `sites/` and top-level `src/world/*.ts` must not use `Math.random`, `Math.sin/cos/pow/exp/log/atan/hypot`, `**`, `Date`, `performance.now` or `.sort(`. Use `core/rng.ts`, `core/psin.ts` and `sortIndicesBy`. `runtime/` and `src/app/` may use the clock.
- **Syntax:** `.ts` import suffixes. No enums, parameter properties or path aliases inside `src/world/`.
- **Tests:** in `src/**/*.test.ts`, run by `npm test`. Claude writes and commits each task's tests before it is delegated.
- **Data budget:** `world.bin` at most 3.5 MB (3,670,016 bytes) for the 6400 world, aiming for 3 MB. The build CLI fails above 3.5 MB.
- **Frame budget:**
  - main-thread work per frame (compose, flier, grain) under 4 ms p95 with Chrome's 4× CPU throttle;
  - the start view fully baked within 2 s of the page opening in unthrottled desktop Chrome.
- **Game layer:** hand-written canvas and CSS, not Astryx. IM Fell English. Vermilion and gold are reserved for the flier, the dragon and landmarks.
- **Original work only:** never copy the Forge demo's source.
- **Shipped world:** seed 3 at n = 6400, unless the owner picks another seed. It is built with `npm run world:build -- --seed 3 --cache`.

## Review Focus

1. **Tab hidden, then shown:** workers stall and wants pile up. On return, stale requests are dropped and the chunks under the view bake first. Covered in Task 3 by `want() drops queued jobs no longer wanted`.
2. **Flying across the wrap:** at x or y = 0 / n, chunk keys, the cache and `depthAt` stay continuous with no seam or re-bake storm. Covered in Task 4 by `flying across the wrap keeps wants and depth continuous`.
3. **A long frame:** a breakpoint, tab switch or GC pause must not teleport the flier through a hill. Covered in Task 5 by `a long frame is clamped`.
4. **World data missing or corrupt:** a stale `current.json` after a deploy, or a 404, shows a message with a link home, never a blank canvas or garbage land. Covered in Task 1 by `a corrupted section is refused` and in Task 5 by `the page shows an error when the world cannot load`.
5. **Odd window sizes:** the canvas always scales by a whole number with hard pixels, never blurred. Covered in Task 5 by `fitScale picks the largest whole scale that fits`.

---

### Task 1: World file codec

**Files:**
- Create: `src/world/pack/world.ts`
- Test: `src/world/pack/world.test.ts`

**Interfaces:**
- Consumes: `encodeHeights`/`decodeHeights`, `encodeBytes`/`decodeBytes`, `writePack`/`readPack` and `sha256` from `pack/codec.ts`; `BakeWorld`, `riverIndex` and `RiverLine` from `bake/world.ts`; `indexBuilt` from `gen/built.ts`.
- Produces:
  - `WORLD_FORMAT = 1`; `H_SCALE = 16` (height steps per unit); `FIELD_SCALE = 63` (steps over [0, 1]); `XY_SCALE = 16` (vertex steps per cell). Measured on the 1280 fixture, these steps change under 2 % of baked pixels.
  - `interface WorldSection { name: string; bytes: number; sha256: string }`, where the hash is of the section's stored bytes. The world is built once and committed, so zlib versions cannot drift it.
  - `encodeWorld(w: BakeWorld, extra?: { occlusion?: Uint8Array }): Promise<{ bin: Uint8Array; sections: WorldSection[] }>`
  - `decodeWorld(bin: Uint8Array, verify?: readonly WorldSection[]): Promise<BakeWorld>`
  - `interface FlightData { n: number; gN: number; ground: Float32Array; occlusion: Uint8Array; block: number }`
  - `decodeFlightData(bin: Uint8Array): Promise<FlightData>`, which decodes only the `ground` and `occlusion` sections.
  - `class WorldDecodeError extends Error`

**Encoding:**
- **`ground`:** `encodeHeights` at `H_SCALE`.
- **`base` and `conform`:** stored as residuals: `base − ground` and `conform`, each at `H_SCALE`. They are zero almost everywhere.
- **`waterLevel`:** at `H_SCALE`, lake nodes only.
- **`waterKind`, `shore`, `rock`:** raw u8.
- **`hand`:** u8 = `min(255, round(hand))`.
- **`moisture`, `wind`, `exposure`, `debris`:** MED-predicted at `FIELD_SCALE` steps over [0, 1].
- **`regions`:** integer weights per node summing to exactly `FIELD_SCALE` (largest remainder), so they decode summing to 1 and re-encode unchanged.
- **River and road indexes:** stored as their polylines. Each line's start is recovered from the index: a vertex starts a line when the vertex before it is not a segment start. Vertices are stored as zigzag delta int32 at `XY_SCALE`, with width at `XY_SCALE`. The decoder rebuilds the index with `riverIndex`.
- **`stamps`, `ponds`, `bars`, `built`:** one generic value packer: a JSON shape, numbers in f32 columns by key path (byte-planed), and typed arrays concatenated per path. `built` is re-indexed with `indexBuilt` on decode.
- **`falls`:** f32.
- **`occlusion`:** u8, when given.

- [ ] **Step 1: Write the failing tests.** Use `generatedWorld()` from `testing/bakefix.ts` as `w`.
  - `every field comes back with the original's length`
  - `heights come back within half a step` (1/32 of a unit), for `ground`, `base`, `conform`, and `waterLevel` on lake nodes.
  - `river and road indexes keep their buckets and segments`: `bucketStart` and `segments` deep-equal; vertices within `1/(2·XY_SCALE)`.
  - `encoding a decoded world gives the same bytes`.
  - `a decoded world bakes nearly the same chunks`: over six chunks, material and light differ in at most 2.5 % of pixels on average and 5 % in any one.
  - `a corrupted section is refused`: flip one byte inside the `ground` section, and `decodeWorld(bin, sections)` rejects with `WorldDecodeError`.
  - `the file fits its budget`: at most 300,000 bytes for the 1280 fixture.
- [ ] **Step 2:** Run `npm test -- src/world/pack/world.test.ts`. Expect a fail: module not found.
- [ ] **Step 3:** Implement `pack/world.ts` as above.
- [ ] **Step 4:** Run the tests again. Expect a pass.
- [ ] **Step 5:** Commit: `feat(world): world file codec`.

**Builder:** Cursor, `grok-4.7-high`. Claude checks a render from the decoded world against the original before accepting.

### Task 2: Occlusion floor, manifest and build CLI

**Files:**
- Create: `src/world/gen/occlusion.ts`, `src/world/pack/manifest.ts`, `src/world/cli/build.ts` and `scripts/world-build.ts`
- Modify: `package.json`, adding the script `"world:build": "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/world-build.ts"`
- Test: `src/world/gen/occlusion.test.ts` and `src/world/cli/build.test.ts`

**Interfaces:**
- Produces:
  - `occlusionFloor(ground: ArrayLike<number>, gN: number, cellsPerNode: number, block: number): Uint8Array`, one byte per `block`-cell square. For each G node it computes `max(0, max over k = 1…ceil(200/cellsPerNode) of h[x, y+k] − 0.8·k·cellsPerNode)`, wrapping. Each block holds the ceiling of its nodes' maximum, clamped to 255.
  - `interface Manifest { format: 1; worldId: string; n: number; seed: number; bytes: number; sections: WorldSection[]; block: 16; sites: { id: string; type: string; x: number; y: number }[]; start: { x: number; y: number; heading: number } }`
  - `startOf(sites: PlacedSite[], ground: ArrayLike<number>, gN: number, n: number): Manifest["start"]`.
    - The start sits 150 cells past the town's `harbour.mouthX/mouthY`, along the line from the abbey to the mouth, and heads toward the abbey. Heading is in radians, 0 = east, π/2 = south.
    - Without a town, it starts 300 cells south of the abbey, heading north.
  - `buildWorld(opts: { n: number; seed: number; cache?: boolean; out: string }): Promise<Manifest>`. It writes these files:
    - `<out>/<worldId>/world.bin`
    - `<out>/<worldId>/manifest.json`
    - `<out>/current.json` holding `{ "worldId": "…" }`

    `worldId` is the first 12 hex characters of `sha256(world.bin)`. Older world folders are left in place, and the CLI names them.
  - The CLI (`--seed`, `--n` default 6400, `--cache`):
    - prints each section's size;
    - exits 1 when `bytes > 3_670_016`;
    - renders the start view and the abbey view from the original and the decoded world into `.cache/world-build/`, and prints their pixel difference.

- [ ] **Step 1: Write the failing tests.**
  - `occlusion equals a brute-force march on a random 64² field`.
  - `a flat field has no floor`: all zeros.
  - `a wall 40 high, two nodes south, sets a floor of 34`: with cellsPerNode 4, `ceil(40 − 0.8·8) = 34`.
  - `the start lies over the sea and heads toward the abbey`: on the mini-world, `ground at start ≤ 0`, and the heading vector's dot product with (abbey − start) is > 0.9 of its length.
  - `building twice gives identical bytes and the same worldId`: build n = 1024 into a temp folder.
  - `current.json names the new world`.
- [ ] **Step 2:** Run the tests. Expect a fail.
- [ ] **Step 3:** Implement the module, the CLI and the npm script.
- [ ] **Step 4:** Run the tests. Expect a pass. Then run `npm run world:build -- --seed 3 --cache`. Expect `bytes ≤ 3670016` and a pixel difference under 2.5 %.
- [ ] **Step 5:** Commit the code first. Commit the generated `public/world/<worldId>/` separately, once the owner has seen the size and the check renders.

**Builder:** Cursor, `grok-4.7-high` for the occlusion floor and `composer-2.5` for the CLI. Claude checks the start view by eye.

### Task 3: Bake workers and pool

**Files:**
- Create: `src/world/runtime/pool.ts`, `src/world/runtime/bakeHost.ts` and `src/world/runtime/bake.worker.ts`
- Test: `src/world/runtime/pool.test.ts` and `src/world/runtime/bakeHost.test.ts`

**Interfaces:**
- Consumes: `decodeWorld` from Task 1; `bakeChunk` and `tileCache` from `bake/chunk.ts`; `worldLook` from `bake/look.ts`; `buildPalette` from `render/palette.ts`.
- Produces:
  - `interface WorkerLike { postMessage(msg: unknown, transfer?: Transferable[]): void; onmessage: ((e: { data: unknown }) => void) | null; terminate(): void }`
  - `type ToWorker = { type: "init"; url: string; mask: Uint8Array } | { type: "bake"; id: number; cx: number; cy: number }`
  - `type FromWorker = { type: "ready" } | { type: "baked"; id: number; cx: number; cy: number; px: Uint32Array; ms: number } | { type: "error"; message: string }`
  - `interface ChunkWant { cx: number; cy: number; priority: number }`. Coordinates are wrapped; a lower priority goes first.
  - `interface BakePool { want(list: readonly ChunkWant[]): void; onBaked: ((cx: number, cy: number, px: Uint32Array) => void) | null; onError: ((message: string) => void) | null; stats(): { inFlight: number; queued: number; baked: number; bakeMs: number }; dispose(): void }`
  - `createPool(spawn: () => WorkerLike, size: number, init: { url: string; mask: Uint8Array }): BakePool`
    - `want` replaces the wish list: queued chunks missing from it are dropped, and in-flight chunks finish.
    - Each worker runs at most one job at a time.
    - A chunk is never queued or in flight twice.
    - A worker that posts `error` is reported and replaced once.
  - `createBakeHost(bin: Uint8Array, mask: Uint8Array): Promise<(cx: number, cy: number) => Uint32Array>` holds the decoded world, the look and the tile cache. `bake.worker.ts` is a thin wrapper: it fetches `url`, creates the host and answers messages.
  - The page sizes the pool as `clamp(navigator.hardwareConcurrency − 1, 1, 4)`.

- [ ] **Step 1: Write the failing tests,** using fake `WorkerLike` objects that answer when the test tells them to.
  - `never more than one job per worker`.
  - `jobs go out in priority order`.
  - `want() drops queued jobs no longer wanted`: in-flight jobs still arrive through `onBaked`.
  - `a chunk is never requested twice while queued or in flight`.
  - `a failing worker is reported and replaced once`.
  - `the host bakes the same bytes as bakeChunk on the decoded world`, on the mini-world.
- [ ] **Step 2:** Run the tests. Expect a fail.
- [ ] **Step 3:** Implement the pool, the host and the worker.
- [ ] **Step 4:** Run the tests. Expect a pass.
- [ ] **Step 5:** Commit: `feat(world): bake worker pool`.

**Builder:** Cursor, `grok-4.7-high`.

### Task 4: Streaming view and haze

**Files:**
- Create: `src/world/runtime/stream.ts` and `src/world/render/haze.ts`
- Modify: `src/world/render/compose.ts`, adding an optional `fallback` argument
- Test: `src/world/runtime/stream.test.ts` and `src/world/render/haze.test.ts`

**Interfaces:**
- Consumes: `FlightData` from Task 1, `BakePool` from Task 3, `WorldView` from `runtime/view.ts`, and `upsampleGround` from `bake/cells.ts`.
- Produces:
  - `compose(chunks, palette, view, out, live?, fallback?: (bx: number, by: number) => number)`. Missing chunks call `fallback` instead of writing `PAPER`.
  - `hazeOf(data: FlightData, palette: Palette): (bx: number, by: number) => number`:
    - an overview image at one pixel per 8 cells, precomputed once and sampled at bake pixel (bx, by), treating world y as by / 0.8;
    - flat washes for sea, shore, lowland, upland and snow, mixed 45 % toward the paper colour.
  - `interface StreamView extends WorldView { update(vx: number, vy: number): void; ready(): boolean }`
  - `createStreamView(data: FlightData, pool: BakePool, palette: Palette, mask: Uint8Array, opts: { width: number; height: number; cacheChunks?: number; lookahead?: number; sites?: Manifest["sites"] }): StreamView`
    - `cacheChunks` defaults to 32 and `lookahead` to 6 s.
    - `update` re-plans the wish list. Priority runs from chunks under the view, to chunks within 2 s of travel, to chunks out to `lookahead`, to a one-chunk ring behind.
    - `ready()` is true when every chunk under the view is baked.
    - `groundHeight` upsamples `data.ground` at the cell.
    - `occlusionFloor` reads `data.occlusion`.
    - `sites()` returns the manifest's sites with `project: null`.

- [ ] **Step 1: Write the failing tests.**
  - `nothing under the view is drawn as bare paper`: with a pool that never bakes, no frame pixel equals `PAPER`.
  - `chunks under the view are wanted first, then ahead, then behind`.
  - `the cache never holds more than cacheChunks`, over a scripted 60 s flight.
  - `flying across the wrap keeps wants and depth continuous`:
    - the camera starts at x = n − 10 and moves east;
    - wrapped chunk cx = 0 is wanted, and no chunk is re-baked after the wrap;
    - `depthAt` changes by under 2 rows between adjacent frames.
  - `groundHeight matches groundAt on the full world`, within 1e-4 at 100 sample cells.
  - `haze is painted, not blank`: every haze pixel differs from `PAPER`, and sea differs from land.
- [ ] **Step 2:** Run the tests. Expect a fail.
- [ ] **Step 3:** Implement the stream view, the haze and the `compose` change.
- [ ] **Step 4:** Run `npm test`, the whole suite, because `compose` changed. Expect a pass.
- [ ] **Step 5:** Commit: `feat(world): streaming view with haze`.

**Builder:** Cursor, `grok-4.7-high` for the stream view. Claude writes the haze washes (look).

### Task 5: Flight model, stand-in flier and the `/world` page

**Files:**
- Create: `src/world/runtime/flight.ts`, `src/world/runtime/standin.ts`, `src/world/runtime/fit.ts`, `src/app/world/page.tsx` and `src/app/world/Flight.tsx`
- Test: `src/world/runtime/flight.test.ts`, `src/world/runtime/standin.test.ts` and `src/world/runtime/fit.test.ts`

**Interfaces:**
- Consumes: `StreamView` from Task 4; `Manifest` from Task 2; `createPool` from Task 3; `psin` and `pcos` from `core/psin.ts`; `RESERVED` and `SHADOW_MIX` from `render/palette.ts`.
- Produces:
  - **Flight constants:** `CRUISE = 60` (cells/s, a 107 s lap), `BOOST = 1.8`, `BRAKE = 0.5`, `TURN = 1.6` (rad/s), `CLEARANCE = 18`, `CLIMB = 30` (units/s), `DT_MAX = 0.1`.
  - `interface FlightState { x: number; y: number; heading: number; speed: number; alt: number; bank: number }`
  - `interface FlightInput { turn: -1 | 0 | 1; boost: boolean; brake: boolean }`
  - `startState(start: Manifest["start"], terrain: Pick<WorldView, "groundHeight" | "occlusionFloor">): FlightState`
  - `stepFlight(s, input, dt, terrain, n): FlightState`
    - pure; dt is clamped to `DT_MAX`; x and y wrap into [0, n);
    - speed eases toward `CRUISE · (boost ? BOOST : brake ? BRAKE : 1)`;
    - bank eases toward `turn`;
    - altitude eases at `CLIMB` toward `max(ground + CLEARANCE, occlusionFloor + 4)`.
  - `drawFlier(out: Uint32Array, rect: ViewRect, s: FlightState, view: Pick<WorldView, "depthAt" | "groundHeight">): void`
    - draws the shadow first: the ground point at offset `0.354·(alt − ground)` cells per axis to the south-east, darkened by `SHADOW_MIX[2]`;
    - then the sprite: an 11×11 vermilion kite with an ink outline, in 16 headings;
    - each flier pixel is drawn only where `depthAt` is not nearer the viewer than the flier's world row.
  - `fitScale(vw: number, vh: number, w: number, h: number): number`: the largest whole number of at least 1 at which w×h fits.
  - **Page behaviour:**
    - **Loading:** reads `/world/current.json`, then the manifest and `world.bin`, decodes the flight data, and starts the pool and the stream view.
    - **Drawing:** a `requestAnimationFrame` loop steps the flight and centres the camera on the flier with `setCamera(s.x, s.y − s.alt / 0.8)`, then calls `frame`, `drawFlier` and `putImageData`.
    - **Controls:** arrows or WASD steer, Shift boosts, S or ↓ brakes, and Esc goes to `/`.
    - **Hint:** a one-line control hint in IM Fell English.
    - **Stats:** `?stats` shows fps and pool stats.
    - **Errors:** if loading fails, the page shows "The realm could not be loaded." with a link home.
    - **Metadata:** `robots: noindex` until the title menu links the page. The home page is not changed.

- [ ] **Step 1: Write the failing tests.**
  - `cruising covers 60 cells a second`: after 3 s settling, 1 s of travel = 60 ± 0.5 cells.
  - `a full turn takes 2π/TURN seconds`: ± 0.25 s once banked.
  - `the flier keeps clear of the ground and above the occlusion floor`: on a ramp fixture, after 3 s, `alt ≥ max(ground + CLEARANCE, floor + 4) − 0.5`.
  - `a long frame is clamped`: `stepFlight(s, i, 5, …)` equals `stepFlight(s, i, DT_MAX, …)`.
  - `position wraps into the world`.
  - `the flier is hidden behind a hill to its south and seen over open ground`, on a `fieldWorld` fixture.
  - `the shadow falls south-east, 0.354 cells per unit of height`.
  - `fitScale picks the largest whole scale that fits`: (1920, 1080) gives 4, (1000, 700) gives 2, and (300, 200) gives 1.
  - `the page shows an error when the world cannot load`: a pure `loadState` reducer in `Flight.tsx`, exported and tested.
- [ ] **Step 2:** Run the tests. Expect a fail.
- [ ] **Step 3:** Implement the flight model, the stand-in and the page.
- [ ] **Step 4:** Run `npm test`, `npm run lint` and `npx tsc --noEmit`. Expect all clean.
- [ ] **Step 5:** Commit: `feat(world): first flight at /world`.

**Builder:**
- Cursor, `composer-2.5`, builds `flight.ts`, `fit.ts` and the page shell.
- Claude draws the stand-in sprite and tunes the flight constants by flying it.

### Task 6: First-flight check in a real browser

**Files:**
- Create: `scripts/world-fly.mjs`, which reuses `scripts/world-bench.mjs`'s static server and Puppeteer launch.

**What it does:**
- Builds the static export, serves `out/`, and opens `/world` in headless Chrome.
- Flies a scripted 30 s route by key presses.
- Reports:
  - time until `ready()`;
  - main-thread ms per frame (p50 and p95), unthrottled and at 4× CPU throttle;
  - chunks baked per second;
  - the number of frames that showed haze under the view.
- Saves screenshots at 0, 10 and 30 s.

- [ ] **Step 1:** Write the script and run it. Expect the start view ready in ≤ 2 s and p95 ≤ 4 ms per frame at 4× throttle. Haze is allowed only in the first second and at boost.
- [ ] **Step 2:** If the budget fails, follow the spec's ladder (5.5):
  1. a fast first bake pass without scatter and hatching;
  2. a larger look-ahead;
  3. limit boost over unbaked land.
- [ ] **Step 3:** Commit the script. Send the owner the screenshots and the numbers, and ask the owner to run `/world` in Safari.

**Builder:** Claude, since this is judgment on numbers and pictures.

---

## Order and routing

- Tasks 1 → 2 → 3 → 4 → 5 → 6, in that order.
- Task 3 can start beside Task 2 once Task 1 lands.
- Claude writes every task's tests, delegates the code to Cursor through cursor-delegate (freeze, run, check, land), checks the output, and owns the look: haze, the sprite, and flight feel.

## Left out (later projects)

- **The dragon:** its sprite stack, flight rules and wake.
- **Landmark sprites, landing, and projects on sites.**
- **The title menu and its wording.**
- **Live layers:** cloud shadows, wind in grass, surf, river streaks, and time of day, season and weather palettes.
- **Pack streaming:** only if load time needs it.
- **Phones and touch controls:** phones default to the text site.
