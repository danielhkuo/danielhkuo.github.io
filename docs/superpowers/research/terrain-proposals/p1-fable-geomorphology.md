# P1: terrain from process (lead proposal)

Planner: Fable, lead. Angle: realism first. Land is built the way land forms (uplift, rivers cutting, slopes failing, waves working the coast), then conformed to what a 400×225 pixel view can show.

Numbers marked **(measured)** come from a throwaway Node 26 experiment on an M-series Mac (periodic gradient noise, Priority-Flood, implicit stream-power solve, on a torus). Everything else is a design default to tune.

In short: a 7680² torus, eroded offline by the stream-power law over designed uplift and rock maps; shipped as a 3840² heightfield, a cover map and vectors (about 3 MB, committed); baked in a client worker into 256-pixel chunks.

## 1. Scale

### 1.1 World size and pacing

| Quantity | Value | Why |
|---|---|---|
| World | 7680 × 7680 cells | 7680 = 30 × 256, and 7680 × 0.8 = 6144 = 24 × 256. Bake space wraps on whole pixels and whole chunks. 8192 × 0.8 = 6553.6 does not. |
| Cruise / boost | 60 / 114 cells/s | From the spike. |
| Lap of the torus | 128 s / 67 s | 7680 / 60. |
| Reserved sites | 12 | Two of most types (section 6). |
| Minimum site spacing | 1800 cells = 30 s | Hard constraint in siting. |
| Ideal spacing, 12 occupied | 2383 cells = 40 s (21 s boosted) | Hex packing: d = 1.075 · L / √n. |
| Ideal spacing, 7 occupied | 3120 cells = 52 s (27 s boosted) | Abbey plus six pinned repos. |

So 7 to 12 occupied sites all land inside the 30–60 s window at cruise. A 4096 world would give 17–28 s, which is too short. The one deliberate exception is abbey to town: 1200 cells (20 s) down one river, as the first lesson that rivers are roads.

### 1.2 Heights

- One height unit is one screen pixel (KH = 1). Sea level is 0. Sea floor reaches −24.
- Land reaches 160. Target hypsometry: 70 % of land below 40, highlands 60–120, three or four summits above 130.
- HMAX = 224: 160 land + 8 canopy + 48 landmark + 8 spare.
- Sprites imply about 2 m per cell (a tree crown is 3–7 px). Landforms are compressed about ten times against that, like a model railway.

### 1.3 Quantisation and terraces

- Shipped heights are quarter units in a u16. Column tops are rounded to whole pixels only at bake time. Shading uses the float surface, so there are no contour bands.
- **Terraces do not survive as the land's style.** A slope under 1 steps by one pixel at a time, which is native resolution, and gets no ink.
- Steps return in two chosen places: field terraces (3-unit lynchets) on farmland slopes of 0.15–0.35 near the town, and bedding benches drawn as hatch lines on sedimentary cliffs.

## 2. The pipeline

Grids: **G1** = 1920² (4 cells per node), **G2** = 3840² (2 cells per node, the shipped grid). Each stage is a pure function `(inputs, params, seed) → typed arrays`, and writes a `.bin` plus a debug PNG.

### S0 Foundations

- **RNG:** `sfc32`, one stream per stage, keyed by `hash(seed, stageName)`. Adding a stage never shifts another stage's numbers.
- **Arithmetic rule:** world code uses only `+ − × ÷`, `Math.sqrt`, `abs`, `floor`, `fround`, `imul`. These are correctly rounded under IEEE 754 and so identical on every engine and CPU. No `sin`, `cos`, `pow`, `exp`, `log`. This is why the erosion exponent is 0.5 (a square root). The few places that need a sine use a fixed polynomial.
- **Noise:** periodic gradient noise (16 literal gradients, quintic fade, lattice indices taken modulo the period). Octave k samples at Mᵏ·p with the integer matrix M = [[2, 1], [−1, 2]]. That is a rotation by 26.57° and a scale of √5. Because M is an integer matrix, every octave still tiles. **Measured:** wrap difference exactly 0.
  - Beats value noise (no grid rectangles) and beats simplex or a 4D torus mapping (awkward or anisotropic on a torus).

### S1 Plan: uplift, rock, regions (G1)

1. Place 14–18 island cores by Poisson disk on the torus (r = 1100 cells).
2. Give each an **archetype** from a fixed quota:

