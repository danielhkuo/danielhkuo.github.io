# Critique: engineering and testability lens

Reviewer lens: determinism, wrap, offline bake, download size, phone frame cost, streaming, risk, and whether each task has a test seam crisp enough for cursor-delegate (Claude writes tests, Cursor implements, a clean-copy check decides).

Scores are 1 (bad) to 5 (good). Abbreviations: Real = realism, Art = art fit at pixel scale, Wrap = seams and wrap, Bud = budgets, Det = determinism, Test = testability, Risk = 5 means low risk.

## Experiments run (throwaway Node, outside the repo)

1. **Epsilon Priority-Flood plus steepest-descent receivers on a 96² torus, rolled by (13, 29).** Flooded heights come out bit-identical after the roll, but receiver ties (about 1,150 nodes with exactly equal slopes) are broken by index, and drainage area then differs on 58 to 95 nodes out of 9,216. Over 200 erosion steps this compounds. So the "roll invariance" test in P1 (section 3, tasks 4 to 6) and "translating input translates output" in P2 (task 5) would fail on a correct implementation. Index tie-breaks are deterministic but not translation-invariant. Test translation only on tie-free fixtures, or assert statistical invariants.
2. **KY = 0.8 row wrap in floats.** For W = 7680 (P1) and 6400 (P3) `floor((y+W)*0.8 - h)` equals `floor(y*0.8 - h) + period` for every y and h tried; 4096 with 0.75 (P2) is exact too. A world of 6144 would break (period 4915.2). Integer `floor(4*y/5)` was also exact. So the wrap arithmetic is safe, provided the sizes stay multiples of 5 and the bake uses integer row maths.
3. **Not verified.** I tried to measure lattice-period stripes in Sobel shading of a Catmull-Rom upsample from a 4-cell node grid (P3) against a cubic B-spline (P2). My measure returned zero for both, so it proved nothing. P2's own experiment claims stripes; treat it as a risk for P3, not a fact.

Arithmetic checks that held: P2's 1/J0(omega) sinuosity values (1.24, 1.49, 1.95) are right. P1's hex-packing pacing numbers (2383 and 3120 cells) are right. P1's 8,500-point Poisson set at r = 2.2 on 256² is plausible (random sequential adsorption gives about 9,400 at saturation). Math.sqrt is correctly rounded by spec, so the "no sin/cos/pow" rule is sound for cross-engine bit equality; V8 itself uses one fdlibm port on all platforms, so the ban mostly guards against Node-version drift and non-V8 engines (iOS Safari).

---

## P1: Fable, geomorphology (7680², ship 3840² heightfield, client bake)

**Strengths**
- Best determinism discipline in the set: per-stage RNG streams, the arithmetic whitelist, integer-matrix noise octaves (exact tiling, measured wrap difference 0), a fixed polynomial where a sine is needed.
- Best test seams on the numerical core: analytic steady slope under uniform uplift (task 6), mass conservation to 1e-3 in talus (task 8), no pits, topological order, "E is 0 in a closed lagoon and 1 on an open islet" (task 9), pad flat within 0.25 and still pit-free after conform (task 15). Each is a pure function of typed arrays, so Cursor can be judged mechanically.
- Parameters that set character are isolated in `look/*.ts` and `gen/params.ts` with no logic, so tuning does not fight tests.
- Tile layout divides the world exactly (30 x 24 chunks, 15 x 15 data tiles, no duplicated borders, neighbours held by the client). The exact O(1) diagonal shadow sweep is correct and testable against a brute-force march.
- Versioned asset path (`world/<version>/`) and a sticky site assignment file.
- Richest geography: structured uplift and rock stripes (trellis valleys), exposure-driven coasts, talus with a debris layer, vectorised rivers with meanders, waterfalls at hard/soft contacts.

