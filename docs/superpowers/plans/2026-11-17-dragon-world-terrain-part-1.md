# Dragon world terrain, part 1: bake gate, foundations, erosion — implementation plan

> **For agentic workers:** run each delegated task through the **Delegate cycle** below (the owner chose cursor-delegate). Tasks marked **Claude** are implemented inline with superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the bake architecture on the laptop target, then build the deterministic core and grow eroded land that a critic pass accepts.

**Architecture:** Pure TypeScript modules under `src/world/`, shared by Node 26 (type stripping) and Next workers. Generation stages are pure functions `(inputs, params, seed) → typed arrays`. This part covers design tasks 0–7, pulls the PNG encoder forward from task 30, and adds a hillshade preview and the first critic pass on erosion.

**Tech Stack:** TypeScript 5.9, Node 26 `node --test`, Next 16 (Turbopack, static export), Puppeteer 25 for the throttled bench, `cursor-delegate` with `composer-2.5` and `grok-4.7-high`.

**Spec:** `docs/superpowers/specs/2026-11-16-dragon-world-terrain-design.md` (sections 3, 5.1–5.3, 5.5, 6 and 7 bear on this part).

**Scope [Call].** The design has two stop points: task 0's bake gate, and a critic pass after task 7 that judges erosion "before more is built on it" (risk 2). Either can change later tasks. So this plan covers tasks 0–7. Part 2 (tasks 8–22, the rest of the generator and the packs) is written after the critic pass. Part 3 (tasks 23–30, bake, runtime and harness) is written after the bake gate, with its numbers. Part 3's synthetic-world tasks may then run alongside Part 2.

## Global Constraints

- Camera: north-up, no rotation, no perspective; `screenY = worldY·0.8 − height`; one cell is one pixel across.
- World: **6400 × 6400 cells**, a torus. Solver grid G: **1600² nodes, 4 cells per node**. Coarse grid C: **800² nodes, 8 cells per node**.
- Mini-world for tests: **1024 cells** (G 256², C 128²). Every length in `gen/params.ts` is in cells for the 6400 world and scaled through `paramsFor(N)`.
- Heights: one unit is one screen pixel. Sea level **0**, sea bed down to **−24**, land capped at **130**, canopy up to **+8**, `HMAX = 160`.
- Index layout: `i = y·n + x`; x runs east, y runs south. 8-neighbour order: **E, SE, S, SW, W, NW, N, NE**.
- RNG: `sfc32`, one stream per stage keyed by `hash(seed, stageName)`. Never `Math.random()`.
- Arithmetic whitelist in deterministic code: `+ − × ÷`, `Math.sqrt`, `abs`, `floor`, `fround`, `imul`, `clz32`, plus the exact `min`, `max`, `round`, `ceil`, `trunc`, `sign`. Banned: `sin`, `cos`, `tan`, `pow`, `**`, `exp`, `log*`, `atan*`, `asin`, `acos`, `hypot`, `cbrt`, the hyperbolics, `Date`, `performance.now`, and `.sort(`. Heaps and sorts key on `(value, index)`.
- Deterministic code is everything in `src/world/{core,gen,bake,pack,sites,look}/` and the top-level `src/world/*.ts` files. `bench/`, `cli/`, `render/`, `runtime/`, `testing/` and tests are exempt from the arithmetic rules.
- All of `src/world/`: no `enum`, `namespace`, parameter properties, decorators or `@/` aliases; every relative import ends in `.ts`.
- Generation arrays are `Float64Array` unless a task says otherwise.
- Tests live beside their code as `src/world/**/*.test.ts`. Shared test support lives in `src/world/testing/` and is written by Claude.
- Models: `composer-2.5` (mechanical), `grok-4.7-high` (numerical), `grok-4.7-xhigh` only after a failure.

Shorthand used below:

```bash
wt() { node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test "$@"; }
```

## Review Focus

1. **Non-integer coordinates reaching noise unwrapped** make a seam at the torus edge, though the noise tests use dyadic inputs. Callers wrap integer cells first. Pinned by task 5's "no seam" test.
2. **The worker that runs under `next dev` fails in the static export** (wrong chunk URL under `out/`). Pinned by task 0, which measures the exported build, not dev.
3. **A large flat plateau** makes ε-routing cycle or strand nodes. Every node must still reach the sea. Pinned by task 6's 128² plateau test.
4. **Parameters that cannot fit the core quota** make Poisson sampling spin forever. It must throw an error naming the cores. Pinned by task 5.
5. **Erosion leaves a step along the wrap seam** even when the plan is seamless. Pinned by task 7's seam test.

## Delegate cycle

Each delegated task names its slug, test files, implementation files and first model.

- **D1.** Write the task's tests and test support. Add stubs for every **Produces** symbol, each throwing `new Error("not implemented")`.
- **D2.** Run `wt <test files>`. Expected: failures citing "not implemented".
- **D3.** Commit with `git add <tests> <support> <stubs> && git commit -m "test(world): <slug>"`.
- **D4.** Run `cursor-delegate freeze --task <slug> --allow <implementation files> --model <model>` in the background. If `untracked_tests` is not empty, abandon, commit those files, and freeze again.
- **D5.** Write the brief to `<scratchpad>/briefs/<slug>.md`: the task's Interfaces and Notes, plus Global Constraints. Don't paste the tests.
- **D6.** Run `cursor-delegate run --brief-file <brief>` in the background.
- **D7.** Run `cursor-delegate check` in the background.
  - On PASS, go to D8.
  - On FAIL or cursor-error, repeat D6 with `--model` one step up the ladder.
  - After the third failure, run `cursor-delegate abandon`, implement the task here, and say so in the report.
- **D8.** Run `cursor-delegate land`, then `npm test` and `npx tsc --noEmit`; both must come back clean. Commit with `git add <implementation files> && git commit -m "feat(world): <slug>"`.
- **D9** (tasks marked *golden* only). Add a test that pins the SHA-256 of the landed output on the named fixture, run it, and commit with `test(world): pin <slug> golden`.

---