| Archetype | Count | Uplift peak | Rock | Reads as |
|---|---|---|---|---|
| Home island | 1 large (~1900 across) | 70 | mixed, soft lowland | abbey hill, farm valley, town bay |
| Highland massif | 1 large | 160 | hard core | ridges, scree, snow |
| Mining valleys | 1 medium (~1000) | 90 | hard and soft in stripes | parallel deep valleys |
| Lake country | 1 medium | 120 | medium | ribbon lakes, alpine meadow |
| Karst coast | 2 medium/small | 60 | hard | cliffs, coves, stacks |
| Skerries | 8–12 small | 15–30 | hard | stacks, lighthouses |

3. Each core gets a **fold-belt spine**: a polyline of 3–6 segments along one global strike direction (±25°), with two or three parallel offset ridges.
4. **Uplift** `U = amp · plateau(distance to spine / halfWidth) · (0.55 + 0.45 · ridgedNoise stretched 3:1 along strike)`. Outside the islands U is 0 and the node is sea.
5. **Erodibility** K: three rock classes in domain-warped stripes along strike, 300–600 cells wide. Hard ×0.4, medium ×1, soft ×2.2.
6. **Region id** (u8): the warped Voronoi cell of each core.

Why: real ranges have grain, and noise with a radial falloff has none. Stream-power erosion exposes whatever structure U and K carry, which is the idea behind authoring in the uplift domain (Schott 2023). Striped K gives the trellis drainage of Welsh and Appalachian valleys, and later gives headlands on hard rock and bays on soft.

### S2 Fluvial erosion (G1, then G2)

The stream-power law with hillslope diffusion:

`∂h/∂t = U − K·√A·S + κ∇²h` (m = 0.5, n = 1)

solved implicitly in O(n) per step (Braun & Willett 2013).

```
step():
  # 1. route: Priority-Flood from all sea nodes (Barnes 2014, +ε variant)
  heap ← land-adjacent sea nodes; f ← h on sea
  while heap: c ← pop lowest f; order.push(c)
    for n in 8 wrapped neighbours, unseen: f[n] ← max(h[n], f[c] + ε); push n
  rcv[i] ← steepest-descent neighbour of i on f      # f has no pits
  # 2. area: walk order backwards, A[rcv[i]] += A[i]  (A starts as rainfall)
  # 3. solve: walk order forwards (receiver is always done first)
  F ← K[i]·dt·sqrt(A[i]) / dist(i, rcv[i])
  h[i] ← max((h[i] + U[i]·dt + F·h[rcv[i]]) / (1 + F), h[rcv[i]] + ε)
  # 4. diffuse: one explicit pass, κ = 0.15 (soft rock ×2)
```

- The flood's pop order is a valid upstream order, so one flood gives pit-free routing, lakes, and the solve order together.
- **Schedule:** 200 steps on G1. Upsample bicubic to G2, add 6 % noise so channels re-route. 40 steps on G2.
- **Stop at 70–80 % of steady state.** Uplands keep relict plateaus: the moor, the windmill ridge, the alpine meadow.
- **Rain:** uniform for the first 100 steps, then the orographic rain from S6, so windward slopes cut deeper.
- **Measured:** 50 ms per step at 1024², 244 ms at 2048² (58 ns per node at 28 % land; 85 % of it is the flood). Extrapolated: G1 ≈ 45 s, G2 ≈ 35 s.

Why this beats the alternatives:

- **Droplet erosion (Beyer 2015):** noisy, slow at 14.7 M nodes, and it promises neither a connected network nor graded long profiles. Stream power gives dendritic basins, V-shaped valleys and concave river profiles by construction.
- **Hydrology first (Génevaux 2013):** guarantees rivers, but the valleys are assembled from primitives and do not respond to rock. I keep its best idea: the river network is a vector graph that the fine terrain is conformed to (S6).
- **Deposition-aware stream power (Yuan et al. 2019):** would give floodplains and fans from physics. It is the upgrade path. v1 uses geometric floodplain and delta operators (S5, S6), which are easier to test.

### S3 Glacial imprint (G2)

A purely fluvial surface has no hollows, so it has no lakes. Real lakes are mostly glacial. I do not simulate ice (Cordonnier 2023 is real, and far too heavy). Three geometric operators stand in:

- **Ribbon lakes** (Lake country, 3–6): on a valley reach with moderate drainage and floor height 20–70, lower the floor along 80–250 cells by a parabola 6–14 deep, and widen the cross-section toward a U.
- **Tarns** (Highland, 4–8): at valley heads above 100 that face north or north-east, a bowl of radius 12–20 and depth 5.
- **Moraine dams** (2–4): a 4–8 unit bar across a valley.

S6's flood fills these into lakes with outlets.