**Fatal or serious flaws**
- **Budget arithmetic contradicts itself (section 4).** The file table lists 12 postcards at about 200 KB (2.4 MB) but "expected totals" of 2.6 to 3 MB exclude them, and the stated budget is 3.5 MB total. The real total is about 5.4 to 6 MB. Postcards are also baked pixels that must match the live bake exactly (or the first frame pops), and every look change invalidates them and bloats git by 2.4 MB per commit of them.
- **Bake cost is understated (section 5.3).** "256 x 320 new cells" ignores the apron: HMAX 224 means the painter's pass needs about 280 rows south (224 / 0.8) plus 80 cells of shadow apron, so a chunk touches roughly 340 x 600 cells, not 82 k. At the stated 2.7 us/cell that is about 0.5 s on a desktop and 2 s or more on a mid-range phone, against 0.7 to 1.3 chunks/s demanded. Marginal even with two workers, and one worker (low `hardwareConcurrency`) fails at boost.
- **No never-blank fallback** when a chunk is not baked yet (only site postcards exist). P3's haze backdrop is the missing piece.
- **Peaks to 160 px in a 225-row viewport (section 1.2).** A mountain 100 cells south of the dragon hides it (depth test). The risk list only mentions land hidden behind peaks, not the dragon. This is an art and playability flaw as much as an engineering one.
- **Roll-invariance tests will fail** (experiment 1) for the erosion stage, and "seam height step under the 99.9th percentile" is a statistical check with no defined fixture size. Tests must run on small worlds, but every length parameter (1100-cell cores, 600-cell fetch rays) is in absolute cells; nothing says how a 256² fixture is parameterised.
- **Manifest hashes of compressed files (task 18).** Node's zlib output is not guaranteed identical across zlib versions. A "same seed gives the same manifest hash" golden test should hash pre-compression arrays.
- **Depth plane u16 in eighths** covers 7680 rows x 8 = 61,440 plus height, with almost no headroom, and absolute depth makes the dragon depth test wrong across the wrap unless depths are made tile- or camera-relative. Not addressed.
- **1 px rivers rasterised in world cells under KY = 0.8** lose rows (see P2 flaw-finding below): an E-W 1-px stream on the dropped row vanishes entirely. No test covers it.
- **Site order is circular:** sites (S9) before roads (S10), but bridge sites are "chosen after S10" from road crossings; if roads cross fewer than two w >= 3 rivers there is no bridge, and no fallback or seed-rejection rule exists for any missing type.
- Total task count (25) is fine, but tasks 19 and 21 carry timing assertions ("time budget") that are machine-dependent in a clean-copy check, and task 19's "offline reference" does not exist (there is no offline bake).

| Realism | Art | Wrap | Bud | Det | Test | Risk |
|---|---|---|---|---|---|---|
| 5 | 3 | 5 | 2 | 4 | 4 | 2 |

---

## P2: Opus, art first (4096², KY 0.75, ship 1024² recipe, no streaming)

**Strengths**
- Smallest and simplest delivery: 0.75 to 0.95 MB gzip for the whole world, loaded once, no streaming scheduler, no proximity logic. Easily inside every budget with 8 MB of headroom. Uses `DecompressionStream('gzip')`, the most widely supported form.
- KY = 0.75 makes the screen wrap exact in binary and removes the dropped-row hazard; the observation that 1-px rivers vanish on dropped rows under 0.8 is correct and unique to P2. Rivers, roads and hedges drawn as screen-space polylines with an 8-connectivity gate is the right fix.
- Stage cache (`.cache/world/<seed>/<stage>.bin`) so tuning a late stage never reruns erosion: the best offline iteration loop of the three.
- Most useful automated look gates (seams identical, ink coverage, hatch coverage, river connectivity, FFT grid detector, stair detector, tone clipping), cheap to run before any critic call.
- Measured data where it matters: 419 KB for 1024² u16 heights, 135 ms per erosion iteration, 150 to 190 ms for 347 k cells of a throwaway bake. Highest density of honest measurements.
- Stamped scatter (trees and rocks written into heights) gives shadows, depth test and ink for free. Cover rules keyed on HAND are cheap and testable as pure functions.
- Biggest art payoff: fields, hedges and walls, region accents, OKLab ramps, first-minute script.