### Setup: commit the design and ignore the caches (Claude)

**Files:** Modify `.gitignore`. Commit `.claude/CLAUDE.md`, `docs/superpowers/research/`, `docs/superpowers/specs/2026-11-16-dragon-world-terrain-design.md` and this plan.

- [ ] **Step 1:** Append `/.cache/` to `.gitignore`. It holds stage caches and renders.
- [ ] **Step 2:** `git add .gitignore .claude/CLAUDE.md docs/superpowers && git commit -m "docs(world): terrain design, research and part 1 plan"`

---

### Task 0: Bake gate (Claude)

The architecture stands or falls here. Stop the whole plan if the gate fails and the fallback ladder cannot rescue it.

**Files:**
- Create: `src/world/core/probe.ts`, `src/world/core/probe-dep.ts`, `src/world/core/probe.test.ts`
- Create: `src/world/bench/field.ts`, `src/world/bench/bake-bench.ts`, `src/world/bench/bake-bench.test.ts`, `src/world/bench/bench.worker.ts`
- Create: `src/app/world-bench/page.tsx`, `src/app/world-bench/WorldBench.tsx`
- Create: `scripts/world-bench.mjs`
- Create: `docs/superpowers/research/2026-11-17-bake-gate.md`

**Interfaces:**
- Produces `probe(seed: number): string`, an 8-digit hex string built from `probe-dep.ts` with `Math.imul`. It proves chained `.ts` imports run in both Node and a Next worker.
- Produces `makeBenchField(nCells: number, seed: number): BenchField`, holding G heights (`Float32Array`), HAND (`Uint8Array`, G), and six field planes (`Uint8Array`, C).
- Produces `bakeBenchChunk(field: BenchField, cx: number, cy: number, cache: Map<number, unknown> | null, mask: Uint8Array): Uint32Array`, one 256 × 256 chunk of 4-byte bake pixels.

**The real per-cell workload (5.5).** The bench must do each of these on every cell or pixel, in this order, at the sizes given. It must not shortcut any of them, because the gate means nothing otherwise.

| Stage | Work per cell or pixel |
|---|---|
| Cell tile, 256² plus a 64-cell NW apron | cubic B-spline upsample from G (16 taps); central-difference slope and northness; bilinear HAND (G) and six fields (C) |
| Cover | the 10-rule table of S8, first match wins, each threshold jittered by a blue-noise lookup |
| Scatter | mask test at forest and pasture densities (0.20, 0.22, 0.02); stamp a crown disc of radius 1.5–3 into height and material |
| Light | `0.6·Lambert + 0.4·relief`, where relief is height minus a 16-cell separable box blur; quantise to 16 tones |
| Shadow | diagonal running-maximum sweep, dropping 2√2 per step |
| Pixel chunk, 256 × 256 px over 320 world rows plus 200 rows south | painter's pass north to south: screen row `floor(4y/5) − round(h)`, wall fill, depth and source row |
| Ink | occlusion rule: at least 3 hidden rows and a drop of at least 3; soft ink for 3–9 rows, full ink for 10 or more |
| Dither and hatch | tone against the blue-noise mask per bake pixel; hatch mask on pixels with slope ≥ 2 |

- [ ] **Step 1: Probe test.** Write `probe.test.ts`, asserting that `probe(42)` equals a literal and that `probe(0) !== probe(1)`. Write `probe.ts` and `probe-dep.ts`, run `wt src/world/core/probe.test.ts`, put the printed value in as the literal, and run again. Expected: PASS.
- [ ] **Step 2: Bench kernel tests.** Write `bake-bench.test.ts` with three tests:
  - the same field and chunk give byte-identical output;
  - every pixel is written (no `0xFFFFFFFF` sentinel left);
  - the ink share of land pixels on `makeBenchField(1024, 7)` is between 0.5 % and 10 %.
- [ ] **Step 3: Implement** `field.ts` (periodic hashed-gradient fbm shaped to about 30 % land, peaks near 130) and `bake-bench.ts` per the workload table. Run `wt src/world/bench/bake-bench.test.ts`. Expected: PASS.
- [ ] **Step 4: Worker and page.**
  - `bench.worker.ts` builds a 2560-cell bench field. The field build is not timed.
  - The worker answers `{probe}`, `{coldChunk: [cx, cy]}` and `{warmRun: ms}`. A warm run bakes chunks south to north so the cell-tile cache is reused, and reports the chunk count.
  - `WorldBench.tsx` is a client component. It spawns `max(1, min(4, hardwareConcurrency − 1))` workers via `new Worker(new URL("../../world/bench/bench.worker.ts", import.meta.url), { type: "module" })`.
  - The page has a Run button and shows `probe(42)` from a worker, the start-view time, and the sustained rate.
    - **Start-view time:** wall time for all workers to cold-bake the 6 chunks covering a 400 × 225 view.
    - **Sustained rate:** chunks per second across all workers over 10 s of warm runs.
  - The page writes the result object to `window.__benchResult` and offers a Copy button.
  - Use Astryx components for the page chrome. Export `metadata = { robots: { index: false } }`.
- [ ] **Step 5: Static export.** Run `npm run build`. Expected: `out/world-bench/index.html` exists and a worker chunk is emitted under `out/_next/`.
- [ ] **Step 6: Throttled Chrome runner.** Write `scripts/world-bench.mjs`. It serves `out/` with a small `node:http` static server and opens `/world-bench` in Puppeteer's Chrome.
  - Throttle with `page.emulateCPUThrottling(4)`. Also send `Emulation.setCPUThrottlingRate {rate: 4}` to every worker target from `page.on("workercreated")`.
  - Click Run, await `window.__benchResult`, and print JSON.
  - Assert that the page's `probe(42)` equals Node's `probe(42)`.
  - `--rate 1` runs unthrottled. `--serve` only serves the site and prints the URL.