### S4 Talus (G2)

Thermal erosion (Musgrave, Kolb & Mace 1989), 30 sweeps. Repose slope by rock: hard 1.8 (cliffs stand), medium 1.0, soft 0.6, in height per cell. Moved material goes into a **debris layer D**. Scree is where D > 0.75 and slope ≥ 0.45, so scree sits below cliffs because that is where the rock fell. **Measured:** 16 ms per sweep at 2048².

### S5 Coasts (G2)

1. **Exposure E ∈ [0, 1]** per shore node: mean open-water fetch over 16 wrapped rays (up to 600 cells), with the south-west quadrant weighted double for the prevailing wind.
2. **Cliffs and stacks** (E > 0.55, medium or hard rock): retreat distance `r = 40 · (E − 0.55) · k` (hard 0.6, medium 1.0). Land within r of the old shore is cut to a wave-cut platform at −1.5 to −3, except where a hardness noise exceeds 0.8. Surviving pieces of 8–120 cells are **sea stacks**; smaller ones are removed. Cliff height is whatever the land stood at distance r, capped at 60.
3. **Beaches** (E < 0.35, shore slope < 0.15): land within 10 cells is lowered to `0.6 + 0.05·d` and marked sand. The sea bed is raised to a 0.04 slope for 30 cells: the pale shallow shelf.
4. **River mouths:** sheltered (E < 0.4) gives a delta fan of radius 6·√w with two or three distributaries. Exposed gives an estuary: width ×3 over the last 40 cells, with mud.
5. **Bathymetry:** depth = min(24, 0.12 · d · (0.6 + 0.8E)), plus low noise.

Why: one sea-level threshold gives the same coast everywhere. Exposure times rock puts beaches in bays and cliffs on headlands.

### S6 Final hydrology (G2 to vectors)

1. **Rain:** sweep moisture along the wind (south-west to north-east), dropping rain in proportion to upslope gain and leaving a rain shadow (the mapgen4 approach). Two laps of the torus so it converges.
2. **Lakes:** Priority-Flood again. Keep basins of ≥ 120 cells and ≥ 1.5 deep as lakes at their spill level; fill the rest. After this **no land node is a pit**.
3. **Discharge** Q = accumulated rain. Width `w = clamp(0.03·√Q, 1, 5)` px (w ∝ √Q is classic hydraulic geometry). Q ≥ 600 is a 1 px stream, about 4,000 is 2 px, 10,000 is 3 px, 28,000 is 5 px. Target: a stream every 50–80 cells.
4. **Vectorise:** trace reaches between heads, confluences, lakes and mouths. Simplify (Douglas–Peucker, 0.75 cell), then Chaikin ×2, which removes D8's 45° zigzags.
5. **Meanders:** on reaches with slope < 0.012 and w ≥ 2, bend the centreline with a sine-generated curve. Wavelength 10 w (Leopold & Wolman 1957 give 7–12 widths). Minimum bend radius 2.3 w (their 1960 paper gives 2–3). Clamp to the valley floor. One reach in eight gets an oxbow pond.
6. **Valley floors:** for w ≥ 2, flatten ground within 3w plus the meander amplitude to `bed + 0.5 + 0.02·d`, blended with a smooth minimum. Valleys widen downstream; upstream they stay V-shaped.
7. **Carve:** bed height along a reach is the running minimum of the surface minus (0.5 + 0.3w), so water never flows uphill. Drops of ≥ 4 units within 3 cells are flagged as **waterfalls**. They fall where hard rock meets soft, as real knickpoints do.

Output: `reaches[] {id, downstream, order, vertices[x, y, width, surface] in quarter cells}`, `lakes[] {id, level, outlet}`, and a river graph for navigation (every site records its nearest reach).

### S7 Climate and cover (G2)

Fields: temperature `T = 1 − h/160 − 0.15·northness·slope`; wetness W (multiple-flow area over slope, plus rain); wind exposure X (how open the horizon is to the south-west within 60 cells); coastal exposure E; debris D; slope S.

```
cover(node):
  if water → 0
  if beach flag → sand;  if estuary/delta mud → shingle-mud
  if T < 0.14 or (T < 0.22 and north-facing) and S < 0.9 → snow
  if D > 0.75 and S ≥ 0.45 → scree
  if S > 0.9 or (S > 0.6 and hard rock) → bare rock
  if floodplain and W > 0.8 → marsh
  score forest = W·(1 − X)·band(T, 0.35..0.9)·band(S, 0.05..0.7)
  if forest > 0.45 → conifer if T < 0.5 else broadleaf
  if X > 0.65 or T < 0.4 → heath
  if S < 0.15 and W > 0.5 → lush meadow;  if S < 0.3 → pasture
  else → scrub (dry, steep) or hay (sunny, gentle)
```