**Fatal or serious flaws**
- **Bake depends on the visit clock (section 9, "tiles bake per visit ... golden hour climb 0.6" and section 14 question 2: season moves cover).** The fact sheet says time, season and weather are palette and overlay work so the bake never re-runs. P2 puts the sun, snowline and cover into the bake. That breaks bake purity (output depends on `Date`), makes the critic harness enumerate bake variants, forbids postcards and any cached bake, and makes low-sun shadow marches (longer rays) more expensive on phones. Keep the bake fixed-sun and put time and season in the palette (P1/P3).
- **Jitter vs upsample mismatch (section 3).** The solver measures distances from jittered node positions (plus or minus 0.4 node, up to 1.6 cells), but the B-spline upsample samples a regular lattice, and rivers and floodplains are traced from the jittered positions. Channels and valleys can disagree by about 1.5 cells, enough to put a 1-px river on a slope. Either resample heights at the jittered positions or snap vectors back. Not mentioned.
- **No-streaming, per-visit bake means first flight is bake-bound.** About 12 cell tiles at an assumed 300 ms each is 1.8 s with two workers, 3.6 s with one, plus pixel tiles and decode, against a 2 s interactive target. No postcards, no pre-baked spawn (it is offered only as a fallback). The "5x slower phone" figure is a guess.
- **Site constraint is too strong for a seed sweep.** The abbey rule (spur 25 to 45 px above a river, home river reaching a sheltered beach in 1,500 to 2,400 channel cells, town bay facing east, exposed coast facing west) is a multi-constraint search; the sweep runs at 256² (about 5 s), where valley spacing and pad sizes differ, so its "site scores" are not predictive of the full-resolution result. Seed acceptance needs the full pipeline.
- **Cross-island roads unresolved.** MST plus 20% edges over all sites, with water crossings "allowed only where w <= 4", has no answer for sites on different islands (the world is four islands separated by 150 to 400 cells of sea).
- **Coast class at 512² (8 cells per sample) drives per-pixel cliff and beach stamps**, so transitions between cliff and beach will be 8-cell blocks unless the blue-noise jitter hides them.
- **Test seams that judge look or timing:** task 19 ink-coverage gate (1.5 to 6%), task 18 "80 ms per tile" and task 20 "1 ms per frame in the bench" are parameter or machine dependent and will make Cursor thrash; they belong to Claude or to a non-blocking bench. "Translating input translates output" (task 5) fails on ties (experiment 1). Meanders use sine and cos, contradicting the stated ban; positions are quantised to quarter cells, so drift is rare but nonzero.
- Pacing at 4096² gives 28 s between 7 landmarks, 21 s with 12, below the 30 to 60 s bar if the portfolio grows; 45% land also means little sea rest. KY change from 0.8 to 0.75 ripples into the dragon, sprite stacks and shadow offsets (a deliberate owner question, but an unpriced one).
- 128² blue-noise period is visible in dense forest; P2 lists it, but the 256² fallback is only a note.

| Realism | Art | Wrap | Bud | Det | Test | Risk |
|---|---|---|---|---|---|---|
| 4 | 5 | 4 | 5 | 3 | 3 | 3 |

---

## P3: Sonnet, engineering (6144 x 6400, ship 1536 x 1600 macro grid in packs)

**Strengths**
- Best determinism verification: SHA-256 per stage in a committed `golden.json`, double-run in one process, once through a `worker_threads` worker, and a CI matrix (macOS arm64, Linux x64) on pinned Node. Total-order tie-breaks `(key, index)` and a banned-API list including `Array.prototype.sort` without a total order. This is exactly what a CI-determinism requirement needs.
- Quantisation is the last generator step and downstream validation (rivers monotone, no new pits) runs on the quantised data (T11). Right idea.
- Best streaming story: packs of 4 x 4 tiles (75 KB), overview haze so the screen is never blank, prediction 6 s ahead, 250 KB before first flight, 3 MB total. Lowest LUT footprint (about 1 k entries, cache-friendly on phones).
- Clean task graph (T0 to T21) with a crop-equality seam ("tile equals crop of a bigger window; offset by a world period is identical") that covers tile edges and the wrap in one assertion.
- Crisp, mostly mechanical tests; the "stays with Claude" list is honest (look constants, rubric, seed choice, erosion constants judged by eye).