- [ ] **Step 7: Confirm the throttle reaches the workers.** Run `node scripts/world-bench.mjs --rate 1`, then `node scripts/world-bench.mjs --rate 4`. Expected: warm ms per chunk at rate 4 is at least 3× rate 1. If not, the throttle missed the workers: fix the runner before trusting any number.
- [ ] **Step 8: Background tab.** Add `--hidden` to the runner: after starting, it opens and fronts a second tab for 10 s. Record the sustained rate while hidden. This is informational: risk 1 asks for it, and it doesn't gate.
- [ ] **Step 9: Safari.** Run `node scripts/world-bench.mjs --serve` and ask the owner to open the URL in desktop Safari, press Run, and paste the copied result. A phone run is welcome, but for information only: phones default to the text site.
- [ ] **Step 10: Decide.**
  - **Pass:** sustained ≥ **1.0 chunk/s** and start view ≤ **2000 ms**, in both throttled Chrome and Safari.
  - On a fail, apply the 5.5 ladder in order and re-measure after each rung:
    1. a fast first pass without scatter and hatching, refined later;
    2. pre-baked start-view chunks (~150 KB);
    3. limit boost over unbaked land.
  - Record raw numbers, machine, browser versions, the rung used (if any) and the verdict in `docs/superpowers/research/2026-11-17-bake-gate.md`.
- [ ] **Step 11:** Run `npm test`, `npx tsc --noEmit` and `npm run lint`. Expected: clean.
- [ ] **Step 12:** Commit with `git add src/world/core/probe* src/world/bench src/app/world-bench scripts/world-bench.mjs docs/superpowers/research/2026-11-17-bake-gate.md && git commit -m "feat(world): bake gate bench and probe"`. Show the owner the gate record. **Stop here if the gate failed after the ladder.**

---

### Task 1: RNG, hash, torus, lint

Slug `core-rng`. Model `composer-2.5`. Implementation files: `src/world/core/rng.ts`, `src/world/core/hash.ts`, `src/world/core/torus.ts`.

**Interfaces:**
- Produces in `hash.ts`:
  - `mix32(x: number): number`, lowbias32: `x ^= x>>>16; x = imul(x, 0x7feb352d); x ^= x>>>15; x = imul(x, 0x846ca68b); x ^= x>>>16`, returning a u32;
  - `hashString(s: string): number`, FNV-1a 32 over UTF-16 code units;
  - `hash2(x: number, y: number, seed: number): number = mix32((imul(x|0, 0x27d4eb2d) ^ imul(y|0, 0x165667b1) ^ mix32(seed>>>0)) >>> 0)`.
- Produces in `rng.ts`:
  - `interface Rng { next(): number; float(): number; int(n: number): number; range(lo: number, hi: number): number }`;
    - `next()` is a u32;
    - `float() = next() / 2^32`;
    - `int(n) = floor(float()·n)`;
    - `range(lo, hi) = lo + float()·(hi − lo)`;
  - `sfc32(a, b, c, d): Rng`, the standard 32-bit SFC;
  - `rngFor(seed: number, stream: string): Rng`:
    - `s = mix32(seed>>>0)` and `t = hashString(stream)`;
    - the state is `sfc32(s, t, mix32((s ^ t ^ 0x9e3779b9)>>>0), 1)`;
    - the first 12 outputs are discarded.
- Produces in `torus.ts`:
  - `wrap(i, n)` into `[0, n)`;
  - `wrapIndex(x, y, n)`;
  - `torusDelta(a, b, n)`, the minimum image of `b − a` in `[−n/2, n/2)`;
  - `torusDist2(ax, ay, bx, by, n)` and `torusDist(…)`;
  - `NB8_DX` and `NB8_DY` (`Int8Array`, in the order E, SE, S, SW, W, NW, N, NE) and `NB8_DIST` (`Float64Array`, 1 or `Math.SQRT2`).

- [ ] **D1: Tests.** `src/world/core/hash.test.ts`:

```ts
test("mix32 is lowbias32", () => {
  assert.equal(mix32(0), 0);
  assert.equal(mix32(1), 1753845952);
  assert.equal(mix32(0xffffffff), 1734902346);
});
test("hashString is FNV-1a over UTF-16 code units", () => {
  assert.equal(hashString(""), 2166136261);
  assert.equal(hashString("plan"), 3083585298);
  assert.equal(hashString("é"), 1812687940);
});
test("hash2 goldens, negative coordinates included", () => {
  assert.equal(hash2(1, 2, 3), 985587320);
  assert.equal(hash2(-1, 0, 0), 2536689590);
  assert.equal(hash2(6399, 6399, 42), 12173068);
});
```

`src/world/core/rng.test.ts`:

```ts
const take = (r: Rng, k: number) => Array.from({ length: k }, () => r.next());
test("sfc32 golden", () => assert.deepEqual(take(sfc32(1, 2, 3, 4), 5), [7, 34, 56623200, 188882296, 3431242869]));
test("rngFor golden per stream", () => {
  assert.deepEqual(take(rngFor(42, "plan"), 5), [1308842569, 2472499032, 2733774218, 4039674952, 1071932886]);
  assert.deepEqual(take(rngFor(42, "erode"), 3), [2119309550, 2284740473, 2793819132]);
});
test("streams are independent", () => {
  const a = new Set(take(rngFor(42, "plan"), 1000));
  assert.ok(take(rngFor(42, "erode"), 1000).filter((v) => a.has(v)).length <= 1);
});
test("float, int and range stay in bounds", () => { /* 1e5 draws: 0 ≤ float < 1; int(7) ∈ {0..6}; range(-3, 5) ∈ [-3, 5) */ });
test("float is next / 2^32 exactly", () => assert.equal(rngFor(7, "x").float(), rngFor(7, "x").next() / 4294967296));
```

`src/world/core/torus.test.ts`:

```ts
test("wrap", () => { assert.equal(wrap(-1, 10), 9); assert.equal(wrap(10, 10), 0); assert.equal(wrap(-21, 10), 9); });
test("wrapIndex", () => assert.equal(wrapIndex(-1, -1, 4), 15));
test("torusDelta is the minimum image in [-n/2, n/2)", () => {
  assert.equal(torusDelta(1, 9, 10), -2); assert.equal(torusDelta(9, 1, 10), 2);
  assert.equal(torusDelta(0, 5, 10), -5); assert.equal(torusDelta(0, 4, 10), 4);
});
test("distance across the corner seam", () => assert.ok(Math.abs(torusDist(0, 0, 6399, 6399, 6400) - Math.SQRT2) < 1e-12));
test("neighbour order E, SE, S, SW, W, NW, N, NE", () => {
  assert.deepEqual([...NB8_DX], [1, 1, 0, -1, -1, -1, 0, 1]);
  assert.deepEqual([...NB8_DY], [0, 1, 1, 1, 0, -1, -1, -1]);
  assert.deepEqual([...NB8_DIST], [1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2]);
});
```

`src/world/core/lint.test.ts`. The lint is Claude's deliverable and passes on its own. It works as follows:
- Walk `src/world/**/*.ts` and strip comments.
- Apply the arithmetic rules to the deterministic set, and the syntax rules to every file except tests.
- Export `findViolations(path: string, source: string): string[]`.

```ts
const ARITH: [RegExp, string][] = [
  [/\bMath\.(random|sin|cos|tan|pow|exp|expm1|log|log1p|log2|log10|atan2?|asin|acos|sinh|cosh|tanh|asinh|acosh|atanh|cbrt|hypot)\b/, "inexact Math"],
  [/\*\*/, "exponent operator"], [/\bDate\b/, "Date"], [/\bperformance\.now\b/, "clock"], [/\.sort\(/, "sort"],
];
const SYNTAX: [RegExp, string][] = [
  [/^\s*(export\s+)?(const\s+)?enum\s/m, "enum"], [/^\s*(export\s+)?(declare\s+)?namespace\s/m, "namespace"],
  [/from\s+["']@\//, "alias"], [/from\s+["']\.{1,2}\/[^"']*(?<!\.ts)["']/, "import without .ts"],
];
test("the lint catches each banned form", () => { /* one sample string per rule → findViolations flags it under gen/x.ts; bench/x.ts is exempt from ARITH */ });
test("src/world has no violations", () => assert.deepEqual(scanAll(), []));
```

- [ ] **D2–D8**, with tests `src/world/core/{hash,rng,torus,lint}.test.ts`.

---

### Task 2: Periodic rotated gradient noise

Slug `core-noise`. Model `grok-4.7-high`. *Golden*: `fbm` over a 64² grid at `(x/8, y/8)`, period 8, 6 octaves, gain 0.5, seed 7. Implementation file: `src/world/core/noise.ts`.

**Interfaces:**
- Consumes `hash2` and `wrap`.
- Produces:
  - `GRADIENTS: Float64Array`: 32 literals, where gradient k is `(cos k·22.5°, sin k·22.5°)` typed as constants.
  - `gradNoise(x: number, y: number, period: number, seed: number): number`:
    - lattice coordinates wrap mod `period`;
    - the gradient index is `hash2(wrap(ix), wrap(iy), seed) & 15`;
    - quintic fade `6t⁵ − 15t⁴ + 10t³`;
    - the result is scaled by `Math.SQRT2`.
  - `octaveMatrixPower(k: number): [number, number, number, number]`, Mᵏ for `M = [[2, 1], [−1, 2]]` in row-major order. Octave k samples at `Mᵏ·(x, y)`.
  - `fbm(x, y, period, octaves, gain, seed): number`:
    - the sum of `gainᵏ · gradNoise(Mᵏ·p, period, seedₖ)` divided by the sum of `gainᵏ`;
    - `seedₖ = (seed + imul(k, 0x9e3779b9)) >>> 0`;
    - `gainᵏ` is built by multiplication.
  - `ridgedFbm(x, y, period, octaves, gain, seed): number`, the same sum over `1 − |gradNoise|`, in `[0, 1]`.

**Notes:** Callers pass `wrap(cell)/featureCells` with `period = n/featureCells`, an integer. Tiling is exact because M is an integer matrix.

- [ ] **D1: Tests.** `src/world/core/noise.test.ts`. Use dyadic inputs (`k/1024`) wherever exact equality is asserted:

```ts
const dy = (r: Rng) => r.int(8192) / 1024;
test("16 unit gradients at k·22.5°", () => { for (let k = 0; k < 16; k++) { assert.ok(Math.abs(GRADIENTS[2*k] - Math.cos(k*Math.PI/8)) < 1e-15); assert.ok(Math.abs(GRADIENTS[2*k+1] - Math.sin(k*Math.PI/8)) < 1e-15); } });
test("octave matrix powers", () => { assert.deepEqual(octaveMatrixPower(1), [2, 1, -1, 2]); assert.deepEqual(octaveMatrixPower(2), [3, 4, -4, 3]); });
test("zero on lattice points", () => { for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) assert.equal(Math.abs(gradNoise(x, y, 8, 1)), 0); });
test("gradNoise, fbm and ridgedFbm tile exactly", () => { /* 2000 dyadic (x,y): f(x+8,y) === f(x,y), f(x,y+8) === f(x,y), f(x+16,y) === f(x,y), for each of the three at period 8, fbm/ridged with 6 octaves gain 0.5 */ });
test("ranges", () => { /* 1e5 samples: |gradNoise| ≤ 1+1e-12; |fbm| ≤ 1+1e-12; 0 ≤ ridgedFbm ≤ 1 */ });
test("continuous", () => { /* 2e4 samples: |fbm(x+1e-4,y) − fbm(x,y)| < 2e-3 */ });
test("isotropic", () => { /* fbm 6 octaves: mean squared directional derivative (step 1e-3) along 0°, 45°, 90°, 135° over 4e4 samples, each within 10 % of the four's mean */ });
```

- [ ] **D2–D9**, with tests `src/world/core/noise.test.ts`.

---

### Task 3: B-spline upsample, polynomial sine, heap

Slug `core-math`. Model `grok-4.7-high`. Implementation files: `src/world/core/bspline.ts`, `src/world/core/psin.ts`, `src/world/core/heap.ts`.