- Thresholds are compared against `score + 0.08·noise`, so borders wander.
- Then a 3×3 majority filter, and patches under 12 nodes are removed.
- 16 classes in 4 bits: water, sand, shingle-mud, marsh, lush meadow, pasture, hay, heath, broadleaf, conifer, scrub, rock, scree, snow, farmland, paved.
- No rule is an altitude band.

### S8 Scatter

- **Natural scatter costs zero bytes.** One 256×256 toroidal Poisson-disk set (Bridson 2007, r = 2.2, about 8,500 points), each point with a rank, is a committed constant. The client tiles it and keeps a point when `rank < density(cover, local noise)`. Sprite variant = hash of world position.
- Densities: forest 0.9, wood edge 0.5, scrub 0.3, scree boulders 0.2, heath tussocks 0.25, meadow flowers 0.15 (1 px flecks).
- Trees are three sprites (crowns 3×3, 5×4, 7×6; 4–9 tall). Their height joins the shadow pass, so woods cast shadows. Dense forest interior is drawn as a bumpy canopy with crown highlights, and single trees appear at edges and in parkland.
- **Structured scatter ships as vectors:** hedgerows and dry-stone walls from splitting farmland into parcels of about 18 × 40 cells, long side along the contour.

### S9–S11 Sites, roads, conforming

- **S9** picks sites (section 6).
- **S10 roads:** weighted shortest paths on G2 (Galin et al. 2010). Cost per step = `length · (1 + 12·slope² + curvature penalty) + 40 per water cell + forest surcharge`. Roads join the town to the abbey and to each site on the same island. Each water crossing is a bridge candidate. Lanes are 1 px, the town road 2 px.
- **S11 conform:** flatten each pad with a smoothstep skirt (cut or fill ≤ 3 units), bench roads into slopes, stamp farmland around the town, re-run the no-pit check.

## 3. Wrapping

Every stage indexes through one `wrap()` helper. Per stage:

- **Noise:** periodic lattice, integer-matrix octaves (exact).
- **Poisson disks, Voronoi, site spacing:** torus distance.
- **Priority-Flood:** seeded from the coast, so no edge exists to treat specially.
- **Fetch rays, wind sweep, shadow sweep, distance transforms:** wrap, and run a second lap where they carry state.
- **Road search:** neighbours wrap; the heuristic uses torus distance.
- **Vectors:** stored unwrapped (a reach may run past 7680) and rasterised modulo the world.
- **Tiles and chunks:** 15 × 15 data tiles and 30 × 24 bake chunks divide the world exactly. Tiles carry no duplicated border; the client holds neighbours, so edges cannot disagree.
- **Repeating textures:** blue noise 64², scatter 256², clouds 256². All divide 7680 and 6144.

Tests: exact wrap equality for noise; roll invariance for pure stages (generate, roll by (dx, dy), compare with generating rolled inputs); for erosion, the height step across the seam must stay under the 99.9th percentile of interior steps.

## 4. Data formats and where generation runs

### What ships: heightfield, cover and vectors

The alternative is baked pixel layers. The bake is 7680 × 6144 ≈ 47 M pixels × 4 layers, and hatch and dither compress badly: 15–25 MB, doubled for a sunset bake. The heightfield route is about 3 MB, allows a second sun direction for free, and lets the look change without re-shipping the land. Its cost is client bake time (section 5.3).

`public/world/<version>/`:

| File | Content | Size |
|---|---|---|
| `manifest.json` | dimensions, tile index with sizes and hashes, sites, regions | ~8 KB |
| `graph.bin` | river graph (order ≥ 2) and road graph, topology only | ~30 KB |
| `overview.bin` | 240² cover and height map for the menu and Continue map | ~20 KB |
| `t/<tx>_<ty>.bin` ×225 | 512×512-cell data tile: 256² heights, 256² cover, clipped vectors | 0.1–45 KB |
| `postcard/<site>.bin` ×12 | pre-baked 512×256 px window at each site | ~200 KB each |

Tile encoding:

- **Heights:** quarter-unit integers, predicted by the plane rule (left + up − up-left), zigzag varint, raw deflate. **Measured** on the experiment's terrain: 3.3–3.8 bits per land sample (5–6 bits at sixteenth units, 2–2.6 at whole units). Quarter units are the sweet spot. Sea costs almost nothing.
- **Cover:** 4 bits per G2 node, row run-length, deflate.
- **Vectors:** delta-coded quarter-cell vertices.
- Decoding uses the browser's `DecompressionStream('deflate-raw')`. Pages does not reliably compress binary files, so the files are compressed by us.

Expected totals: heights ≈ 2.0 MB (14.7 M samples × 30 % land × 3.6 bits), cover ≈ 0.3 MB, vectors ≈ 0.3 MB. **About 2.6–3 MB for the whole world.**

### Budget and streaming order

I propose tightening the budget: **0.5 MB before first flight, 3.5 MB total.**

1. Manifest, graph, and one postcard (the abbey, or the Continue site): about 250 KB. The first frame draws from the postcard with no baking.
2. The 3×3 data tiles around the start: about 300 KB at worst. The worker starts baking while the menu is still up.
3. Tiles ahead of the heading, nearest first.
4. Everything else when idle.

### Where generation runs: committed assets

- The world is an authored thing, tuned through critics. It should change only when the owner runs `npm run world:build` and reviews the renders.
- The Pages build stays fast and cannot fail on a five-minute simulation.
- CI only checks that file hashes match the manifest.
- Cost: about 5–6 MB in git per world version. Keep one version in the tree.
- A golden-hash test still pins determinism.

## 5. Rendering

### 5.1 Baked per chunk, in a worker

A chunk is 256×256 bake pixels. Order of work:

1. **Rebuild cells.** Catmull-Rom upsample of G2 heights to cells. Add micro-relief by cover (rock ±1.5, heath ±0.6, meadow ±0.25, sand 0). Rasterise rivers, lakes and roads from vectors. Upsample cover with blue-noise-jittered nearest neighbour, so class borders are organic and not 2-cell blocks. Rebuilt cell tiles are cached, because chunks to the north need the same cells.
2. **Shading.** Normal from the float surface (Sobel, radius 2). Light = 0.6 · Lambert (sun from the north-west, 63° up, as in the spike) + 0.4 · relief term, where relief = clamp(k · (h − boxBlur(h, r = 6))). That is an unsharp mask: two box-blur passes, O(1) per cell. It lightens ridges and darkens valley floors, which is what makes drainage readable from above. A true horizon scan (Max 1988) costs about 100 samples per cell.
3. **Cast shadows, exact and O(1).** The sun lies on the grid diagonal, so sweep each diagonal away from the sun with a running maximum:

```
for each diagonal, t increasing away from the sun:
  v ← h[t] + 2·t                # the ray climbs 2 units per step
  shadowDepth[t] ← runMax − v   # > 0 means shadowed
  runMax ← max(runMax, v)
```

   This replaces the spike's 64-step march. It needs an 80-cell upwind apron (160 / 2). Canopy and landmark heights are included. Depth under 1.5 is dithered for a soft edge. This is the scanline idea behind Timonen & Westerholm 2010, specialised to one fixed sun.
4. **Tone.** Seven levels in 3 bits: ink, hatch, deep shade, shade, base, lit, highlight. Continuous light is quantised with a 64² void-and-cluster blue-noise tile (Ulichney 1993), but only within ±0.15 of each threshold. Tones stay flat like poster paint, with soft edges and no banding.
5. **Ink** (from depth and face breaks, after Saito & Takahashi 1990):
   - silhouette: depth jump > 3.5 and the occluding wall is ≥ 3 px;
   - cliff crease: a top face over a wall ≥ 4 px tall, in runs ≥ 3 px long;
   - coast: ink on cliffed shores and on the south side of land; beaches get a foam line, not ink;
   - rivers: none for w ≤ 2; the north bank only for w ≥ 3;
   - never on 1 px steps.
   - **Budget: ink is 3–7 % of land pixels in every critic view.**
6. **Hatching.** A 16×16 stroke tile in three nested densities (denser levels contain the sparser ones, the tonal-art-map idea of Praun et al. 2001). Used in cast shadow and on steep shade. Direction follows the fall line, snapped to 4 directions. Cliff walls get vertical strokes on hard rock and horizontal bedding lines on sedimentary rock.
7. **Walls.** A grass column has a 1 px turf lip, then earth or rock below.
8. **Scatter** sprites are stamped as short columns with their own depth.

Bake pixel, 4 bytes: material (6 bits) + face (2 bits); light (3 bits) + cycle phase (2 bits) + snow rank (2 bits) + cloud flag (1 bit); depth (u16, eighths).