**Fatal or serious flaws**
- **Bake cost is not credible.** 80 to 150 ms for 203 k cells implies 0.4 to 0.7 us per cell, below the spike's own 1.33 us/cell, while adding a Catmull-Rom upsample, Sobel, stamps, ink and hatch, and re-upsampling the 2.5x apron per tile with no cell cache. At P1's 2.7 us/cell the same tile costs 0.55 s on desktop, about 1.6 to 2.7 s on a phone. The "Node tile bake <= 150 ms" test in T14 would fail a correct implementation and invite Cursor to delete features. Four-tile start (about 0.8 s claimed) would be 3 to 5 s.
- **Forests will not read as forests (section 2.6).** One candidate per 6 x 6 cell, 3 px crowns, gives at most 25% coverage and spacing never below 3 px: orchard polka dots, not canopy. Densities in P1 (about 0.12 trees per cell) and P2 (up to 0.2) are 4 to 7 times higher. This also undermines "forests clump along valleys".
- **Rivers: lateral noise offset (section 2.3)** produces wobble, not meanders, at amp 1.5 w and wavelength 14 w; for w = 1 that is a 1.5 px wiggle. P2's sine-generated curve is better. Rivers rasterised at 1 px under KY 0.8 also drop rows (see P2).
- **Roads across the sea (section 2.7).** MST over all 14 sites on a torus with water cost 40 per cell will happily build 100-cell causeways between islands, with no island constraint. The bridge rule only covers gorges.
- **Pack names are unversioned (`world/p-{px}-{py}.bin`).** Pages caches with short max-age and ETags; a redeploy can mix old packs with a new index. Content-hash or version the path (P1/P2 do).
- **Macro cell = 4 world px with only 0.6 px detail** invites soft cliffs and lattice stripes in shading (P2 measured stripes; I could not reproduce in my own quick test, so unconfirmed). The cliff-sharpen mitigation is deferred.
- **Quantisation vs epsilon:** u12 over 0 to 128 px is 1/32 px steps; the flood epsilon is 1/4096 px, so after quantisation filled flats become true plateaus. T11's "no new pits" fails unless pits are defined as non-strict.
- Shadow sweep code (`s - 2*sqrt2` per step) is correct but uses a diagonal step of sqrt2 with a 2-per-cell climb; fine, but ensure it equals the brute-force test on non-diagonal rays (it is exact only for NW).
- No generator test scale: all lengths are absolute cells, nothing says how to shrink a fixture.
- 6 main islands with a 300-cell minimum centre spacing and radii up to 230 cells can merge into one land mass, and 14 sites over 6 islands and four required regions is thin on the Highland.

| Realism | Art | Wrap | Bud | Det | Test | Risk |
|---|---|---|---|---|---|---|
| 3 | 2 | 4 | 4 | 5 | 4 | 3 |

---

## Per stage: which approach should win, and what to graft