**Interfaces:**
- Produces in `bspline.ts` (periodic uniform cubic B-spline; fine cell `i` sits at node coordinate `u = (i + 0.5)/f − 0.5`):
  - `bsplineAt(src: Float64Array, n: number, u: number, v: number): number`;
  - `upsampleBSpline(src: Float64Array, n: number, f: number): Float64Array`, of size `(n·f)²`;
  - `upsampleTile(src, n, f, x0, y0, w, h): Float64Array`, the fine cells `[x0, x0+w) × [y0, y0+h)`, wrapped. It must use the same per-cell routine as `upsampleBSpline`, so a tile equals the crop bit for bit.
- Produces in `psin.ts`:
  - `PI` as a literal;
  - `psin(x: number): number`: range reduction by `k = floor(x/PI + 0.5)`, then an odd polynomial on `[−π/2, π/2]`;
  - `pcos(x) = psin(x + PI/2)`.
- Produces in `heap.ts`:
  - `class MinHeap { constructor(capacity: number); push(key: number, index: number): void; pop(): number; peekKey(): number; get size(): number; clear(): void }`:
    - it orders by `(key, index)`;
    - `pop` returns the index;
    - pushing past capacity throws `RangeError`.
  - `sortIndicesBy(keys: ArrayLike<number>): Uint32Array`, indices in `(key, index)` order, built without `.sort`.

- [ ] **D1: Tests.** `src/world/core/bspline.test.ts`:

```ts
test("constant in, constant out", ...);                           // src all 3.25 → every output === 3.25 (±1e-12)
test("convex hull of the 4×4 node patch", ...);                   // random src n=16, f=4: each output within [min,max] of nodes floor(u)-1..floor(u)+2 (wrapped) in both axes
test("linear precision away from the wrap", ...);                 // src[y*n+x] = x, n=32, f=4: outputs whose patch avoids the wrap equal u within 1e-12
test("tile equals the crop, across the seam", ...);               // assert.deepEqual(upsampleTile(src,16,4,x0,y0,37,29), crop(upsampleBSpline(src,16,4))) for x0,y0 ∈ {0, 50, -7, 61}
test("bsplineAt agrees with upsample at fine-cell centres", ...); // within 1e-12
```

`src/world/core/psin.test.ts`:

```ts
test("psin within 1e-4 of sin on [-1000, 1000]", ...);  // 1e5 samples vs Math.sin
test("odd and 2π-periodic to 1e-12", ...);
test("psin(0) === 0 and pcos(0) within 1e-12 of 1", ...);
```

`src/world/core/heap.test.ts`:

```ts
test("pops in (key, index) order with heavy ties", () => {
  const r = rngFor(1, "heap-test"), n = 5000, keys = new Float64Array(n);
  for (let i = 0; i < n; i++) keys[i] = r.int(4);
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = r.int(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
  const h = new MinHeap(n); for (const i of order) h.push(keys[i], i);
  const got: number[] = []; while (h.size > 0) got.push(h.pop());
  assert.deepEqual(got, [...order].sort((a, b) => keys[a] - keys[b] || a - b));
});
test("push past capacity throws RangeError", ...);
test("sortIndicesBy matches a stable (key, index) sort", ...);  // 5000 keys with ties and negatives
```

- [ ] **D2–D8**, with tests `src/world/core/{bspline,psin,heap}.test.ts`.

---

### Task 4: Blue-noise mask

Slug `core-bluenoise`. Model `grok-4.7-high`. Implementation files: `src/world/core/bluenoise.ts`, `scripts/world-bluenoise.ts`, `public/world/bluenoise.bin`.

**Interfaces:**
- Consumes `rngFor`, `MinHeap` if wanted, and the torus helpers.
- Produces:
  - `voidAndCluster(size: number, seed: number): Uint16Array`. It returns ranks, with each of `0 … size² − 1` exactly once. The energy is a toroidal Gaussian with σ = 1.5, and the initial pattern is 10 %.
  - `ranksToU8(ranks: Uint16Array): Uint8Array`, defined as `rank >> (31 − clz32(ranks.length) − 8)`. Sizes are powers of two.
  - `BLUE_SEED = 1`.
- `scripts/world-bluenoise.ts` writes `ranksToU8(voidAndCluster(256, BLUE_SEED))` to `public/world/bluenoise.bin`. Cursor runs it and commits the 65,536-byte file.