### 5.2 Live per frame

All live effects are palette lookups, so the frame stays near the spike's 0.5 ms (roughly 2 ms on a mid-range phone; budget 4 ms). The compositor copies row segments per chunk rather than testing chunks per pixel.

- **River flow:** river pixels carry a 2-bit phase from distance along the reach. Cycling the palette moves the water downstream.
- **Shore:** a 2-bit distance band cycles foam in and out. Open-sea glints as in the spike.
- **Wind in grass:** hay and meadow carry a 2-bit phase along the wind; a palette wave crosses the fields.
- **Seasons:** snow rank (never, winter, shoulder seasons, permanent) lets the palette move the snow line with the date. Broadleaf and conifer are separate materials, so autumn colours the right trees.
- **Cloud shadows, dragon, dragon shadow, wake:** as in the spike.

### 5.3 Bake cost

- The spike bakes at 1.4 µs per cell including its noise. I budget 2.7 µs per cell for the new bake (rebuild 0.5, shade and relief 1.0, shadow 0.2, columns, ink and scatter 1.0).
- A chunk covers 256 × 320 new cells: about 0.22 s on an M-series Mac, about 0.9 s on a mid-range phone.
- Cruise needs about 0.7 chunks per second (a new 256 px column every 4.3 s, three chunks tall); boost needs 1.3. Two workers on a phone give about 2.2.
- Cache: 48 chunks × 262 KB ≈ 12.6 MB.
- A sunset bake is the same code with a lower sun.

## 6. Landmark siting

Twelve sites: abbey 1, town 1, and two each of lighthouse, windmill, bridge, ruined cathedral and yew. Candidates are scored on G2, then picked greedily, best first, under the 1800-cell spacing rule. Distances are in cells.

| Type | Rule | Pad |
|---|---|---|
| **Abbey** | Home island. Hilltop: highest point within 60, prominence ≥ 18, height 35–70. One flank under 0.35 slope for the road. A river of w ≥ 2 within 250 that reaches the town's bay. | r = 14 |
| **Town** | Shore with E ≤ 0.25 and a bay mouth opening ≤ 120°. Water ≥ 3 deep within 25 of shore (harbour). ≥ 2,500 cells under 0.2 slope within 70. River mouth within 120 and a beach beside it. 1200–1600 from the abbey. | three stepped terraces |
| **Lighthouse** | Headland: land fraction within 40 ≤ 0.35, E ≥ 0.6, cliff 10–35. Or a stack of ≥ 60 cells. | r = 5 |
| **Windmill** | Ridge: stands ≥ 8 above the mean within 30, wind exposure X ≥ 0.7, height 25–80, along-ridge slope < 0.15, pasture or heath. | r = 6 |
| **Bridge** | A road crossing of a river with w ≥ 3 (stone bridge), or of a gorge ≥ 14 deep and ≤ 26 wide (aqueduct). Abutments on medium or hard rock. Chosen after S10. | abutments |
| **Ruined cathedral** | Valley floor: ≥ 10 below the mean within 40. Flat area ≥ 24 × 14. 12–40 from a river of w ≥ 2 and ≥ 1.5 above it. Slopes on two sides, woods within 60. | 24 × 14, meadow |
| **Yew** | Knoll: prominence 5–12, radius 10–18, height 10–40, meadow or pasture, within 150 of a road or hedge. | r = 4, wall ring r = 9 |

Each site records type, position, height, facing (8 directions), approach road, nearest reach, region, and score.

**Matching projects to sites** (build time, never touches terrain):

- The abbey is fixed.
- A project may name a preferred type in the owner's project data. Otherwise type = hash(repo name) over the free types.
- Assignments are **sticky** in a committed `site-assignments.json`. A new pin takes a free site; an unpinned repo frees its site; nothing else moves.
- Among free sites of the wanted type, choose the one that maximises the minimum distance to occupied sites. This keeps hops inside the pacing window.

## 7. The render-critic harness

`scripts/world-render.ts` runs in Node with the same bake code as the browser. It writes PNGs with a small built-in encoder (zlib plus CRC, no dependencies) to a git-ignored `out/world-renders/<git sha>/`, at 3× nearest-neighbour.

**Viewpoints (31), all chosen by the generator so they follow the seed:**

- 12 site postcards.
- 8 landform views: sharpest ridge, a meander reach, a delta, the largest lake, a cliff coast with stacks, a sheltered beach, a forest-to-meadow edge, open moor.
- 4 seam views: the wrap corner, the x seam, the y seam, a chunk corner.
- 3 whole-world maps at 1/16: hillshade, cover, and drainage with basins coloured.
- 4 palette sheets: one view across four times of day and four seasons.