| Stage | Winner | Graft |
|---|---|---|
| Foundations (RNG, hash, torus, noise) | P1 (integer-matrix octaves, per-stage streams, arithmetic whitelist) | P3's banned-API list including total-order sorts; P3's per-stage SHA golden and worker/CI matrix; P2's 16/32 literal gradients |
| Base shape and uplift | P1 (archetype quota, fold spines, K stripes) | P2's per-province U/K/D table and 256² pre-run calibration; P3's island count control. Keep land at about 30 to 35% (P1/P3), not 45% |
| Erosion | P1 schedule (coarse to fine, stop at 70 to 80% of steady state) | P2's jittered graph only if heights are resampled at jittered positions (otherwise skip); P3's analytic 1-D steady-state test; P2's stage cache. Drop any translation-invariance test |
| Hydrology, rivers | P1 (vectors, Q-based width, running-minimum bed, waterfalls) | P2's sine-generated meanders and the screen-space river raster with the 8-connectivity gate; P3's per-tile vector margin and monotone-z test |
| Coasts | P1 (exposure x rock, retreat, delta vs estuary) | P2's coves and class rules as stamps, P3's exposure symmetry test |
| Cover and ground | P2 (HAND-driven rules with blue-noise jittered edges, region weights) | P1's rule-table test on synthetic slopes and patch filter; P1's 7-tone budget |
| Scatter | P1/P2 hybrid: committed blue-noise mask, density from cover | P3's pure position hash for variants (kills periodicity); P2's stamping into heights; use densities of P1/P2, not P3 |
| Sites, matching | P1 (spacing, sticky `site-assignments.json`) | P2's ranked sites per type and abbey-home-river test; P3's affinity table; add seed-rejection and island-aware road rules |
| Roads | P1 (same-island, slope-squared cost) | P2's 16-direction curvature penalty and grade cap; P3's wrap-crossing path test |
| Scale and pacing | P1 (7680, whole-pixel chunks) | P2's KY = 0.75 if the owner accepts it (exact binary wrap, no dropped rows); else keep 0.8 with integer `4*y/5` rows |
| Data format and shipping | P1 heightfield plus cover plus vectors, committed | P2's whole-world-in-one-file size discipline (about 1 MB) and gzip decode; P3's packs, overview backdrop and never-blank fallback; versioned/content-hashed paths; budget 0.5 MB first flight, 3.5 MB total with postcards cut or lazy |
| Bake (cells, shadows, ink) | P1 pipeline and cell cache | P2's fixed margins and tile-relative depth; fixed sun in the bake (reject P2's per-visit bake); P3's crop-equality test for tiles and wrap |
| Palette and live layers | P1 (flow, wind, season phase bits) | P3's small LUT discipline; P2's OKLab ramps and Imhof contrast rule |
| Critic harness | P2 gates plus P1 views | P3's chi-square region test and cheap autocorrelation; seams as byte equality, not a critic score; hash raw RGBA, not PNG bytes (zlib version drift) |
| Task breakdown | P1 (seams) and P3 (ordering) | Move timing and ink-coverage asserts to non-blocking benches or Claude; supply small-world fixtures for every generator test |

## Risks none of them addressed

1. **No on-device measurement before commitment.** Phone bake costs (0.5, 0.74 and 2.7 us/cell across the three) disagree by 5x. A phase-0 spike on a real mid-range phone (and iOS Safari) must gate the architecture, because every design depends on a client-side bake.
2. **Dragon occlusion by terrain.** The depth test hides the dragon behind tall terrain to its south. Height caps (P1 160 is worst), camera behaviour or altitude rules need a design and a test.
3. **Depth and tile arithmetic at the wrap for the dragon**, not just the terrain: the dragon-versus-bake depth comparison across the seam is untested in all three. Use camera- or tile-relative depth.
4. **Save compatibility.** localStorage discoveries and "Continue" positions bind to world coordinates and site ids; regenerating the world silently invalidates them. Store a world version and migrate or reset.
5. **Shared TS between Node 26 and the Next.js bundler.** Node's type stripping needs explicit `.ts` extensions, no enums or parameter properties, no path aliases; Turbopack and `new Worker(new URL(...))` have their own rules. Prove one module imports and runs in both before writing tasks.
6. **Test scale.** Generator stages tuned in absolute cells cannot be unit-tested on 64² fixtures without scale parameters; and `node --test "src/**/*.test.ts"` will not discover tests for code under `scripts/`.
7. **Compression determinism.** Hash decoded arrays, never deflate or PNG bytes; add a small inflate fallback (about 3 KB) for browsers lacking `deflate-raw` streams.
8. **Cache coherence on GitHub Pages** (short max-age, no custom headers): all assets must be versioned or content-hashed; P3 is not.
9. **Mid-session memory and thermal limits** on iOS (workers, 6 to 13 MB caches, heavy bake while flying) and tab backgrounding that pauses workers.
10. **Cursor clean-copy flakiness:** timing asserts, and any test that depends on unspecified float tie-breaking, will waste delegate cycles; the test author must classify each assertion as exact, statistical, or bench.