**Notes:** At 256² a naive arg-max scan is too slow; keep it under 60 s in Node (block maxima or a heap with lazy updates; builder's choice).

- [ ] **D1: Tests.** Claude writes `src/world/testing/spectrum.ts`:
  - `radialPower(values: ArrayLike<number>, size: number): { below125: number; below25: number }`;
  - it uses a separable DFT, takes the mean power below 0.125 and below 0.25 cycles per cell excluding DC, and divides by the mean non-DC power.

`src/world/core/bluenoise.test.ts`. Thresholds are calibrated on a scratch reference: 0.000 and 0.009 against white noise's 1.10 and 1.02.

```ts
const r64 = voidAndCluster(64, 1);
test("each rank exactly once", () => assert.deepEqual([...r64].sort((a, b) => a - b), Array.from({ length: 4096 }, (_, i) => i)));
test("deterministic", () => assert.deepEqual(voidAndCluster(64, 1), r64));
test("u8 histogram is flat", () => { /* ranksToU8(r64): each of 0..255 appears exactly 16 times */ });
test("low frequencies suppressed", () => { const p = radialPower(r64, 64); assert.ok(p.below125 <= 0.05 && p.below25 <= 0.2); });
test("toroidal: the lowest 10 % are at least 1.5 apart across the seams", ...);  // minimum torusDist over pairs of ranks < 410
test("committed bluenoise.bin", () => { /* 65536 bytes; each value exactly 256 times; radialPower ≤ 0.05 / 0.2 */ });
```

- [ ] **D2–D8**, with tests `src/world/core/bluenoise.test.ts`.

---

### Task 5: Plan: cores, spines, uplift, rock, regions

Slug `gen-plan`. Model `grok-4.7-high`. *Golden*: `planWorld(paramsFor(1024), 42)`. Implementation file: `src/world/gen/plan.ts`.

Claude writes `src/world/gen/params.ts` in D1. Its values are look work and stay with Claude.

```ts
export const ARCHETYPE = { home: 0, highland: 1, slate: 2, lakes: 3, karst: 4, skerry: 5 } as const;
export type Archetype = (typeof ARCHETYPE)[keyof typeof ARCHETYPE];
export const ROCK = { hard: 0, medium: 1, soft: 2 } as const;
export interface ArchetypeSpec { id: Archetype; count: readonly [number, number]; diameter: readonly [number, number]; peak: number; rockBias: readonly [number, number, number] }
export interface WorldParams {
  n: number; gN: number; cN: number;                                   // n/4, n/8
  cores: { poissonR: number; archetypes: readonly ArchetypeSpec[] };   // poissonR 900 at 6400
  strike: { maxSlope: number };                                        // tan 25° = 0.4663076581549986 about west–east
  spine: { segments: readonly [3, 6]; ridges: readonly [2, 3]; ridgeGap: number; halfWidth: number };
  uplift: { scale: number; base: 0.55; ridgedAmp: 0.45; stretch: 3 };
  rock: { stripeWidth: readonly [300, 600]; kMul: readonly [0.4, 1, 2.2]; kBase: number };
  regions: { blend: readonly [100, 200] };
  erode: { cSteps: 150; gSteps: 40; dtC: number; dtG: number; eps: number; jitter: 0.4; upsampleNoise: 0.02; uniformRainSteps: 75; stopAt: 0.75; diffusionSweeps: number; d: readonly number[] /* per archetype */ };
}
export function paramsFor(n: number): WorldParams;                     // n % 64 === 0; lengths × n/6400; heights unscaled
```

**Interfaces:**
- Consumes `rngFor(seed, "plan")`, `fbm`, `ridgedFbm`, `torusDist` and `paramsFor`.
- Produces:
  - `interface Core { x: number; y: number; archetype: Archetype; radius: number; spine: Float64Array }`. `spine` holds unwrapped polyline points `x0, y0, x1, y1, …` in cells.
  - `interface Plan { n: number; cores: Core[]; uplift: Float64Array; k: Float64Array; d: Float64Array; rock: Uint8Array; regions: Float32Array }`:
    - every array is on C (`n = cN`);
    - `regions` is 6 planes, archetype-major.
  - `planWorld(p: WorldParams, seed: number): Plan`. It throws `Error` with "cores" in the message when Poisson placement cannot meet the quota within `64 × count` attempts.

**Notes (S1):**
- Steps 1–6 of S1, in this order.
- The quota is 1 home, 1 highland, 1 slate, 1 lakes, 2 karst and 5–7 skerries, so 11–13 cores. The spec's "10–13" cannot hold with that quota.
- One global strike vector `(1, t)/√(1 + t²)` with `t ∈ [−maxSlope, maxSlope]`.
- `U = amp · plateau(dist/halfWidth) · (base + ridgedAmp · ridgedFbm stretched 3:1 along strike)`, where `amp = peak · uplift.scale`.
- K is warped stripes along the strike, `kBase · kMul[rock]`.
- `d` blends `erode.d` by region weight.
- Region weights sum to 1 at every node.

- [ ] **D1: Tests.** Claude writes `params.ts` and `src/world/testing/seam.ts`:
  - `seamRatio(a: ArrayLike<number>, n: number): number` is the maximum |Δ| across the x and y wraps, divided by the maximum interior |Δ|.

`src/world/gen/plan.test.ts`:

```ts
const p = paramsFor(1024), plan = planWorld(p, 42), cN = p.cN;
test("arrays sized to C", () => { assert.equal(plan.n, 128); for (const a of [plan.uplift, plan.k, plan.d, plan.rock]) assert.equal(a.length, cN * cN); assert.equal(plan.regions.length, 6 * cN * cN); });
test("archetype quota", () => { /* home, highland, slate, lakes each 1; karst 2; skerry 5..7; total 11..13 */ });
test("Poisson spacing on the torus", () => { /* all pairs: torusDist ≥ p.cores.poissonR */ });
test("spines run within 25° of west–east with 3–6 segments", () => { /* |dy| ≤ maxSlope·|dx| + 1e-9 for end − start; segment count in [3, 6] */ });
test("erodibility uses the three rock multipliers, all present", () => { /* k[i] === kBase·kMul[rock[i]] within 1e-12; set of rock values has size 3 */ });
test("region weights sum to one", () => { /* every node: |Σ_a regions[a·cN²+i] − 1| ≤ 1e-6 */ });
test("uplift ≥ 0 and land share before erosion is 0.25–0.50", () => { /* share of uplift > 0 */ });
test("deterministic by seed", () => { assert.deepEqual(planWorld(p, 42), plan); assert.notDeepEqual(planWorld(p, 43).uplift, plan.uplift); });
test("no seam at the wrap", () => { for (const a of [plan.uplift, plan.d]) assert.ok(seamRatio(a, cN) <= 1); for (let r = 0; r < 6; r++) assert.ok(seamRatio(plan.regions.subarray(r*cN*cN, (r+1)*cN*cN), cN) <= 1); });
test("an impossible quota throws, naming the cores", () => assert.throws(() => planWorld({ ...p, cores: { ...p.cores, poissonR: 600 } }, 42), /cores/));
```

- [ ] **D2–D9**, with tests `src/world/gen/plan.test.ts`.

---

### Task 6: Priority-Flood, receivers, accumulation

Slug `gen-flood`. Model `grok-4.7-high`. Implementation file: `src/world/gen/flood.ts`.

**Interfaces:**
- Consumes `MinHeap`, the `NB8_*` tables, `wrapIndex` and `rngFor`.
- Produces:
  - `interface Jitter { amp: number; jx: Float32Array; jy: Float32Array }` and `makeJitter(n: number, amp: number, seed: number): Jitter`. Offsets lie in `[−amp, amp]`, from stream `"jitter"`.
  - `priorityFlood(h: Float64Array, n: number, isSea: Uint8Array, eps: number): { filled: Float64Array; order: Uint32Array }`:
    - Barnes 2014 with +ε;
    - sea nodes seed the queue and keep their heights;
    - `order` lists all n² nodes in pop order.
  - `receivers(f: Float64Array, n: number, isSea: Uint8Array, jitter: Jitter | null): { rcv: Int32Array; dist: Float64Array }`:
    - steepest descent over the 8 wrapped neighbours;
    - distance is `√((dx + jx[j] − jx[i])² + (dy + jy[j] − jy[i])²)`;
    - ties go to the lowest neighbour node index;
    - a sea node has `rcv[i] = i` and `dist = 0`.
  - `accumulate(order: Uint32Array, rcv: Int32Array, isSea: Uint8Array, rain: Float64Array | null): Float64Array`. Land starts at `rain[i]` (or 1), sea at 0, summed down the reversed order.

- [ ] **D1: Tests.** Claude writes `src/world/testing/fixtures.ts`, which task 7 reuses:
  - `columnSea(n, fill)`: column x = 0 is sea at height 0, and every other node is `fill`;
  - `bumpy(n, seed)`: sea where a noise is below 0.2, land heights 0–10 with interior pits.

`src/world/gen/flood.test.ts`:

```ts
test("filled ≥ h and sea unchanged", ...);
test("no pits: every land node's receiver is strictly lower", ...);             // bumpy(64): f[rcv[i]] < f[i]
test("every land node reaches the sea, some across the x seam", ...);          // follow rcv ≤ n² steps; count steps from x=n−1 to x=0 > 0
test("pop order is topological", ...);                                          // position[rcv[i]] < position[i] for land
test("sea areas sum to the land area", ...);                                    // Σ A over sea === land count (rain null)
test("ties break by lowest node index", ...);                                   // brute-force reference over the 8 neighbours on columnSea(16, 1)
test("a 128² plateau at height 100 drains everywhere", ...);                    // columnSea(128, 100), eps 1e-6: all reach sea; max(filled) − 100 ≤ 1e-6·128
test("jitter is in range, deterministic, and used in distances", ...);
```

- [ ] **D2–D8**, with tests `src/world/gen/flood.test.ts`.

---

### Task 7: Stream-power solver, diffusion, schedule, lattice resample

Slug `gen-erode`. Model `grok-4.7-high`. *Golden*: `runSchedule` on the mini-world, seed 42. Implementation files: `src/world/gen/erode.ts`, `src/world/gen/resample.ts`.

**Interfaces:**
- Consumes `priorityFlood`, `receivers`, `accumulate`, `makeJitter`, `upsampleBSpline`, `fbm`, `planWorld`, `paramsFor` and `rngFor(seed, "erode")`.
- Produces in `erode.ts`:
  - `interface ErodeState { n: number; h: Float64Array; uplift: Float64Array; k: Float64Array; d: Float64Array; isSea: Uint8Array; jitter: Jitter | null; rain: Float64Array | null; eps: number; diffusionSweeps: number }`
  - `interface StepStats { erosionFlux: number; upliftFlux: number }`:
    - `upliftFlux = Σ_land U·dt`;
    - `erosionFlux = Σ_land (h + U·dt − h_after_fluvial)`.
  - `erodeStep(s: ErodeState, dt: number): StepStats`. It mutates `s.h` and runs the S2 `step()` exactly:
    1. flood;
    2. receivers;
    3. accumulate;
    4. for each node in pop order, `F = K·dt·√A / dist` and `h = max((h + U·dt + F·h_rcv)/(1 + F), h_rcv + ε)`;
    5. `diffuseImplicit`.
  - `diffuseImplicit(h: Float64Array, n: number, d: Float64Array, dt: number, sweeps: number, fixed: Uint8Array | null): void`. It runs Jacobi sweeps on `(I − dt·D∇²)h' = h`, and fixed nodes are never written.
  - `runSchedule(plan: Plan, p: WorldParams, seed: number): { g: Float64Array; gN: number; isSea: Uint8Array; stepsC: number; steadinessC: number; steadinessG: number }`. The steps:
    1. Initial C heights: −1 where `uplift = 0`, else `0.1·(fbm + 1)`.
    2. Jittered C, up to `cSteps` steps, stopping early once steadiness reaches `stopAt`.
    3. Resample to the lattice.
    4. `upsampleBSpline` ×2 to G, plus `upsampleNoise` relative noise.
    5. `gSteps` steps on jittered G.
    6. Resample to the lattice.
    7. Fill the small pits the resample leaves: `g = priorityFlood(g, gN, isSea, eps).filled`.
- Produces in `resample.ts`: `resampleToLattice(h: Float64Array, n: number, jitter: Jitter): Float64Array`, using inverse bilinear within the jittered quads and searching neighbouring quads when the point falls outside.

**Notes:**
- Rain is uniform throughout in this part. The orographic switch after step 75 waits for task 11 (Part 2).
- Hold `isSea` fixed during the C stage. Recompute it at G as `h ≤ 0`.
- U, K and D reach G by B-spline upsampling.

- [ ] **D1: Tests.** Claude writes `src/world/testing/sha.ts` (`sha256Hex(view: ArrayBufferView): string`) and `src/world/testing/schedule.worker.ts`. The worker runs `runSchedule(planWorld(paramsFor(n), seed), paramsFor(n), seed)` from `workerData` and posts `sha256Hex(g)`.

`src/world/gen/erode.test.ts`:

```ts
test("a uniform-uplift channel reaches the analytic steady profile", () => {
  // n = 65; column 0 is sea; every row identical; U = 1e-3, K = 1e-4, D = 0, no jitter, eps = 1e-9; 300 steps of dt = 1e4.
  // West chain x = 1..32 drains west with A(x) = 33 − x; east chain x = 33..64 drains east across the seam with A(x) = x − 32.
  // Expected: h(x) = Σ_{j=1..x} U/(K√(33−j)) on the west, Σ_{j=x..64} U/(K√(j−32)) on the east.
  // Assert every node within 1e-6 relative, and erosionFlux/upliftFlux within 1e-6 of 1 on the last step.
});
test("with U = 0 and D = 0 no node rises on a pit-free field", ...);   // bumpy(64) pre-filled by priorityFlood; 20 steps of dt = 100: h_after ≤ h_before + 1e-12
test("implicit diffusion conserves mass on an all-land torus", ...);   // random h, d = 0.5, dt = 10, 8 sweeps, fixed null: |Σ after − Σ before| ≤ 1e-9·Σ|h|
test("diffusion never writes fixed nodes", ...);
const p = paramsFor(1024), plan = planWorld(p, 42);
const run = runSchedule(plan, p, 42);
test("schedule output is sized, finite and pit-free", ...);           // gN = 256; all finite; after priorityFlood(run.g, gN, run.isSea, 0) the filled surface equals g on land within 1e-6
test("schedule reports steadiness and stops early or at the cap", ...);  // 0 < steadinessC ≤ 1.5; steadinessC ≥ stopAt || stepsC === cSteps
test("no seam at the wrap after erosion", () => assert.ok(seamRatio(run.g, run.gN) <= 1));
test("deterministic twice and in a worker_threads worker", async () => { /* sha256Hex(runSchedule again) === sha256Hex(run.g) === hash posted by schedule.worker.ts */ });
```

`src/world/gen/resample.test.ts`:

```ts
test("zero jitter is the identity, exactly", ...);
test("a linear field is reproduced from jittered samples", ...);   // amp 0.4, n = 32: h[i] = 0.3·(x+jx) + 0.7·(y+jy); interior lattice points (2 ≤ x,y ≤ n−3) equal 0.3x + 0.7y within 1e-9
```

- [ ] **D2–D9**, with tests `src/world/gen/{erode,resample}.test.ts`.

---

### Task 30a: PNG encoder (pulled forward from task 30)

Slug `cli-png`. Model `composer-2.5`. Implementation file: `src/world/cli/png.ts`.

**Interfaces:** Produces `encodePng(rgba: Uint8Array, w: number, h: number): Uint8Array`. It writes 8-bit RGBA (colour type 6), filter 0 on every row, one IDAT from `node:zlib` `deflateSync`, and CRC-32 per chunk.

- [ ] **D1: Tests.** `src/world/cli/png.test.ts`, with a small decoder (`inflateSync`, filter 0 only) inside the test:

```ts
test("signature and IHDR", ...);                  // bytes 0..7 = 137,80,78,71,13,10,26,10; width and height big-endian; depth 8; colour type 6
test("round-trips a 37×23 random image", ...);    // decode(encodePng(px, 37, 23)) deep-equals px
test("IEND CRC is ae426082", ...);
test("rejects a buffer of the wrong length", ...); // throws RangeError
```

- [ ] **D2–D8**, with tests `src/world/cli/png.test.ts`.

---

### Task 7a: Hillshade preview (Claude)

**Files:**
- Create: `src/world/cli/preview.ts`, `src/world/cli/preview.test.ts`, `scripts/world-preview.ts`
- Modify: `package.json` (add `"world:preview": "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/world-preview.ts"`)

**Interfaces:**
- Produces `hillshadeRGBA(h: Float64Array, n: number, opts: { sea: number; scale: number }): Uint8Array`. It uses Lambert shading from the design sun (north-west, 63° up), a height ramp, flat sea colour, and downsampling by `scale`.
- Produces `main(argv: string[]): Promise<void>`, taking `--n`, `--seeds 1,2,…` and `--crops`.

**Renders [Call]** go to `.cache/world-renders/preview/<n>-<seed>/`, not the spec's `out/world-renders/`, because `next build` replaces `out/`. Each seed gets:
- `hillshade.png` at G;
- `map16.png`, the whole world at 1/16;
- a drainage map shaded by `√A`;
- 6 crops of 400 × 225 cells at G resolution, one per archetype core;
- `metrics.json`: steadiness, steps, land share, and time per stage.

Several seeds also get a contact sheet, `sheet.png`.

- [ ] **Step 1:** Write `preview.test.ts`: a flat land field gives one colour, sea pixels get the sea colour, and the output length is `(n/scale)²·4`. Run it and see it fail.
- [ ] **Step 2:** Implement `preview.ts` and the script. Run `wt src/world/cli/preview.test.ts`. Expected: PASS.
- [ ] **Step 3:** Run `npm run world:preview -- --n 1024 --seeds 1,2,3,4,5,6`, then `--n 6400 --seeds <best two>`. Expected: PNGs written and the full world in under 2 minutes. Record the times.
- [ ] **Step 4:** Commit with `git add src/world/cli/preview* scripts/world-preview.ts package.json && git commit -m "feat(world): hillshade preview"`.

---

### Task 7b: First critic pass on erosion (Claude)

This is the risk-2 gate: is the erosion uniform and fern-like? It runs before any of Part 2.

- [ ] **Step 1:** Spawn two critics in parallel, each a fresh `Agent` with no view of the other. Each gets the preview PNG paths for two full-world seeds and the six crops, plus rubric criteria 1 (water shaped the land), 4 (mountain structure) and 7 (artifacts: grid, seams, streaks). Each:
  - scores each criterion 0–4, citing pixel boxes;
  - answers yes or no to "uniform, fern-like erosion";
  - names its three worst problems, with one `gen/params.ts` change apiece.
- [ ] **Step 2:** Change one parameter group per round, re-render and re-score. Stop after 3 rounds.
- [ ] **Step 3: Gate.** It passes when both critics give ≥ 3 on criteria 1, 4 and 7, and neither answers yes to fern-like erosion. Write each round's scores, the change tried and the verdict to `docs/superpowers/research/2026-11-17-erosion-critic.md`. Commit it with the `params.ts` changes.
- [ ] **Step 4:** Show the owner a contact sheet and the verdict. On a pass, write the Part 2 plan (tasks 8–22). On a fail after 3 rounds, bring the renders and the critics' top problems to the owner before building more.