Each view also writes diagnostics (height, light, ink only, material) and a metrics JSON: ink share, tone histogram, river width histogram, cover shares per region, slope histogram, hypsometric curve.

**Rubric** (two independent critics, each criterion 1–5, citing pixels or metrics):

1. Water shapes the land (basins, branching, valley form).
2. Rivers read (1–5 px, continuous, every one ends in a sea or lake).
3. Coast variety (beach, cliff, stack, cove, shelf all present).
4. Mountain structure (ridges, scree under cliffs, snow on high north faces).
5. Cover follows the land (no altitude bands).
6. Regions differ (a critic can name the archetype from the picture).
7. No artefacts (steps, rectangles, seams, speckle).
8. Ink discipline (silhouettes and cliffs only).
9. Landmarks sit believably, with approaches.
10. Paint (Ghibli summer colour, readable at 1×).

Pass: no criterion under 3, mean ≥ 4, and every seam view scores 5 on criterion 7.

## 8. Tasks for cursor-delegate

All under `src/world/`. Each task has a `.test.ts` beside its file. C = `composer-2.5`, G = `grok-4.7-high`.

| # | Task | Files | Test seam | Model |
|---|---|---|---|---|
| 1 | RNG, torus helpers, safe-maths lint | `core/rng.ts`, `core/torus.ts` | golden sequences; stream independence; a source scan that rejects `Math.sin/pow/random` | C |
| 2 | Periodic rotated gradient noise | `core/noise.ts` | exact wrap equality; range; golden hash | G |
| 3 | Poisson disk on a torus, ranked | `core/poisson.ts` | minimum distance across the wrap; determinism | G |
| 4 | Plan: cores, spines, U, K, regions | `gen/plan.ts` | land share 28–32 %; quota met; roll invariance | G |
| 5 | Priority-Flood and routing | `gen/flood.ts` | no pits; every land node reaches sea; order is topological | G |
| 6 | Stream-power solver and schedule | `gen/erode.ts` | uniform U matches the analytic steady slope; relief in range; seam percentile; time budget | G |
| 7 | Glacial operators | `gen/glacial.ts` | lake counts in range; depressions only inside masks | G |
| 8 | Talus with debris layer | `gen/talus.ts` | mass conserved to 1e-3; no slope above repose | G |
| 9 | Coast: exposure, cliffs, stacks, beaches | `gen/coast.ts` | E is 0 in a closed lagoon and 1 on an open square islet; stack sizes; shelf slope | G |
| 10 | Rain, lakes, discharge | `gen/hydro.ts` | water conserved; lakes are flat; rain shadow sign | G |
| 11 | River vectors, meanders, carving | `gen/rivers.ts` | every reach ends in sea, lake or reach; bed never rises; width ≥ 1; bend radius ≥ 2.3 w | G |
| 12 | Climate fields and cover | `gen/cover.ts` | rule table on synthetic slopes; no patch under 12 nodes | C |
| 13 | Site scoring and selection | `gen/sites.ts` | each rule on hand-built fixtures; spacing ≥ 1800; quotas | G |
| 14 | Roads and bridges | `gen/roads.ts` | sites connected; slope cap; fixture valley yields one bridge | G |
| 15 | Conform pads and roads | `gen/conform.ts` | pad flat within 0.25; cut and fill ≤ 3; still no pits | C |
| 16 | Tile codec | `pack/tile.ts` | encode/decode round trip; size budgets | C |
| 17 | Vector codec and manifest | `pack/vectors.ts`, `pack/manifest.ts` | round trip; hashes | C |
| 18 | Build CLI and world golden hash | `scripts/world-build.ts` | same seed gives the same manifest hash twice | C |
| 19 | Cell rebuild | `bake/cells.ts` | tile-edge agreement; matches the offline reference within 0.25 | G |
| 20 | Shadow sweep and relief term | `bake/light.ts` | equals the brute-force march on random fields; chunk-edge agreement | G |
| 21 | Chunk baker (columns, depth, layout) | `bake/chunk.ts` | adjacent chunks agree; wrap chunk equals chunk 0; time budget | G |
| 22 | Scatter | `bake/scatter.ts` | determinism; density monotone; no tree on water | C |
| 23 | PNG encoder and render harness | `scripts/world-render.ts`, `core/png.ts` | decodes back; viewpoint list is stable; metrics schema | C |
| 24 | Streaming, chunk cache, compositor | `runtime/stream.ts`, `runtime/compose.ts` | fetch order; eviction; frame budget on a fixture | C |
| 25 | Site assignment | `sites/assign.ts` | sticky under pin and unpin; maximin choice | C |

