# Dragon world terrain — design

**Date:** 2026-11-16
**Status:** approved by the owner on 2026-11-17. The build plan for tasks 0–7 is `docs/superpowers/plans/2026-11-17-dragon-world-terrain-part-1.md`. The owner's answers of 2026-11-16 and the builder check are folded in (section 7 and 5.9).
**Inputs:** the fact sheet (`docs/superpowers/research/2026-11-16-terrain-factsheet.md`), three proposals and two critiques (`docs/superpowers/research/terrain-proposals/`). P1 is the geomorphology proposal, P2 the art proposal, P3 the engineering proposal.

Labels used throughout: **[Owner]** is a decision recorded in the fact sheet. **[Call]** is this design's choice; the ones the owner should check are listed in 5.8. Numbers are defaults to tune unless marked *measured*, in which case they come from a throwaway experiment in a proposal or critique, not from this pipeline.

## 1. Intent and why

The site is becoming a realm you explore on dragonback. The spike proved the camera, the pixel renderer and the frame cost, but its land looks chopped: stair-step terraces, noise blobs with no drainage, colour in altitude bands, bare ground, and one look everywhere.

This design replaces the land. Terrain is grown offline the way land forms (uplift, rivers cutting, slopes failing, the sea working the coast), then painted by rules that were chosen for one fixed overhead camera at one cell per pixel. It ships as about 2 MB of committed geography, and the visitor's browser turns it into pixels in a worker. Rivers are roads, so every river has to be visible, continuous and lead somewhere.

## 2. Goals, non-goals, anti-goals

**Goals**

1. Geography with causes: drainage basins, branching rivers that all reach the sea or a lake, V-shaped valleys in the hills and wide floors lower down, lakes, varied coasts, ridges with scree, cover that follows slope, moisture and exposure.
2. Four regions a visitor can name from a single frame: a seaside town bay, valley country, highland, exposed coast.
3. Readable at 400×225: rivers of 1–6 px that never break into dashes, cliffs that read as cliffs, ink only at real silhouettes, cliffs and coasts.
4. Believable landmark sites with approaches, 30–60 s of flight apart, for 7 to 12 landmarks.
5. One shared, deterministic, seamless torus world inside the download and frame budgets.
6. Every build task has a test that a machine can judge. Look is tuned separately through a render-critic loop.

**Non-goals**

- Landmark models, the town's buildings, the dragon and its flight model, the title menu. This design provides pads, roads, the river graph and an occlusion field for them.
- Caves, arches, overhangs (the land is a heightfield, one height per cell), tides, simulated water, simulated ice, plate tectonics.
- Per-visitor terrain, or any re-bake for time, season or weather.

**Anti-goals: it fails, even if every test passes, when**

- any of the spike's six complaints returns in a new form: ink on small steps, grid or lattice patterns (including dither moiré and trees in rows), altitude colour bands, blob islands, bare ground, sameness;
- rivers hide behind ridges or their own tree line, or run as straight canals;
- the best scenery faces away from the camera: cliffs on east or west shores, a town seen side-on, waterfalls on reaches the camera cannot see;
- a landmark sits where no one would build it, or cannot be seen;
- a first-time visitor on a mid-range laptop waits at a blank screen, or outflies the bake;
- anything reads as pagan (standing stones, cairns, shrines) or as a copy of a known film's town, mine or castle.

## 3. Constraints

All **[Owner]** unless marked.

- **Camera.** North-up, no rotation, no perspective. `screenY = worldY·0.8 − height`; one cell is one pixel across. KY stays 0.8: P2's 0.75 alters a decided camera, and a world that is a multiple of 1280 wraps exactly at 0.8 anyway.
- **Renderer.** Software pixels into a ~400×225 RGBA buffer, scaled up hard. No WebGL.
- **Baked layers.** Land is baked once into per-pixel material, light, depth and face. Each frame copies the bake through a palette and adds live layers. Time of day, season and weather are palette and overlay work, so the bake assumes one sun (north-west, 63° up) and never depends on the visitor's clock. P2's per-visit low-sun bake is rejected for this reason.
- **One world** from the owner's seed, generated offline. Looping torus archipelago (default).
- **Landmarks** are sprite stacks on reserved, typed sites; pinned projects are matched to sites at build time and never reshape land. Seven types: abbey (first), lighthouse, windmill, bridge or aqueduct, ruined cathedral, churchyard yew, seaside town.
- **Paint** (default, unconfirmed): lush Ghibli summer colour, ink on silhouettes, cliffs and coasts. European subjects; church-built ornament only; original work only.
- **Hosting.** GitHub Pages static export. No custom headers, no `SharedArrayBuffer`. Workers with transferable buffers are fine. Pages does not compress `.bin` files and caches with short lifetimes.
- **Phones default to the text site [Owner, 2026-11-16].** On a phone the title menu preselects The Recruiter. Flying stays available there as an opt-in, but it is best effort and not budgeted.
- **Budgets.** Interactive in ~2 s and under 4 ms per frame on a **mid-range laptop**. The proxy is desktop Chrome with 4× CPU throttling, plus desktop Safari. This design tightens the fact sheet's data budgets of ~1.5 MB before first flight and ~8 MB total (5.5).
- **Code.** Pure TypeScript, no native dependencies, shared by Node 26 (which runs `.ts` by stripping types) and the browser. Seeded RNG; never `Math.random()`. Tests under `src/**/*.test.ts` with Node's runner. World code in `src/world/`.
- **Who builds.** `cursor-delegate`: Claude writes and commits each task's tests, Cursor implements, a clean-copy check decides. Models: `composer-2.5` (mechanical), `grok-4.7-high` (numerical), Claude (look).

## 4. Approaches

Three whole pipelines were on the table.

| | A. Process first (P1) | B. Art first (P2) | C. Smallest pipeline (P3) |
|---|---|---|---|
| Land | Stream-power erosion over designed uplift and rock stripes, 7680² world, solved down to 2 cells per node | Erosion on a coarse 1024² graph, 4096² world; cliffs, coves, pads as explicit stamps | Erosion on a 4-cell grid, 6144×6400 world, warped radial islands |
| Paint | Flat poster tones, cover computed offline | Cover and scatter as pure rules in the bake, OKLab ramps, lines drawn in screen space | Bayer dither, grid forests, altitude colour buckets |
| Ships | ~3 MB heightfield and cover in 225 tiles, plus 2.4 MB of pre-baked postcards | ~0.9 MB "recipe", loaded whole | ~2 MB in 30 packs, haze backdrop while baking |
| Best at | Geography with grain; wrap; numeric test seams | What reads at one pixel; region identity; landmark staging; look gates | Determinism checks; streaming; seam tests |
| Fails at | 160 px peaks hide 72 % of channel cells (*measured* by the art critic); budget sums wrong; no fallback when a chunk is late | Changes the camera; bakes per visit; cliffs and town face away from the camera; 28 s pacing | Would bring back the chopped look in five ways |

**This design takes A's land, B's paint and C's delivery and verification.** Both critics reached the same split independently. The reason is that each proposal is strongest where its own lens looked and weakest elsewhere, and the three strengths are in different layers that meet at clean interfaces: generated arrays, shipped files, and a pure bake function.

Three things come from the critics and from none of the proposals:

1. **The camera decides what exists.** It never moves relative to the land, so anything a ridge hides is hidden forever, and only south-facing walls have width on screen. The generator therefore computes visibility and enforces orientation (5.2, 5.6).
2. **Ink by occlusion, not depth jump.** Every proposed depth threshold inks all of a north-facing slope steeper than 27° (*measured*). 5.5 replaces the rule.
3. **Measure the bake first.** The three bake-cost estimates differ by five times. Task 0 gates the architecture on the laptop target (5.5).

## 5. The design

### 5.1 Scale

| Quantity | Value | Why |
|---|---|---|
| World | **6400 × 6400 cells**, torus **[Call]** | 6400 = 25 × 256, and 6400 × 0.8 = 5120 = 20 × 256, so bake space wraps on a whole pixel and a whole chunk at KY 0.8 |
| Solver grid **G** | 1600² nodes, 4 cells per node | The finest valley a solver makes is 2–3 nodes; at 4 cells that is 8–12 px, about the finest that reads. A 2-cell grid adds gullies that read as noise |
| Coarse grid **C** | 800² nodes | First erosion pass and smooth fields |
| Lap at cruise / boost | 107 s / 56 s | 60 and 114 cells/s from the spike |
| Land share | 30–35 % after drowning | Sea gives rests of 3–7 s between islands |
| Reserved sites | 12 | Abbey, town, and two each of the other five types |
| Spacing | 7 landmarks: 2600 cells, **43 s**. 12 landmarks: 1990 cells, **33 s** | Hexagonal packing, d = 1.075 · N / √n. Following a river adds 25–50 % |
| Minimum site spacing | 1500 cells (25 s) | One exception: abbey to town along the home river |
| Minor beats | about every 300–600 cells | Hamlets, waterfalls, fords, tarns, stacks: 5–10 s apart, so flight is never empty |

A 4096² world gives 28 s for seven landmarks and 21 s for twelve, under the bar. 7680² adds 44 % more data and bake for no pacing gain.

**Heights.** One height unit is one screen pixel. Sea level is 0; sea bed reaches −24.

- **Land is capped at 130 [Owner, 2026-11-16].** The design proposed 100. The owner chose taller highlands, accepting more hidden ground.
  - For scale, the art critic measured, with a 90 peak, 1.7 % of channel cells hidden and 12 % of land pixels as walls; with 160, 72 % and 27 %. Expect 130 to land between those.
  - The visibility rules in 5.6 do not relax. Rivers must stay ≥ 85 % visible and sites ≥ 80 %, so the tallest ground is kept off the south side of rivers and sites, and more seeds will be rejected.
  - Peaks per region are in 5.2.
- Canopy adds up to 8. `HMAX = 160`: a site's ground height plus its landmark must stay under 152. The south apron a chunk needs is 160 / 0.8 = 200 rows.
- Slopes away from cliffs stay under 0.8, where a south-facing slope starts to grow wall pixels.

**Quantisation and terraces.** Shipped heights are u16 in 1/16 units on G. Column tops round to whole pixels only in the bake, and shading uses the float surface, so there are no contour bands. **Terraces do not survive as the land's style [Call].** A slope under 1 steps one pixel at a time and gets no ink. Steps return only where people built them: field terraces (lynchets, 1–3 units) on farmed slopes near the town, vineyard terraces, the town's street terraces, and bedding lines drawn as hatching on sedimentary cliffs.

### 5.2 Generation pipeline

Each stage is a pure function `(inputs, params, seed) → typed arrays`. Stages cache to a git-ignored `.cache/world/<seed>/<stage>.bin`, so tuning a late stage never re-runs erosion (from P2). The whole run should take 2–5 minutes.