**Stays with Claude (Fable):** tone curve and dither band, ink thresholds, hatch tiles, palettes for day, season and weather, micro-relief amplitudes, cover thresholds, sprite art, the erosion and coast parameters that set character, and running the critic loop. Each is a parameter file (`look/*.ts`, `gen/params.ts`) with no logic in it, so tuning never fights a test.

Order: 1–3, then 4–6 and the first critic pass on raw hillshade, then 7–11, 12–15, 16–18, 19–23, 24–25.

## 9. Risks, questions, omissions

**Risks**

1. **Client bake speed on phones.** The 2.7 µs figure is an estimate, not a measurement. Mitigations in order: postcards cover the start; two workers; a fast first pass without scatter and hatch; if it still fails, ship baked chunks for the Home island only.
2. **D8 grain.** Single-direction routing biases channels toward 45°. The coarse-to-fine schedule, routing jitter and vector smoothing should hide it. If the critics still see it, move to an irregular Poisson-node graph, which the solver supports unchanged.
3. **Stream power alone looks uniformly dendritic.** The cure is the U and K structure, stopping early, and the glacial and coastal operators. This is the main thing the first critic pass must judge.
4. **Compression figures** were measured on experiment terrain, not the final pipeline. Final land has more detail; allow +30 %.
5. **Tall terrain hides land behind it.** A 160-unit peak hides 200 cells to its north. Only the Highland reaches that height.
6. **Scatter repetition** from the 256² point set. Variant hashing and density masks should hide it; a seam view checks.

**Questions for the owner**

1. Is a 128-second lap with about 30 % land the right amount of sea?
2. What stands on an unoccupied site: a bare pad, or a small unnamed feature (a wayside cross, a sheepfold, a jetty)?
3. Terrain up to 160 means the dragon must climb or follow the ground. Should some passes be impassable at low altitude?
4. May the abbey and town sit 20 s apart as the opening hop?
5. Is about 6 MB of committed binary per world version acceptable in the repository?
6. Do you want to choose the seed from a contact sheet of whole-world maps (say 16 seeds)?

**Left out on purpose**

- Simulated glaciers, plate tectonics, and sediment-transport physics (geometric stand-ins instead; Yuan 2019 is the upgrade).
- Droplet erosion anywhere.
- Caves, arches, overhangs: the surface is a heightfield.
- Tides, moving waves as geometry, river flow simulation (palette cycling only).
- Landmark models, the town's buildings, dragon flight: this design only provides their pads, roads and river graph.

## 10. Sources and what I take from each

Checked today against publisher or archive records:

- **Braun & Willett 2013**, *Geomorphology* 180–181, 170–179. The O(n) implicit stream-power solve in upstream order. Note its warning that transient results depend on step size; I fix the schedule.
- **Barnes, Lehman & Mulla 2014**, *Computers & Geosciences* 62, 117–127. Priority-Flood with the ε variant; I use its pop order as the solve order.
- **Cordonnier et al. 2016**, *Computer Graphics Forum* 35(2), 165–175. Uplift plus stream power as a terrain generator.
- **Schott et al. 2023**, *ACM TOG*, doi 10.1145/3592787. Authoring in the uplift domain; coarse-to-fine erosion.
- **Yuan, Braun, Guerit, Rouby & Cordonnier 2019**, *JGR Earth Surface* 124(6), 1346–1365. Stream power with deposition, O(n) implicit. Upgrade path only.
- **Génevaux et al. 2013**, *ACM TOG* 32(4), article 143. The river network as an explicit typed graph.
- **Galin et al. 2010**, *Computer Graphics Forum* 29(2), 429–438. Roads as weighted shortest paths with slope, curvature and water costs.
- **Leopold & Wolman 1957** (USGS Professional Paper 282-B) and **1960** (*GSA Bulletin* 71(6), 769–793). Meander wavelength 7–12 widths; bend radius 2–3 widths.

Cited from memory, not re-checked today: Musgrave, Kolb & Mace 1989; Beyer 2015; Bridson 2007; Saito & Takahashi 1990; Praun et al. 2001; Ulichney 1993; Max 1988; Timonen & Westerholm 2010; Cordonnier et al. 2023; Patel's mapgen4; Leopold & Maddock 1953 (width ∝ √Q). Verify before leaning on any detail beyond what is stated here.