**S0 Foundations** (P1, with P3's rules).

- RNG `sfc32`, one stream per stage keyed by `hash(seed, stageName)`.
- **Arithmetic whitelist:** `+ − × ÷`, `Math.sqrt`, `abs`, `floor`, `fround`, `imul`, `clz32`. These round identically on every engine. `sin`, `cos`, `pow`, `exp`, `log`, `atan2`, `Date` and sorts without a total order are banned in world code; meanders use a fixed polynomial sine, and heaps and sorts key on `(value, index)`.
- **Noise:** periodic gradient noise with 16 literal gradients and a quintic fade. Octave k samples at Mᵏ·p with the integer matrix M = [[2, 1], [−1, 2]] (a 26.6° turn), so every octave still tiles exactly. Value noise draws grid rectangles and simplex is awkward on a torus.
- **Test scale.** Every length in `gen/params.ts` is in cells for the 6400 world and scaled through one `paramsFor(N)` helper. Tests run on a 1024-cell mini-world (256² nodes) or hand-built fixtures.

**S1 Plan: uplift, rock, regions** (P1; on C).

Uplift U is the rate at which land is pushed up; erodibility K is how easily rock wears. Erosion exposes whatever structure these two maps carry, which gives ranges their grain.

1. Place 10–13 island cores by Poisson disk (points with a guaranteed minimum spacing) on the torus, r = 900 cells.
2. Assign archetypes from a fixed quota:

| Archetype | Count, size | Peak | Rock | Region it reads as |
|---|---|---|---|---|
| Home island | 1, ~1700 across | 50 | mixed, soft lowland | town bay, farm lowland, the abbey's valley |
| Highland massif | 1, large | 130 | hard core | highland: ridges, scree, summit snow |
| Slate valleys | 1, ~900 | 65 | hard and soft stripes | valley country: parallel deep valleys, moor tops |
| Lake country | 1, medium | 95 | medium | ribbon lakes, alpine meadow |
| Karst coast | 2, medium or small | 45 | hard limestone | exposed coast: cliffs, coves, stacks |
| Skerries | 5–7, small | 15–30 | hard | stacks, a lighthouse site |

3. Each core gets a fold-belt spine: a polyline of 3–6 segments along one global strike direction (±25°) with two or three parallel ridges. The strike runs roughly west–east **[Call]**, so the main ridges and valleys show their south flanks to the camera.
4. `U = amp · plateau(distance to spine / halfWidth) · (0.55 + 0.45 · ridged noise stretched 3:1 along strike)`.
5. K: three rock classes in warped stripes along strike, 300–600 cells wide; hard ×0.4, medium ×1, soft ×2.2.
6. Region weights: soft membership of each node in each archetype, blended over 100–200 cells (P2).

Rejected: warped radial falloffs (P3) and thresholded noise (P2); both give blobs.

**S2 Fluvial erosion** (P1's schedule, P2's solver details; C then G).

The stream-power law says a river cuts faster where it carries more water and runs steeper: `∂h/∂t = U − K·√A·S + D∇²h` (A drainage area, S slope, D hillslope diffusion). Braun & Willett's implicit scheme solves it in one pass per step.

```
step():
  f   ← priorityFlood(h)          # Barnes 2014, +ε: fills pits, gives a pit-free surface
  rcv ← steepest descent on f among 8 wrapped neighbours; ties by index
  A   ← accumulate rain down the flood's pop order, reversed
  for i in pop order: F = K[i]·dt·sqrt(A[i]) / dist(i, rcv[i])
                      h[i] = max((h[i] + U[i]·dt + F·h[rcv[i]]) / (1 + F), h[rcv[i]] + ε)
  h ← implicit diffusion, D per region, fixed sweep count
```

- **Jittered graph (P2).** Each node is offset by a fixed ±0.4 node and distances are measured from those positions. This removes the 45° streaks a plain grid draws on ridges (*measured* by P2 and the art critic).
- **Jitter fix [Call].** P2 then upsampled as if nodes sat on the lattice, putting rivers up to 1.6 cells off their valleys. Here, after the last step, heights are resampled onto the regular lattice (inverse bilinear within the jittered quads), and every later stage runs on the lattice.
- **Schedule.** 150 steps on C; cubic B-spline upsample to G with 2 % noise; 40 steps on G, which sharpens C's valleys without cutting new ones. Rain is uniform for the first 75 steps and orographic (more on windward slopes; S6) after.
- **Stop early**, at 70–80 % of steady state (erosion flux ÷ uplift flux, a reported metric). Uplands keep plateaus: the moor, the windmill ridge, the alpine meadow.
- **Valley spacing per region** is set through D (spacing grows with D/K; Perron et al. 2009): highland 40–60 cells, valley country 70–110, lowland 150–250. No valley narrower than 16 px.
- Cost, scaled from 50–135 ms per step *measured* at 1024²: about 30 s in all.

Rejected: droplet erosion (no connected network), hydrology-first construction (valleys ignore rock), a 2-cell solve (busy hillsides).

**S3 Drowning [Call, from the art critic].** Raise the sea by 3 units after erosion (about 4 % of relief) and re-zero. Valley mouths become inlets and spurs become headlands (16–24 % more coastline, *measured*). Atlantic and Adriatic coasts formed this way, and it puts sheltered bays at river mouths, where the town belongs.

**S4 Glacial imprint** (P1 with P2's U-section; G). No ice simulation. Three geometric operators:

- **Ribbon lakes** (Lake country, 3–6): lower a valley floor along 80–250 cells by a parabola 6–12 deep.
- **Tarns** (Highland, 4–8): a bowl of radius 12–20 and depth 5 at valley heads above 60 that face **east to south-east**. P1 and P2 faced them north, where the headwall hides the tarn.
- **Moraine dams** (2–4): a 4–8 unit bar across a valley. Large highland channels with floors above 35 get a parabolic U section, half-width 8–16.

**S5 Talus** (P1; G). Thermal erosion: material slides until no slope exceeds its repose angle (hard 1.8, medium 1.0, soft 0.6, in height per cell), 30 sweeps. Moved material accumulates in a **debris layer**. Scree is later drawn where debris is thick, so it sits below cliffs because rock fell there.

**S6 Coasts** (P1, with P2's stamps; G).

1. **Exposure E ∈ [0, 1]** per shore node: mean open-water fetch (distance of open sea) over 16 wrapped rays up to 600 cells, the south-west quadrant weighted double. That is true of Atlantic Europe and puts cliffs on shores the camera sees.
2. **Cliffs** (E > 0.55, medium or hard rock): retreat distance `r = 40·(E − 0.55)·k` (hard 0.6, medium 1.0). Land within r of the old shore is cut to a wave-cut platform at −1.5 to −3. Cliff height is whatever the land stood at, capped at 45. P3's raised rim would dam rivers.
3. **Orientation gate [Call].** A cliff on a shore facing within 60° of east or west draws as a single line. Such shores are capped at 12 units and classed rocky shore; full cliffs are kept on shores facing south-east through south-west.
4. **Stacks:** pieces of 8–120 cells that survive retreat where a hardness noise exceeds 0.8, plus 1–4 placed off convex headlands (P2), turf on top.
5. **Coves:** where a channel meets a cliff coast, a pocket beach of radius 8–20.
6. **Beaches** (E < 0.35, shore slope < 0.15): land within 10 cells lowered to `0.6 + 0.05·d`; the sea bed raised to a 0.04 slope for 30 cells, the pale shelf. Dune grass behind beaches wider than 6.
7. **Mouths:** sheltered (E < 0.4) and w ≥ 4 gives a delta fan with 2–3 distributaries; exposed gives an estuary widening ×3 over 40 cells.
8. **Bathymetry:** `min(24, 0.12·d·(0.6 + 0.8E))`, so water is dark under cliffs and turquoise in bays.

Sharp features are also written as **stamps**: small records (kind, position, shape) that the bake applies after upsampling, so a cliff foot, stack, pad or terrace stays crisp at cell resolution. The generator runs the same stamp code on G, so hydrology agrees.

**S7 Hydrology and rivers** (P1's structure, P2's geometry; G to vectors).

1. **Rain:** sweep moisture along the wind (south-west to north-east), dropping rain on upslopes and leaving a rain shadow; two laps so it converges.
2. **Lakes:** Priority-Flood again. Basins of ≥ 120 cells and ≥ 1.5 deep become lakes at their spill level; the rest are filled. After this no land node is a pit.
3. **Discharge** Q is accumulated rain, in nodes. Channels are Q ≥ 64, a stream about every 90 cells (*measured*). **Width `w = clamp(round(√(Q / 1000)), 1, 6)` px**: most of the network is 1 px, a 300-cell-square basin gives 3 px, the largest rivers 5–6.
4. **HAND** (height above nearest drainage): each node's height above the channel it drains to. It drives cover (S8).
5. **Vectorise:** trace reaches between heads, confluences, lakes and mouths; simplify (0.75 cell); two Chaikin corner-cutting passes remove the grid's 45° kinks.
6. **Meanders:** on reaches with slope < 0.012 and w ≥ 2, a sine-generated curve (the river's heading swings as a sine of distance along it): `θ(s) = θ_valley + ω·psin(2πs/λ)`, ω from 0.6 for small streams to 1.2 for big lowland rivers, wavelength max(16, 10w). Sinuosity is 1.49 at ω = 1.2 (checked by both critics); P3's noise offset gives 1.006, a canal. One loop in five on w ≥ 3 leaves an oxbow pond.
7. **Valley floors:** for w ≥ 2, flatten ground within 1.5 meander belts to `bed + 0.5 + 0.02·d`. Valleys widen downstream and stay V-shaped upstream.
8. **Bed and falls:** the water level along a reach is the running minimum of the surface minus (0.5 + 0.3w), so water never runs uphill. Drops of ≥ 4 within 3 cells are waterfalls with plunge pools; they occur where hard rock meets soft. Only falls on reaches flowing within 60° of south are kept; the camera cannot see the others, which are graded into rapids.

Output: `reaches[] {id, downstream, order, vertices[x, y, width, level] in quarter cells}`, `lakes[] {id, level, outline}`, and a river graph for navigation. Validation (monotone levels, no new pits) runs on the quantised data (P3).

**S8 Climate fields, cover and regions** (P2's rules with P1's inputs).

The generator ships smooth fields, and **cover is a pure function of those fields plus the rebuilt surface, evaluated per cell in the bake [Call]**. The same function runs offline for siting. This keeps cover thresholds in the fast tuning loop and gives per-cell edges, not 4-cell blocks.

Fields: HAND (on G); moisture M, wind exposure X, coastal exposure E, debris, rock class and six region weights (on C). Slope s, height e and northness come from the surface.

Rules, first match wins. Every threshold is compared against the value plus blue-noise jitter scaled to the rule's edge width, so borders are speckled bands and never contour lines.

| Cover | Rule | Edge (cells) |
|---|---|---|
| sand | within the beach stamp, or e < 1.5 with E < 0.35 and s < 0.15 | 2 |
| snow | cold score `e/100 + 0.1·northness` > 0.82 and s < 1.1; cliffs shed snow | 2 |
| bare rock | s > 1.7, or s > 0.9 on hard rock | 3 |
| scree | debris > 0.75 and 0.45 ≤ s < 1.2 | 6 |
| alpine meadow | highland or lake weight high, cold score > 0.55, s < 0.5 | 10 |
| heath | X > 0.55, or HAND > 30 in valley country | 12 |
| forest | 2 < HAND < 30, 0.08 < s < 0.8, M > 0.4, X < 0.5, cold score < 0.6; conifer when cold score > 0.45 | per tree |
| farmland | s < 0.14, HAND < 25, inside a parcel (S10) | parcel edge |
| marsh, reeds | HAND < 1, s < 0.02 | 4 |
| meadow, pasture | otherwise; dry scrub where M < 0.3 | 8 |

- HAND alone gives meadow on the valley floor, woods on the lower sides and heath on the tops.
- North faces barely show, so visible snow is on summits and plateaus.
- Each large cover has three hue variants chosen by 200-cell periodic noise and blended over 8–16 cells, and each region has an accent: heather purple and slate in valley country, wheat gold in the lowland, limestone white and turquoise on the karst coast, terracotta at the town, snow blue in the highland.
- No majority filter (it is not a pure function of position); smooth inputs control speckle and a harness metric checks it.

**S9 Scatter** (P2's mechanism at P1/P2 densities).

- One committed 256² blue-noise mask (a tile of values with no clumps and no rows; void-and-cluster method). A category places an instance where `mask[(x + ox) & 255, (y + oy) & 255] < density(cell)`. Species, size and colour come from a hash of world position, which hides the 256 period.
- Peak densities: broadleaf 0.20 in forest and 0.02 in pasture; conifer 0.22; boulders 0.04 on scree and moor; flowers ≤ 0.03.
- Trees and rocks are **stamped into height and material**, so each crown shades, casts a shadow, takes forest-edge ink and depth-tests against the dragon for free. Crowns are wider than tall (broadleaf height 0.6 × diameter + 1.5, radius 1.5–3); conifers are 1.5 × diameter.
- **River clearance is asymmetric [Call]:** no tree within 1.25 × tree height south of a river, and 1–2 cells north. In farmland, rivers get a line of alders on the north bank.
- Boulders stay 1–2 units tall and blue-noise spaced; they never form rings, rows or uprights.
- Rejected: P3's jittered 6 px grid, which keeps 41 % of a lattice's regularity, so woods look planted.

**S10 Sites, roads, parcels, conform.**

- **Sites:** section 5.6.
- **Roads** (P2 with P1's island rule): least-cost paths on G with 16 step directions, `cost = length·(1 + 40·s²) + curvature penalty`, impassable above a 12 % grade (which makes switchbacks), 15 % cheaper on south-facing flanks so switchbacks show. Water crossings cost 50 and are allowed where w ≤ 4; streams of w = 1 are forded; every other crossing records a bridge. The network is a minimum spanning tree plus 20 % extra edges over every reserved site and hamlet **on the same island**. Islands are never joined by causeways; a stack-top lighthouse has no road.
- **Hamlets** of 3–8 houses at junctions and crossings. Valley country gets a slate quarry and row cottages; no pit-heads or rail trestles.
- **Parcels:** farmland is cut into warped Voronoi cells from Poisson points 28–56 cells apart, long axis along the contour, split by rivers and roads. Boundaries (lowland hedges, upland dry-stone walls) ship as lines. Crops are material variants.
- **Conform:** flatten pads (smoothstep skirt, cut or fill ≤ 3), bench roads into slopes, apply the sight-line rule (5.6), then re-run the no-pit and monotone-river checks.

### 5.3 Wrapping

One `wrap()` helper; nothing has an edge.

| Stage | How it stays seamless |
|---|---|
| Noise | periodic lattice, integer-matrix octaves; exact |
| Poisson disks, Voronoi, spacing, fetch, HAND | torus (minimum-image) distance; rays wrap |
| Flood, routing, erosion | seeded from sea nodes; indices wrap; no boundary exists |
| Rain sweep, shadow sweep | wrap, and run a second lap where they carry state |
| Road search | wrapped neighbours, torus-distance heuristic |
| Vectors | stored unwrapped, registered in every pack their wrapped bounding box touches |
| Cover, scatter | pure functions of wrapped cell coordinates; the 256 mask divides 6400 and 5120 |
| Bake | 25 × 20 chunks and 25 × 25 cell tiles divide the world exactly; rows use integer `floor(4·y / 5)` |
| Depth | chunk-relative, and the dragon test is camera-relative, so nothing breaks at the seam |

Tests: exact wrap equality for noise; **crop equality** for the bake (a chunk equals the same crop of a larger window, and a view offset by one world period is byte-identical). Roll-invariance tests of erosion are dropped: the engineering critic showed that index tie-breaks make a correct solver fail them.

### 5.4 Data formats and where generation runs

**Ship geography, not pixels [Call].** Baked pixels for 6400 × 5120 × 4 bytes would be 15–25 MB after compression. Geography is about 2 MB and lets the look change without re-shipping land.

**Generation runs on the owner's machine and the output is committed [Call]** to `public/world/<worldId>/`, where `worldId` is a content hash. The land is authored content the owner approves from renders; a CI rebuild could drift on a tie and move a river; the Pages build stays fast; hashed paths make Pages' cache harmless. Cost: about 2 MB of binary in git per accepted world.

| File | Content | Size (estimate) |
|---|---|---|
| `manifest.json` | sizes, pack index with hashes of decoded arrays, sites, regions, generator version | ~10 KB |
| `overview.bin` | 400² height and cover summary for the haze backdrop and maps | ~40 KB |
| `graph.bin` | river and road topology for navigation | ~30 KB |
| `p/<px>_<py>.bin` × 25 | one 1280²-cell pack: heights 320² u16; HAND 320² u8; six fields 160² u8; clipped vectors (rivers, lakes, roads, hedges, parcels); stamps | 10–150 KB each |
| `bluenoise.bin` | 256² u8, shared by dither and scatter | 64 KB |

- **Heights:** predicted from left, up and up-left neighbours (the MED predictor), zigzag, split into byte planes, raw deflate. *Measured* in the proposals: 419 KB for 1024² at 1/16 unit and 892 KB for 1536² at 1/32. Expect about 1.0 MB for 1600².
- **Fields** ~0.35 MB, **vectors and stamps** ~0.35 MB. **Whole world about 1.8–2.0 MB.**
- Decoding uses the browser's `DecompressionStream('deflate-raw')`, with a ~3 KB inflate fallback. Hashes cover decoded arrays, never compressed bytes, because zlib output varies by version.
- Packs carry no duplicated borders; the client holds neighbours.

**Budgets [Call]: 0.5 MB before first flight, 3 MB for the whole world.**

Streaming order: manifest, overview, blue noise and the start pack (≤ 300 KB); the start pack's neighbours; packs ahead of the heading, predicted 6 s out; everything else when idle. Until a chunk is baked, the compositor draws a hazy palette-mapped tile from the overview, so the screen is never blank. P1's pre-baked postcards (2.4 MB) are cut.

**Determinism checks** (P3): each stage writes a SHA-256 of its arrays to a committed `golden.json`. `npm test` regenerates the mini-world twice in process and once in a `worker_threads` worker and compares. CI runs the same on macOS arm64 and Linux x64 with Node pinned. `npm run world:verify` regenerates the full world on demand.

**Saves.** localStorage records `worldId`. Discoveries are keyed by repository, not by site or coordinates, so a new world keeps them; Continue stores a repository id and falls back to the abbey.

### 5.5 Rendering

**Baked, in workers, in two levels** (P2's split with P1's cache).

1. **Cell tiles**, 256² cells, cached because chunks to the north reuse them:
   - cubic B-spline upsample of G heights (never overshoots; Catmull-Rom overshoots 7.4 % and rings islets round the coast);
   - stamps: cliffs, stacks, pads, terraces, river channels and valley floors, lakes;
   - cover, then scatter stamps;
   - light: `0.6·Lambert + 0.4·relief`, where relief is height minus its 16-cell blur, which lightens ridges and darkens valley floors. Contrast grows with height (after Imhof); flat ground sits at the base tone;
   - **cast shadows by one exact diagonal sweep.** The sun lies on the grid diagonal, so a running maximum along each diagonal is exact and O(1) per cell. The ray drops **2√2 per diagonal step** (P1's 2 would lengthen shadows 41 % past the dragon's). Shading uses the same sun. Apron: 64 cells north-west.
2. **Pixel chunks**, 256 × 256 px (320 world rows), 25 × 20 on the torus:
   - painter's pass from north to south over the cell tiles, reaching 200 rows further south;
   - **tone and dither per bake pixel.** One flat world row in five owns no screen row, so anything patterned per world cell turns to stripes or moiré once projected (*measured*). Tone is quantised to 16 levels against the blue-noise mask indexed by bake pixel, which is fixed in the world and does not swim;
   - **lines in bake-pixel space.** Rivers, roads, hedges and walls are polylines drawn onto visible ground pixels and depth-tested so they never cross a ridge. A river raster must be 8-connected. A 1-cell river drawn in world cells loses 23 % of its cells (*measured*);
   - **ink by occlusion [Call].** Between two adjacent bake pixels, ink the nearer one when at least 3 world rows are hidden between their source cells and the height drop is at least 3: soft ink for 3–9 hidden rows, full ink for 10 or more. On the critic's test land this drew clean 1 px ridge lines on 1.6 % of land pixels, against 6.4 % of smears. Also: full ink on a cliff lip above a wall run ≥ 4 px, and on cliffed coasts. Never on rivers, roads, hedges, fields, beaches (foam instead), 1 px steps, or canopy against canopy. Canopy against ground does ink, which outlines a wood's south edge;
   - **walls.** A wall on a slope under 2 is shaded as the surface it belongs to: no earth band, no hatch. Only cliffs (s ≥ 2) show rock;
   - **hatching on cliffs and deep terrain shadow only**, never in tree shadow: nested stroke masks (a denser level contains the sparser one), vertical on hard rock, horizontal bedding lines on sedimentary rock, broken by blue noise.

Bake pixel, 4 bytes: material (u8); light (tone 4 bits, shadow depth 2, ink 2); depth (u16, eighths, chunk-relative). On water pixels the tone bits hold shore distance (sea) or flow phase (rivers). Snow that comes and goes with the season, hue variants and crops are material ids, so the palette alone moves the snow line and turns the leaves. A 24-chunk cache is 6.3 MB.

**Colour** (P2; Claude owns the values). Each material has a 16-tone ramp interpolated in OKLab (a colour space where mixes stay saturated), bluer in shade and yellower in light. Vermilion and gold are reserved for the dragon and landmarks. **Rivers must be at least 15 L\* lighter than any vegetation they cross, in every palette**; P2's own anchors failed this (river 68.6, meadow 67.6, wheat 79.1), so the river ramp is lifted and a test guards it.

**Live, per frame.** `out = PAL[(mat << 8) | light]`, copied in row segments per chunk. The palette table is rebuilt only when time, season or weather changes.

| Layer | How | Estimate (ms), throttled laptop |
|---|---|---|
| Composite 90k px through the palette, with cloud shadows (scrolling 256² field sets shadow bits) | row copies | 1.3–1.8 |
| Wind in grass: tone +1 or +2 on grass materials under a scrolling gust field | lookup | included |
| Water: river streaks along the flow phase, surf rolling in by shore distance, sea glints, falls | lookup | 0.3 |
| Dragon, its shadow (0.354 offset per axis per height unit), wake | depth test | 0.6–1.0 |
| **Total** (budget 4) | | **2.4–3.3** |

**Bake rate.** Cruising needs about 0.5 new chunks per second and boosting about 0.9. Bake-cost estimates range from 0.5 to 2.7 µs per cell; at the high end a chunk takes over 1 s on a slow device. This is the largest unknown, so **Task 0 measures it before anything else is built**: in desktop Chrome with 4× CPU throttling (the mid-range-laptop proxy) and in desktop Safari, using the real per-cell workload (cover, scatter stamping, light, occlusion ink) on a generated test field rather than a synthetic loop **[Call]**. Phones are measured for information only, since they default to the text site. Pass: 1.0 chunk/s sustained with the workers the browser offers, and the start view baked within 2 s of choosing to fly (baking begins while the menu is up). If it fails, in order: bake a fast first pass without scatter and hatching and refine later; ship pre-baked chunks for the start view only (~150 KB); limit boost over unbaked land.

**The dragon behind hills.** A hill south of the dragon can hide it. The generator ships an **occlusion floor** in `overview.bin`: for each 16-cell block, the lowest altitude at which the dragon is not hidden by terrain to its south. The flight design can use it as a minimum cruising altitude.

### 5.6 Landmark siting

Twelve sites are reserved. Candidates are scored on G with the shared cover function, taken most-constrained type first (abbey, town, lighthouse, bridge, cathedral, windmill, yew), best score first, under the spacing rule. Every site must also pass:

- **Visibility [Call]:** at least 80 % of the pad and of the sprite's bounding box is unhidden. Visibility is one sweep per column from south to north that tracks the highest screen row reached.
- **Height:** ground plus landmark under 152 (sprite boxes in 5.9).

The staging column is what terrain provides around the pad.

| Type (count) | Terrain rule | Pad | Approach and staging |
|---|---|---|---|
| **Abbey** (1) | Home island. A spur 25–45 above a river of w ≥ 2, inside a meander where possible; crown slope < 0.12. Its **home river** reaches the town's bay within 1200–2000 channel cells | 30 × 24 | Switchback road up a south-facing flank from a riverside hamlet with a stone bridge; orchard on the south slope, woods to the north |
| **Town** (1) | Sheltered bay (E ≤ 0.3, mouth opening 40–120° toward **south to south-east**), a **south-facing** hillside rising 25–45 within 120 cells, a stream or river mouth, a beach ≥ 30 cells | ~160 × 120: street terraces every 8–12 cells (2–3 unit steps), a **dredged harbour** (3 deep) and mole stamped at siting | Coast road and the river valley; vineyard terraces, lynchets, fields behind |
| **Lighthouse** (2) | Headland with ≥ 220° of open sea within 40 cells, E ≥ 0.6, a south- or south-west-facing cliff of 12–35; or a stack with a top of radius ≥ 4 | r 6 | Cliff-top path from a road within 400 cells; a stack has none. Heath, thorns bent to the north-east, surf ring |
| **Windmill** (2) | Ridge crest: ≥ 8 above the mean within 30, X ≥ 0.7, height 20–50, along-ridge slope < 0.1, pasture or heath | r 6 | Farm track; wheat and barley on the slope below |
| **Bridge** (2) | Chosen after roads: a road crossing of a river with w ≥ 3, or of a gorge ≥ 14 deep and ≤ 26 wide, abutments level within 2 | abutments | The road; a weir or hamlet nearby |
| **Ruined cathedral** (2) | Valley floor (HAND < 4, s < 0.05) at least 60 wide, hills ≥ 25 on both sides within 250, river 30–80 away, **no ground within 200 cells south that hides it** | 34 × 16, nave east–west ±15° | Lane and a ford; grass inside, wooded valley sides, sheep |
| **Yew** (2) | Isolated knoll: prominence 6–15, radius 15–40, nothing higher within 120, meadow or pasture, within 150 of a road | r 10 | Lane; walled oval churchyard with a small chapel and gate; fields all round |

- **Sight-line rule for rivers.** Each reach records the share of its length that is visible. For w ≥ 2 it must be at least 85 %, and 65 % for w = 1. Where it is not, conform sets the south valley wall back so that ground d cells south of the river rises no more than 0.8·d − 1 above the water.
- **Aqueduct [Call].** The fact sheet allows "bridge or aqueduct". An aqueduct appears only if a lake or spring at least 20 units above the town or abbey lies within 600 cells, with a leat (a small channel) at both ends. Otherwise both bridge sites are stone road bridges.
- **Failure.** If any type has no passing site, or the home river is missing, the generator names the failed rule and the seed is rejected. `world:seeds` screens seeds cheaply at stage S1 on C, prints a contact sheet, then runs the full pipeline on the shortlisted ones, because coarse runs do not predict site quality.

**Matching projects to sites** (build time; never touches terrain).

- The abbey is fixed and holds the terminal.
- A project's type comes from `src/world/landmarks.config.ts`, or else from a hash of the repository name over the types with free sites.
- Assignments are sticky in a committed `site-assignments.json`: a new pin takes a free site, an unpinned project frees its site, nothing else moves.
- Among free sites of the wanted type, take the one that maximises the minimum distance to occupied sites, which keeps hops inside the pacing window.
- Unoccupied sites keep their pad, road and staging, and hold a small unnamed feature: a wayside cross, a sheepfold or a jetty, whichever suits the site (default, section 7). GitHub allows at most six pinned repositories, so the world normally holds seven landmarks (six projects plus the abbey) and five unnamed features.

### 5.7 The render-critic harness

`src/world/cli/render.ts` (wrapper `scripts/world-render.ts`) runs the browser's own bake and compositor in Node and writes to a git-ignored `out/world-renders/<worldId>/<look hash>/`: each view at 400×225 and at ×3, a contact sheet, diagnostic layers (height, light, ink only, cover, HAND, hidden rivers), `metrics.json`, and a `ledger.md` line with the scores and the one change tried.

**Viewpoints (39), all chosen by the generator so they follow the seed.**

| Views | What |
|---|---|
| 6 | The home river from sea to abbey, at six points |
| 12 | Each of the 12 sites: one view with the site in the upper third, 250 cells to its south |
| 6 | One per region: snowline and tarn; valley woods and village; meanders and fields; cliffs and stacks; town bay; skerries |
| 5 | Camera hazards: a north-facing slope of 25–35°; an east–west river in a steep valley; a west-facing and a south-facing cliff together; a forest edge on an east–west river; the town from its approach |
| 4 | Seams: wrap corner, x seam, y seam, chunk corner |
| 3 | Whole-world maps at 1/16: hillshade, cover, drainage with basins coloured |
| 2 | Palette sheets: one view across four times of day, and across four seasons and overcast |
| 1 | Motion: a 2-second scrolling strip per region, to show shimmer and repetition |

**Automatic gates** (cheap, run before any critic; a failure blocks the round).

| Gate | Pass |
|---|---|
| Seams | byte-identical raw RGBA |
| Ink | 1.5–6 % of land pixels per view, and ≤ 1 % on north-facing slopes with no occlusion |
| Hatch | ≤ 4 % of land pixels |
| Rivers | every visible raster 8-connected; visible share per reach as in 5.6 |
| Grid | tone power at axis-aligned frequencies ≤ 1.5 × the median at other angles |
| Stairs | no ink on steps under 4 px |
| Scatter repeat | autocorrelation at lags 128 and 256 ≤ 1.25 × neighbouring lags |
| Regions | cover histograms of the four required regions differ by chi-square above a set threshold |
| Sites | visible share ≥ 80 % each |
| Tone | under 5 % of pixels at tone 0 or 15 |

Gates live in the harness, not in Cursor's tests: a look threshold in a clean-copy check would push Cursor to delete features.

**Rubric.** Two independent Claude critics score each criterion 0–4, citing pixel boxes or metrics, and each names its three worst problems with one parameter change apiece.

1. Water shaped the land: basins, branching, valley form.
2. Rivers read: continuous, visible, each ending in sea or lake.
3. Coast variety: beach, cliff, stack, cove, shelf, inlet.
4. Mountain structure: ridges, scree under cliffs, summit snow.
5. Cover follows the land; no altitude bands.
6. Region identity: nameable from one frame.
7. No artefacts: steps, grid, seams, speckle, rows of trees.
8. Ink economy: form breaks only.
9. Landmark staging: pad, approach and framing are believable.
10. Paint: lush, coloured shadows, three value masses, painted from a real place.

Pass: no criterion under 3 in any view, mean ≥ 3.4, all gates green.

### 5.8 Calls the owner should check

1. World 6400² with about a third land and a 107 s lap.
2. Land capped at 130 units (the owner's choice; the design proposed 100); no terraces as a style.
3. Scenery is oriented to the camera: cliffs on south and south-west shores, town on a south-facing hillside, tarns facing east, waterfalls only on south-flowing reaches, ridges running west–east.
4. Coasts are drowned by raising the sea 3 units after erosion.
5. The bake never depends on time or season; a low-sun bake is left out.
6. Geography ships and is committed (~2 MB per world in git); budgets tightened to 0.5 MB and 3 MB; no pre-baked postcards.
7. A bake measurement on the laptop target (throttled desktop Chrome and desktop Safari) gates the whole architecture before other work starts.
8. Cover is computed in the browser bake from shipped fields.
9. An aqueduct appears only where it has a water source.
10. Twelve reserved sites; a seed lacking any type is rejected. Valley country has a quarry but no mine headframes.

### 5.9 Interfaces with the rest of the site (from the builder check)

**Runtime [Call].** Nothing under `src/` renders the world yet, and the spike is reference only.
- This project builds the world runtime: bake workers, streaming, the compositor and live layers, the bench page, and a **placeholder flier**. The placeholder is a scripted camera path plus a simple stand-in sprite that exercises the depth test and the shadow.
- The dragon, its flight model and the menus are later projects. They plug into one module, `src/world/runtime/view.ts`:
  - `setCamera(x, y)`;
  - `frame(out: Uint32Array)`;
  - `depthAt(px, py)` and `groundHeight(x, y)`, for the dragon's depth test and its shadow;
  - `occlusionFloor(x, y)`;
  - `sites()`, listing each site's position, type and project.
- Tasks 25, 27 and 28 code against this interface.

**Landmark sprite boxes [Call].** These are the limits siting and the visibility sweep use. Footprint is in cells; height is in units above the pad.

| Landmark | Footprint | Height |
|---|---|---|
| Abbey | ≤ 30 × 24 | ≤ 36 |
| Lighthouse | ≤ 7 × 7 | ≤ 40 |
| Windmill | ≤ 9 × 9 (sails live) | ≤ 30 |
| Bridge | span, abutment to abutment | deck ≤ 14 above water or gorge floor |
| Ruined cathedral | ≤ 34 × 16 | ≤ 26 |
| Churchyard yew | tree ≤ 13 × 13, chapel ≤ 10 × 7 | ≤ 18 and ≤ 14 |
| Unnamed feature | ≤ 6 × 6 | ≤ 10 |

**The town [Call]** is composed, not one sprite. Its street terraces, harbour and mole are terrain stamps. On them stand about 20 small house sprites (≤ 8 × 8, ≤ 14 tall) and an Adriatic-style bell tower with a clock face (≤ 7 × 7, ≤ 40 tall). The town's pad scoring uses the bell tower's box.

## 6. Task breakdown for cursor-delegate

Files are under `src/world/` unless shown in full; `scripts/world-*.ts` are thin wrappers, because the test runner only discovers `src/**`. Each task's test file sits beside its code and is written and committed by Claude first. Seams are **exact** (bit or byte equality), **property** (an invariant on a fixed fixture) or **bench** (reported, never blocking). C = `composer-2.5`, G = `grok-4.7-high`.

| # | Task | Files | Test seam | Model |
|---|---|---|---|---|
| 0 | **Gate.** Shared-module proof and bake bench (throttled desktop Chrome, desktop Safari; real per-cell workload) | `core/probe.ts`, `bench/bake-bench.ts`, `src/app/world-bench/page.tsx` | exact: one module runs under `node --test` and in a Next worker (explicit `.ts` imports, no enums, no path aliases). Bench: chunks/s and start-view time on a generated test field with the real per-cell workload, read by the owner in throttled Chrome and in Safari | Claude |
| 1 | RNG, hash, torus, lint | `core/rng.ts`, `core/hash.ts`, `core/torus.ts`, `core/lint.test.ts` | exact: golden sequences, stream independence, minimum-image distance; a source scan rejects banned calls in `src/world/` | C |
| 2 | Periodic rotated gradient noise | `core/noise.ts` | exact: `f(x + N) = f(x)`; range bounds; golden hash | G |
| 3 | B-spline upsample, polynomial sine, heap | `core/bspline.ts`, `core/psin.ts`, `core/heap.ts` | property: output within min and max of its node patch; tile edges agree; psin within 1e-4 of a table; heap total order | G |
| 4 | Blue-noise mask | `core/bluenoise.ts`, `public/world/bluenoise.bin` | property: toroidal; each rank once; low radial power below 0.25 cycles per cell | G |
| 5 | Plan: cores, spines, U, K, region weights | `gen/plan.ts`, `gen/params.ts` | property: archetype quota met; land share before erosion in range; arrays periodic; exact golden on the mini-world | G |
| 6 | Priority-Flood, receivers, accumulation | `gen/flood.ts` | property: no pits; every land node reaches sea; pop order is topological; area sums to land area; ties by index | G |
| 7 | Stream-power solver, diffusion, schedule, lattice resample | `gen/erode.ts`, `gen/resample.ts` | property: 1-D uniform uplift reaches the analytic steady slope; U = 0 never raises h; diffusion conserves mass; exact: two runs and a worker run hash equal | G |
| 8 | Drowning and glacial operators | `gen/drown.ts`, `gen/glacial.ts` | property: sea re-zeroed; lake, tarn and dam counts in range; depressions only inside masks; tarn aspect east to south-east | G |
| 9 | Talus with debris layer | `gen/talus.ts` | property: mass conserved to 1e-3; no slope above repose | G |
| 10 | Coast: exposure, retreat, stacks, coves, beaches, bathymetry | `gen/coast.ts`, `stamps.ts` | property: E is 0 in a closed lagoon and 1 on an open islet; mirrored coast gives mirrored E; no cliff over 12 on east or west shores; stack sizes; shelf slope | G |
| 11 | Rain, lakes, discharge, HAND | `gen/hydro.ts` | property: water conserved; lakes flat with one outlet; rain shadow sign on a ramp; HAND ≥ 0 and 0 on channels | G |
| 12 | River vectors, meanders, floors, beds, falls | `gen/rivers.ts` | property: every reach ends in sea, lake or reach; level never rises; width 1–6; sinuosity within 2 % of the expected value per ω; no self-intersection | G |
| 13 | Climate fields | `gen/climate.ts` | property: fields periodic and in range; windward wetter than leeward | C |
| 14 | Cover function | `cover.ts` | exact: rule table on synthetic inputs, rule order; pure and periodic | C |
| 15 | Scatter | `scatter.ts` | property: pure in position; density monotone; no tree on water or road; clearance south 1.25 h, north ≤ 2 | C |
| 16 | Visibility map and sight-line conform | `gen/visibility.ts` | exact: equals a brute-force test on random fields; property: after conform a fixture river is ≥ 85 % visible and still monotone | G |
| 17 | Site scoring and selection | `gen/sites.ts` | property: each rule on hand-built fixtures; spacing; quota; visibility ≥ 80 %; a fixture missing a type reports the failed rule | G |
| 18 | Roads, hamlets, bridges | `gen/roads.ts` | property: sites on one island connected; grade ≤ 12 %; none crosses sea; a path crosses the wrap; fixture valley yields one bridge | G |
| 19 | Parcels and boundaries | `gen/parcels.ts` | property: no gaps in farmland; boundaries never cross rivers | G |
| 20 | Conform and finalise | `gen/conform.ts`, `gen/finalize.ts` | property: pad flat within 0.5; cut and fill ≤ 3; after quantisation no new pits and rivers monotone; round-trip error ≤ 1/32 | G |
| 21 | Codecs, packs, manifest | `pack/codec.ts`, `pack/vectors.ts`, `pack/packs.ts`, `pack/manifest.ts` | exact: encode then decode is the identity; hashes of decoded arrays; property: mini-world sizes within scaled budget | C |
| 22 | Build CLI, stage cache, golden, seed sweep | `cli/build.ts`, `cli/seeds.ts`, `scripts/world-build.ts`, `scripts/world-seeds.ts`, `golden.json` | exact: mini-world stage hashes equal `golden.json`; cached run equals cold run | C |
| 23 | Cell rebuild | `bake/cells.ts` | exact: cell-tile edges agree with neighbours; a tile equals a crop of a larger window; offset by N identical | G |
| 24 | Shadow sweep and relief | `bake/light.ts` | exact: equals a brute-force march on 32² fixtures; tile-edge agreement | G |
| 25 | Chunk painter, depth, lines | `bake/chunk.ts`, `bake/lines.ts` | exact: crop equality and wrap equality; property: river raster 8-connected; lines never drawn on hidden pixels | G |
| 26 | Occlusion ink and hatch masks | `bake/ink.ts` | exact on synthetic fields: a smooth north slope up to 0.8 gets no ink; a ridge hiding ≥ 3 rows gets a 1 px line; no ink on water, roads, 1 px steps | G |
| 27 | Palette table, compositor, live layers | `render/palette.ts`, `render/compose.ts`, `render/live.ts` | exact: blit equals a reference; restyle never writes the bake; river L\* guard on the palette file. Bench: ms per frame | G |
| 28 | Streaming, worker pool, cache, haze | `runtime/stream.ts`, `runtime/worker.ts` | property: fetch and bake order for a scripted flight; never blank; cache bound; camera-relative depth across the wrap | C |
| 29 | Site assignment | `sites/assign.ts`, `landmarks.config.ts` | exact: sticky under pin and unpin; maximin choice; abbey reserved | C |
| 30 | Render harness, PNG encoder, gates | `cli/render.ts`, `cli/gates.ts`, `cli/png.ts`, `scripts/world-render.ts` | exact: PNG decodes back; raw RGBA hash stable across runs; each gate on synthetic images | C |

**Order.** Task 0 first, and stop if the bake gate fails. Then 1–4; 5–7 and a first critic pass on raw hillshade; 8–13; 14–20; 21–22 and seed choice with the owner; 23–27; 28–30. Tasks 14, 15, 23–26 and 30 can start once 3 and 4 land, against synthetic worlds.

**Stays with Claude (Fable).**

- Writing every task's tests, and classifying each assertion as exact, property or bench.
- `look/*.ts` and `gen/params.ts` values: tone curve, relief weight, ink and hatch thresholds, hatch masks, palettes for time, season and weather, cover thresholds and edge widths, hue variants and region accents, crown and rock shapes, micro-relief, and the erosion, uplift and coast constants that set character.
- Seed screening and the contact sheet; site scoring weights and landmark staging, judged on renders.
- The critic loop: prompts, rubric, ledger, and deciding what to change each round.
- Sprite and landmark art (outside this design).

## 7. Risks, open questions, omissions

### Risks

1. **Bake rate.** Unmeasured; estimates span five times. Task 0 gates it on the laptop target, with the fallback ladder in 5.5. Workers paused in background tabs are part of the same measurement. Phones default to the text site, so their limits are informational.
2. **Uniform, fern-like erosion.** Stream power alone looks the same everywhere. The cures are rock stripes, stopping early, regional diffusion, drowning and the glacial and coastal operators. The first critic pass after task 7 judges this before more is built on it.
3. **Constraint pile-up in siting.** Visibility, orientation and the home river may reject most seeds. The sweep reports which rule fails most; the levers are relaxing the bay's facing by 30° and the cathedral's southern clearance.
4. **Soft inland cliffs** at 4 cells per node. Stamps restore coastal edges; if inland cliffs read soft, add a cliff-line stamp from the talus stage.
5. **Orientation rules could look staged.** The 60° tolerance and rocky east and west shores guard against it; the hazard views watch it.
6. **Size estimates.** Only the height figure rests on measurements. Allow +30 %; the 3 MB cap still holds.
7. **Scatter repetition** at 256 cells; the motion strip and autocorrelation gate watch it.
8. **Derivative readings.** A red-roofed harbour town with a clock tower, and a Welsh mining valley, each echo a well-known film. The mining hardware is dropped; the tower is open question 6.
9. **Toolchain.** Node's type stripping and the Next bundler accept different syntax; task 0 proves the shared subset.

### Owner answers (2026-11-16)

1. **Paint:** confirmed. Lush Ghibli colour, with ink on silhouettes, cliffs and coasts.
2. **Height cap:** 130, not the proposed 100 (5.1). Visibility rules stay as written.
3. **Start:** offshore at the home river's mouth, flying upriver past the town to the abbey (about 40 s). The home-river rule is a hard seed requirement.
4. **Phones:** they default to the text site. The performance target is a mid-range laptop (3, 5.5).

### Defaults taken (the owner may override)

5. A reserved site with no project holds a small unnamed feature: a wayside cross, a sheepfold or a jetty.
6. Small life is welcome as live sprites: sheep, boats, gulls. Valley country gets a slate quarry.
7. The town's tower is an Adriatic-style bell tower with a clock face, to stay clear of a famous film town.
8. Landmark type per project is set in `src/world/landmarks.config.ts`, which the owner edits. The hash of the repository name is the fallback.
9. About 2 MB of committed binary per accepted world is fine. The owner picks the seed from a contact sheet.

### Deliberately left out, or left to the builder

- Ice, tectonic and sediment-transport simulation. Deposition-aware stream power (Yuan et al. 2019) is the upgrade path for floodplains and fans.
- Droplet erosion, irregular meshes, hydrology-first construction.
- A second, low-sun shadow bake. The sweep makes it cheap to add later.
- Pre-baked pixel tiles, except as a fallback for the start view.
- Horizon mapping and tonal art maps beyond two nested hatch densities.
- Landmark models, the dragon's flight rules, the first-minute choreography beyond what terrain guarantees.
- **Builder's choice:** heap and queue internals, the diffusion solver's form (given a fixed sweep count), stamp and pack byte layouts beyond 5.4, the worker pool and its messages, cache eviction.
