# Dragon world terrain: engineering proposal (p3, Sonnet)

Angle: the smallest pipeline that clears the quality bar inside the budgets. I go deepest on determinism, tiling and the wrap, data formats, bake time, streaming, frame cost, the critic harness and the task seams.

## 0. The shape of the answer

1. **Ship geography, not pixels.** Generation runs once offline on a coarse grid (1 macro cell = 4 world px) and commits about 2 MB of finished data: a 12-bit heightfield, three small control channels, river and road polylines, and a site table. The browser turns each 256×320 px tile into the baked layers (material, shade, depth) in a worker, in roughly 100 ms on a desktop and a few hundred ms on a phone. This still honours "visitors simulate nothing heavy": a tile bake is one pure function of shipped data, with no solver or iteration.
2. **Why not ship baked pixels?** The world is 6144×6400 px. Three byte-planes of that are 118 MB raw. My estimate after palette-index packing and deflate is 8 to 20 MB, which breaks the 8 MB budget on its own. Shipping geography is about 2 MB, so the whole world fits the budget four times over.
3. **Why not one whole-world bake?** The spike spent 1.4 s on 1024². Six times the area in one pass is 55 MB of layers in memory plus a main-thread stall. Tiles bound memory, parallelise across workers and fall out of the same function the harness already needs.
4. **Look changes never re-run generation.** All look work (shading, ink, dither, palette, scatter appearance) lives in the tile bake. Generation takes minutes. A bake of the 14 critic viewpoints takes seconds. The critic loop therefore iterates on the fast half.
5. **Determinism by construction.** Generation uses only `+ - * /`, `Math.sqrt` and integer ops. ECMAScript requires these to be IEEE-754 binary64 and correctly rounded, so every engine and CPU gives the same bits. `sin`, `cos`, `exp`, `log` and `pow` are implementation-approximated in the spec, so the generator bans them (section 2.0).

## 1. Scale and pacing (fact sheet section 8, item 3)

**World.** 6144 × 6400 world px on a torus. That is 24 × 20 tiles of 256 × 320 px. Pick these numbers because a tile's screen height is exactly 320 × 0.8 = 256 px, so one tile bakes to a 256×256 texel square, and the vertical screen period is 5120 px, an integer. Macro grid: 1536 × 1600 = 2.46 M cells.

**Pacing maths.** Flight speed is 60 px/s cruise and about 114 px/s boosting.

- Sites: 14 reserved (section 7). Active landmarks: 6 to 12, one per pinned project.
- Area per active landmark: 39.3 M px² / 8 = 4.9 M px², so nearest-neighbour spacing is about 2200 px. Following a river or road adds roughly 25%, so about 2750 px of path.
- Cruise: about 36 to 46 s. With 12 active landmarks the spacing is 1800 px and the time about 30 s. With 6 it is 2500 px and about 52 s. This is inside the 30 to 60 s bar for every plausible portfolio size.
- Boosting cuts that to 16 to 27 s, so boost is a shortcut, not a different game.
- Crossing the whole world takes 102 s at cruise. The wrap is felt after about 1.7 minutes, so the "no seams" guarantee matters in practice.

A 4096² world would give 23 s between 8 landmarks at cruise. That is too short for the 30 to 60 s bar and too empty of room for 7 land types and 4 regions. 8192² doubles all data for no pacing gain. 6144×6400 is the smallest size that clears the bar.

**Height range.** Water sits at 8.0 px. Land runs from 8.5 to a soft cap of 88 px. Landmarks add up to 22 px, which fits under HMAX = 110. Heights are stored as 12 bits over 0 to 128 px, a step of 1/32 px. That is far below the 1 px screen quantum, so the screen never sees a quantisation step. Quantisation is the last generator step, and everything downstream (rivers, lakes) is validated on the quantised data (section 2.3).

**Terraces.** Global terraces do not survive. The owner's complaint was an ink crease on every step. I keep exactly one terrace-like feature: **strata benching** on steep, hard-rock slopes only (stage 2). It adds a triangle-wave ledge of at most 1.5 px, weighted by slope and rock hardness, so real cliffs get believable ledges and meadows stay smooth. No trig needed.

## 2. The generation pipeline (item 1) and wrapping (item 2)

All stages run on the 1536 × 1600 macro grid. Every neighbour lookup uses toroidal indexing (`(x+W)%W`), so each stage is seamless by construction. I note the wrap handling per stage.

### 2.0 Primitives and determinism

- **RNG.** `sfc32` seeded from the owner's seed through a fixed splitmix32 expansion. Every stage derives its own stream as `hash32(seed, stageId)`, so stages can be re-ordered or re-run alone without changing each other.
- **Noise.** Periodic gradient noise (Perlin-style, 16 fixed gradient vectors written as constants, quintic fade), lattice hashed with an integer hash of `(ix mod P, iy mod P, stage)`. Frequencies are integer cycles per axis, so `f(x+W)==f(x)` exactly in bits. Domain warping is two layers of the same noise. Alternatives: value noise draws grid rectangles (the spike lesson); simplex needs a skew with a non-periodic lattice, which makes tiling awkward. Gradient noise with integer periods tiles exactly.
- **Banned in generation:** `Math.sin/cos/exp/log/pow/atan2`, `Math.random`, `Date`, object-key iteration order, and `Array.prototype.sort` without a total order. Any sort uses `(key, index)` tie-breaks. Priority queues key on `(height, index)`.
- **Single thread only.** Parallel reductions change float summation order. Generation is one thread.
- **Verification.** Each stage writes a SHA-256 of its output arrays into `world/golden.json` (committed). Tests recompute stage hashes, run the whole pipeline twice in one process, and once through a `worker_threads` worker. CI runs a matrix of macOS arm64 and Linux x64 on the pinned Node 26 and compares hashes. A mismatch fails, and the stage-level hashes tell you which stage drifted.

### 2.1 Base shape: islands and uplift

Algorithm:

```
seeds  = toroidal Poisson (dart throw, min dist 300 cells) -> 6 main islands r in [150,230] cells,
         + 24 islets r in [15,45]
mask(p) = max_i falloff( tdist(p, c_i) / r_i  warped by fbm(p, 2 octaves, amp 0.25) )
          where tdist uses min(|dx|, W-|dx|)
U(p)    = mask(p) * (0.35 + 0.65*ridged_fbm(p, 4 oct, f=6 cycles))        # uplift rate
        + sum over 2-3 mountain belts per main island of  belt(dist to a warped polyline, w=25-40 cells)
h0(p)   = U(p)*H0 + 0.04*fbm(p, 3 oct)                                    # breaks symmetry
sea cells (mask < 0.05) are fixed at sea level for the erosion solver
```

Land fraction target is 30%. The dart-thrown seeds and the belts give control over count and size, which a noise threshold cannot. Test seam: land fraction in [0.25, 0.36], at least 6 components larger than 20 k cells, and `U` identical bitwise under `x+W` shifts.

### 2.2 Erosion: implicit stream power, not droplets

I take **Braun & Willett 2013** (*Geomorphology* 180-181, 170-179), the FastScape method: the stream-power law `dh/dt = U - K A^m S^n` with n = 1 is solved implicitly. Each node's new height depends on its receiver's new height, so one pass in upstream-to-downstream order solves the whole grid in O(n) with no step-size limit. I checked the paper exists and the O(n) claim from secondary sources; I did not read the full text.

I also take from **Cordonnier et al. 2016** (*Computer Graphics Forum* 35(2), 165-175) the idea of painting an uplift map and running stream-power erosion to get believable large-scale drainage. Our "U" map above is that uplift map. I take lake handling from the same line of work (below).

Choice: `n = 1, m = 0.5`. The implicit update then needs only `sqrt`:

```
for it in 1..120:                       # dt = 1
  h[land] += U * dt
  W = priorityFloodEps(h)               # section 2.3 routine, torus, seeds = sea cells
  receivers = steepest D8 on W (ties: lowest index)
  order = topological order from receivers (stack-free counting sort)
  A = drainage area by accumulating in reverse order
  for i in order (base-level first):
     if W[i] > h[i] + eps: continue     # lake cell: no incision, it sits under its spill level
     r = rec[i]; L = dist(i, r)         # 1 or sqrt2
     f = K[i]*sqrt(A[i])*dt / L
     h[i] = (h[i] + f*h[r]) / (1 + f)
  every 10 its: 3 Jacobi talus passes (two buffers, slope cap 3 px/cell, move half the excess)
```

- `K[i]` varies in [0.5, 1.5] × K0 from a warped noise "hardness" field, so ridges of hard rock stand and soft rock opens into valleys. It also feeds cliffs and strata.
- Why stream power rather than droplet erosion (Beyer 2015 thesis, Mei/Št'ava style): droplets are stochastic, need 10^7 to 10^8 droplets for 2.4 M cells and give good local detail but no basin-scale drainage. Stream power makes branching networks, V-valleys in the hills (high `A^m S`) and wide valleys downstream by construction, in tens of seconds.
- Why not hydrology-first (Génevaux et al. 2013): it gives precise river control but needs a separate heightfield construction from the graph, and that gives flatter, more uniform results than letting erosion shape the hills. Stream power gives rivers for free and I can still bend them in 2.3.
- Hillslope: thermal erosion (Musgrave, Kolb & Mace 1989) as the cheap talus pass above. It makes scree and softens noise without simulation of diffusion.
- Strata benching (end of stage): `h += bench * slopeMask * hardness * tri(h / 3.0)`, where `tri` is a triangle wave and `bench <= 1.5 px`.
- Final rescale: `h_px = 8 + max(0, h - sea) * s` with `s` chosen so the 99.9th percentile is 78 px.

**Measured** (throwaway Node run, 1536², random periodic fbm start, plain JS):

| step | time |
|---|---|
| noise field | 78 ms |
| Priority-Flood with epsilon (naive array heap) | 736 ms |
| one implicit stream-power iteration (receivers, accumulation, solve) | 93 ms |
| 100 iterations without per-iteration flood | 9.3 s |

At 120 iterations with a flood each time: 120 × (93 + 736) ≈ 100 s. Add everything else and the full offline run is about 3 to 4 minutes, well inside "may take minutes". On the wrap: receivers, accumulation and the flood use modular indexing, and sea cells are the flood seeds, so every drainage path ends in the sea or a lake with no domain boundary to leak across.

### 2.3 Hydrology: lakes, rivers, valleys, deltas

**Depressions.** **Barnes, Lehman & Mulla 2014** (*Computers & Geosciences* 62, "Priority-Flood") is the depression-filling algorithm I use, in its epsilon variant, which tilts filled flats so every cell has a strictly descending path. I use it inside the erosion loop (above) and again once at the end. Pseudocode with the determinism fix:

```
heap = min-heap keyed (W, index); closed = bitset
for each sea cell i: push (h[i], i); closed[i]=1
while heap: (k, i) = pop
  for each of 8 neighbours j (torus): if closed[j] continue
     closed[j]=1; W[j] = max(h[j], k + EPS)   # EPS = 1/4096 px
     push (W[j], j)
```

The `(W, index)` key makes ties reproducible. Lakes are connected components with `W - h >= 1.5 px` and at least 24 cells; their surface is `W`. Smaller pits are filled (deposition). Natural depressions only come from the uplift pattern (basins between belts); I do not carve lakes artificially.

**Rivers.** River cells are land cells with drainage area `A >= 64` and not in a lake. Width in px = `1 + 0.45 * (bitlen(A) - 7)` (bitlen via `31 - Math.clz32`), so 64 to 128 cells is 1 px, about 2000 cells is 2.8 px, and the largest river (`A ~ 2^17`) is about 5.5 px. That meets "1 to 3 px wide" for normal rivers and gives the biggest river a river's presence.

- **Vector, not raster.** A raster at 4 px cells cannot hold a 1 px river. The generator emits each river reach as a polyline in 1/4 px fixed-point (i16 deltas) with a width byte and a water level `z` (12 bit). The client rasterises it at 1 px.
- **Meanders.** Reaches with slope below 0.02 px/px get a lateral offset along the path: `offset(s) = amp * noise1D(s / lambda)`, `amp = 1.5 w`, `lambda = 14 w`. The generator, not the client, applies it, so valley and river agree. The floodplain is flattened with a blend toward `z + 0.5` within `3 w + 6` px of the river. That is the "wider valleys lower down".
- **Monotone water.** The water level along each reach is `min(z[k-1], bedHeight[k])`, a running minimum, and then quantised. Test: `z` is non-increasing downstream for every reach, so water never runs uphill after upsampling.
- **Lakes in valleys.** A lake's outflow is the spill cell; the river leaving it begins at the spill height.
- **Deltas and mouths.** For mouths with `A >= 2000`: widen to `2 w` over 12 px (estuary), deposit a shallow fan of radius `0.25 sqrt(A)` px at heights 7.5 to 8.5, and split into 2 or 3 distributaries at ±20° of length 12 to 25 cells, marked as sandbar cover.
- **Every river reaches the sea or a lake.** True by construction because every receiver path ends at a sea cell or inside a lake. I pin this with a test (below).
- **Tiles.** Rivers are stored per tile with an 8 px margin, so each tile's rasterisation is a pure function of the same shared vertices. That gives identical pixels either side of a tile edge.

### 2.4 Coasts

Compute **wave exposure** `E(i)` for water and coast cells. The prevailing wave and wind direction is WSW. Fetch is the open-water run length up to 48 cells along 8 directions, weighted by alignment with WSW; integer arithmetic only. **Concavity** is `boxblur(landmask, r=8) > 0.55` at a water cell. Rules:

- **Sheltered and concave** (low `E`, high concavity): beach. Flatten a 6 px shelf at 8.2 to 9.0 px, cover = sand.
- **Exposed and convex** (high `E`): cliff. Raise the coast to at least 14 to 30 px within 3 cells and set cover = warm rock.
- **Sea stacks.** Poisson-spaced along exposed headlands, 3 to 12 cells out along the outward normal: radius 1 to 2 cells, height 12 to 22 px, plus 1 cell skerries.
- **Shelf.** Seafloor depth is `8 - min(8, 0.55 * d)` where `d` is toroidal chamfer distance from land. The client derives the 4 water depth classes from `8 - h`, so no extra channel is shipped.

Why rules on exposure and concavity rather than "noise coast": real coasts differ because exposure differs, and the owner explicitly wants beaches in bays and cliffs on headlands.

### 2.5 Regions, moisture and biomes

Fields (all macro, integer-friendly): elevation `e`, slope `s`, aspect, distance to water, topographic wetness (`bitlen(A) - bitlen(slope)`), exposure from 2.4, and a **rain-shadow moisture** sweep: moisture advects west to east, gains over water, loses `k * max(0, dh)` when going uphill, wrapped twice around the torus to converge.

**Regions** (4 required plus 2): seaside (sheltered coastal lowland), valley (low land between ridges near rivers), highland (heath and rock above 45 px), exposed coast, farmland (gentle low land with moderate moisture), alpine (above 62 px). Region = argmax of smooth scores, then a 7×7 majority filter. The edges blend at bake time by hashed dither, which gives natural ecotones, not bands.

**Cover classes** (4 bits): 0 sand, 1 shingle, 2 meadow, 3 pasture, 4 tall grass, 5 heath, 6 forest floor, 7 gold field, 8 green field, 9 grey rock, 10 warm rock, 11 scree, 12 snow, 13 fen/mud, 14 road, 15 tilled. Selection is a rule table over `(e, s, moisture, exposure, aspect, region)`. For example snow is `e > 70` or (`e > 55` and slope faces away from the sun). Scree is below cliffs where `s` drops after a steep run. Heath is high and exposed. This is what the owner asked for: cover follows slope, moisture and exposure, not altitude bands.

### 2.6 Scatter

The generator produces only a **forest density** (4 bits) per macro cell: moisture × (1 - slope penalty) × altitude band, boosted within 8 to 20 px of rivers and on lower valley slopes, cut on meadow and field cells. That gives clumping along valleys.

The client places the actual trees at bake time with a **relaxed jittered grid**: a 6 px grid, one candidate per cell, jittered within ±1.5 px of the cell centre, accepted if `hash(x, y, seed) < density(x, y)`. The minimum spacing is therefore 3 px, deterministic and tile-independent. Why not Bridson 2007: Bridson's dart-throwing is sequential and order-dependent, needs global state across tile borders and takes unbounded work near saturation. The jittered grid is a pure function of position and gives the blue-noise-like look at this scale.

- **Species.** Broadleaf on low land, conifer above 45 px or on cold aspects.
- **Stamp.** A tree is a small height bump (3 px wide, +4 to +6 px) added to the height before the column bake, so it depth-tests, shades and casts a shadow for free. Boulders on scree and rock cover use the same stamp at +2 px.
- **Fields and hedgerows.** In farmland, a field id is `floor(warp(x, y) / 48)` with the warp a low-frequency noise. Boundaries between ids get a hedgerow (+2 px dark green line). The id picks gold, green or tilled.
- Tall grass wind is live (section 5).

### 2.7 Roads

Following **Galin et al. 2010** (*Procedural Generation of Roads*, CGF 29(2)), I use least-cost paths over terrain:

```
edges  = MST of sites (toroidal) + 3 extra shortest non-crossing edges
cost   = 1 + 6*slope^2 + 40*[water] + 8*[forest] + 25*[cliff]
         river cell: +30 unless it is a bridge site (then 1)
Dijkstra per edge on the torus, window = bbox + 60 cells wrapped
path -> Chaikin x2 -> cut-and-fill: blend h toward a smoothed path profile over 3 cells
```

Roads ship as polylines like rivers (class byte). Small streams (`w <= 1.5`) are forded: road material crosses with no structure. Bridges only occur at bridge sites, and the road is routed through them. Because the abbey, town and others are MST nodes, every landmark has a road, and the road to the abbey climbs by switchbacks where slope cost forces it.

### 2.8 Outputs of the generator

`heights` (u12), `cover` (u8: class 4 bits, region 4 bits), `fw` (u8: forest density 4 bits, wetness 4 bits), `aux` (u8: flags for road shoulder, field, delta), plus `rivers`, `roads`, `lakes` (as polygon-free: a lake is a height plateau in `heights` with a water-surface level in `lakes.json`), `sites.json` and an overview. All quantised and validated (section 8).

## 3. Data formats and generation location (item 4)

**Generation runs offline and the output is committed.** Reasons: (a) 3 to 4 minutes per run does not belong in every Pages deploy; (b) the committed data is the contract, so a code change that moves a river shows up as a binary diff and a golden hash change; (c) the site build stays a plain static export. CI does not generate. A path-filtered job (only when `src/world/gen/**` changes) regenerates and compares hashes against `golden.json`. The owner's seed is a constant in `world/seed.ts`; a `contact-sheet` script renders 16 candidate seeds as overview PNGs plus stats so the owner can choose.

**Container.** 30 pack files (6 × 5 packs, each 4 × 4 tiles of 64 × 80 macro cells), named `world/p-{px}-{py}.bin`. Why packs and not one file with Range requests: Pages' Range support is not something I can depend on, and 480 tiny files cost 480 requests. Packs are about 75 KB each, small enough to fetch whole.

Per tile, each channel is predicted and deflated:

| channel | encoding | est. bytes / cell |
|---|---|---|
| heights | u12, MED (median-edge) predictor, residual in two planes, deflate-raw | 0.38 (measured) |
| cover | u8, left-delta, deflate | ~0.06 |
| fw | u8, left-delta, deflate | ~0.08 |
| aux | u8 bit-plane, deflate | ~0.02 |
| rivers / roads | i16 delta polylines + width/z bytes, per-tile clipped | ~0.05 |

The height number is **measured**: a 1536² eroded field, 12-bit quantised, MED predicted and deflated came to 892 KB (0.38 B/cell), against 1.54 MB at 16-bit. The other rows are estimates. Totals for 2.46 M cells: heights about 0.93 MB, controls about 0.4 MB, vectors about 0.12 MB, sites and overview about 0.05 MB, so **roughly 1.5 to 2 MB for the whole world.** Decoding: `DecompressionStream('deflate-raw')` (Baseline since 2023), with a ~3 KB inflate fallback in the bundle.

**Budgets (I propose lower ones than the fact sheet).**

- **Before first flight: at most 250 KB.** That is the index, the overview (192×200 macro-8 map, ~30 KB), the sites and one 75 KB pack. The fact sheet's 1.5 MB is not needed.
- **Whole world: at most 3 MB.** The fact sheet's 8 MB is a ceiling that this design stays far below. I keep a test for it (section 9).

**Streaming order.** Pack containing the start site first; then the 8 neighbouring packs in order of distance; thereafter prefetch along the heading, predicted 6 s ahead, one pack ahead. The overview map is the fallback backdrop, drawn as a hazy palette-mapped tile if a tile is not baked yet, so the screen is never blank.

**Runtime bake residency.** Ring of 3×3 tiles around the camera plus 1 tile ahead. Each baked tile is 3 byte-planes × 65 536 = 196 KB. LRU of 30 tiles is 6 MB.

## 4. The tile bake (shared by browser, baker, harness)

A single module `src/world/bake/tile.ts`, pure, runs in a worker and in Node.

**Screen-space tiles.** Tile `(tx, ty)` owns screen pixels `x in [256 tx, +256)`, `row in [256 ty, +256)` (that is exactly 320 world rows × 0.8). A cell at world row `y'` with height `h'` covers screen rows `0.8 y' - h' .. 0.8 y' + 0.8`. So to fill rows `[r0, r1)` we need world rows `[r0/0.8 - 2, r1/0.8 + HMAX/0.8]`, that is **146 rows south, 2 north**. Sun shadows need up to 64 cells north-west. So the **bake window** is the tile plus the 8 neighbours' data (3×3 packs' worth), cropped to `x: -64..+320`, `y: -64..+466`. All coordinates wrap with modular indexing.

**Steps:**

```
1. upsample: Catmull-Rom of macro heights to 1 px (window 384 x 530 = 203k cells)
2. detail:   h += ridged fbm (3 oct, 16/8/4 px) * amp(rock, slope); amp ~ 0.6 px,
             zero on meadow/field/water; periodic hash noise, pure function of world px
3. features: rivers/roads rasterise (carve channel profile, set water level z),
             pads stamp (blend to site z), trees/rocks/hedgerows stamp (+bump)
4. shadows:  diagonal horizon sweep (below)
5. shade:    normal from 3x3 Sobel on fine height; dot with sun (NW, elevation 45 deg) -> 7 steps,
             Bayer 8x8 dither between steps, world-anchored (x mod 8, y mod 8)
6. columns:  painter's order north to south, per cell fill pixels top..ground;
             top pixels: material, shade; wall pixels: face=1, shade-2, vertical hatch every 3rd col
7. ink:      Saito & Takahashi style discontinuity edges (below)
8. crop to the 256x256 tile, pack layers
```

Bake cost. The spike spent about 1.4 s on 1.05 M cells with 6-octave fbm plus a 64-step shadow march per cell. The tile bake has about 203 k cells, 3 octaves, and O(1) shadow per cell, so I expect about 80 to 150 ms in Node and 3× that on a mid-range phone, in a worker. To keep up while boosting (a tile every 2.2 to 4 s), I need only about 0.45 tiles/s. Two workers give 3 to 6 tiles/s on a phone. The task bench pins "Node tile bake ≤ 150 ms median" and the harness logs it per run.

**Seam guarantee.** A pixel is a pure function of its world coordinates, rooted in shipped data. Therefore `bake(tile)` equals the same crop of a bake over any larger window. This is the seam test (section 9), and it also covers the wrap because the window uses modular coordinates.

**Layers per tile.** `A` material (u8: 0 to 3 water depth, 4 to 19 cover classes, 20 to 31 landmark parts); `B` packed (bits 0-2 shade step 0 to 6, bit 3 wall, bit 4 ink, bits 5-7 flow direction for water or tree variant); `C` pixel height `h_p` (u8, 0 to 110). Depth for the dragon test is derived: `n = (h_p + y - HMAX)/0.8 + 0.8 h_p`, the spike's `nb` without storing a float plane.

## 5. Rendering upgrades (item 5)

| feature | where | how | cost |
|---|---|---|---|
| Hillshade from the real surface | baked | Sobel normal on fine height, dot with sun, 7 steps | bake only |
| Cast shadows | baked | diagonal horizon sweep | bake only |
| Dither | baked | Bayer 8×8 between shade steps, world-anchored so it does not swim on scroll | bake only |
| Hatching | baked | 45° lines in deep shadow, vertical on walls, only in `shade <= 1` | bake only |
| Ink | baked | economy rules below | bake only |
| Water depth, foam | baked | depth class from `8 - h`, 2 px foam band at distance < 2, hashed ripple | bake only |
| Palette (time, season, weather) | live | LUT `[material 32][shade 8][heightBucket 4]` of u32, rebuilt on change, lerped slowly | ~0.05 ms rebuild |
| Water glints, river flow | live | sparse hashed sparkles; river stripes use baked flow dir + time | under 0.1 ms |
| Tall-grass wind | live | two-green LUT swap on `tall grass` pixels by `hash(x,y) + t` | under 0.1 ms |
| Cloud shadows | live | scrolling 128² mask, one tint-step lookup | about 0.3 ms mobile |
| Dragon + shadow | live | depth-tested against `n` | about 0.2 ms |

The `heightBucket` index (from layer `C`) gives a **moving snowline** and autumn tint with no rebake, so seasons are LUT work only, as the owner decided.

**Shadow sweep (replaces the spike's 64-step march).** The sun is exactly north-west, so a ray is a world diagonal. The shadow height along each diagonal line is a running value:

```
for each diagonal line (parallel to NW-SE), walking from NW toward SE:
   s = -inf
   for each cell k along the line:
      s = s - 2*sqrt2                        # ray climbs 2 height units per world unit, one step = sqrt2
      shadow[k] = (s > h[k])
      s = max(s, h[k])
```

That is O(n) and exact for this sun, against the spike's O(64 n). A second sun (low sunset) is not needed now. Since it is a bake-only plane, adding one later would need only a different sweep direction (and `B` bit), not a new generator.

**Ink economy.** The owner's rule: height by shading, ink only at real silhouettes. Ink goes at

1. depth jumps `> 3.2 px` (the spike used 2.6, which inked every small step);
2. the top lip of a wall `>= 4 px` tall (creases only for real cliffs);
3. coastlines **only on cliff or stack coasts**, not beaches (beaches get foam);
4. never along river banks (a darker bank pixel instead).

The harness tracks ink coverage per view (target 2 to 7%) so ink stays an accent.

**Frame budget.** The runtime copy is 400 × 225 = 90 k pixels through the LUT. The spike measured about 0.5 ms for compositing plus a 1,500-voxel dragon on an M-series Chrome. I budget 3× for a mid-range phone: copy 1.5 ms, live layers 0.7 ms, dragon 0.6 ms, about 2.8 ms, leaving 1.2 ms of the 4 ms. Tile work is entirely off the frame in workers; only the `postMessage` transfer (zero-copy) lands on the main thread.

## 6. Streaming and frame work, in one loop

```
each frame:
  cam = dragon position (wrapped, unwrapped near camera)
  needed = tiles overlapping viewport (<= 3x2, up to 4x3)
  for t in needed: if baked -> blit rows; else -> haze backdrop from overview
  request bakes for ring + heading prediction (priority by distance at +4 s)
  composite via LUT, add live layers, depth-test dragon
```

Interactive within 2 s on a mid-range phone: bundle plus 75 KB pack plus bake of the 4 tiles around the start in two workers, about 0.8 s. The title menu hides most of this, since the bake starts when The Wayfarer is chosen (or earlier, speculatively, while the menu is shown).

## 7. Landmark siting (item 6)

Per-type scores are macro-grid maps computed after stage 2.5; then non-maximum suppression; then greedy dispersion. 14 sites are reserved.

| type | count | rule (macro-grid score) | pad | approach |
|---|---|---|---|---|
| abbey (first landmark) | 1 | hilltop: local max in 24-cell radius, `h` 25 to 55 px, prominence ≥ 12 px, slope < 0.3, near start | r 14 px, flatten to peak - 1 | road switchbacks via slope cost |
| lighthouse | 2 | headland tip: exposure high, convex, cliff ≥ 18 px, or a sea stack ≥ 14 px | r 5 px | road to the neck of the headland, or none for a stack |
| windmill | 3 | ridge crest: `h` 30 to 60 px, exposure high, cross-ridge curvature, forest density 0 within 20 px, slope < 0.25 | r 8 px | road along the ridge |
| bridge / aqueduct | 2 | river reach where both banks are ≥ 20 px higher within 24 px and width ≤ 40 px (bridge); a wider valley on the MST road (aqueduct) | span axis across valley | MST road passes through |
| ruined cathedral | 2 | valley floor: wide flat (slope < 0.1 in 24 px), 12 to 30 px, ridges ≥ 20 px higher within 60 px, forest on the edges | r 18 px | footpath |
| churchyard yew | 2 | knoll: prominence 4 to 10 px, radius 6 to 12 px, meadow, near a road | r 6 px | road |
| seaside town | 1 to 2 | sheltered bay: low exposure, concave arc ≥ 40 px, flat land 40 × 30 px behind, slope < 0.12, river-mouth bonus | harbour edge + ~40 × 30 flat | main road |

**Selection (deterministic):**

```
for type in [abbey, town, lighthouse, bridge, ruin, windmill, yew]:   # most constrained first
   cand = NMS(score[type], radius 40 cells)
   for c in cand sorted by (-score, index):
      if torusDist(c, every chosen site) < 1100 px: continue          # 800 px between same-type
      accept c until count reached
require: every main island with area > 30 k cells has >= 1 site
require: every river mouth with A >= 4000 has a site within 8 cells of its trunk   # "rivers are roads"
```

If a requirement fails the generator reports which one; the owner changes the seed (the contact sheet shows it).

**Pads.** `sites.json` stores `{id, type, x, y, z, rot, padR, approachAz}`. The pad flatten is a smoothstep blend from `padR` to `padR + 10 px`, and the **same formula** runs in the generator (so roads route to it) and in the tile bake (so the fine height agrees). The abbey is the first site by construction; its pad is near the start.

**Matching projects to sites (build time, committed lock).**

```
assignments.json = { repoId: siteId }  (committed)
build: for each pinned repo in pin order not in assignments:
   affinity(repo.type, site.type): table, e.g. infra->lighthouse, web->windmill, library->bridge
   choose free site maximising affinity*1000 + hash(repoId, siteId) % 1000   # stable tiebreak
   append to assignments
removed repos free their site; existing repos never move
```

The lock file stops a new pin from reshuffling earlier landmarks, and the abbey is reserved for the terminal. Pinning never touches terrain data. Unmatched sites show as ruins of their type or empty pads (an owner question).

## 8. Render-critic harness (item 7)

`src/world/harness/render-views.ts`, run as `node src/world/harness/render-views.ts --out .render/<world-hash>/<look-hash>/`. It loads the committed world, bakes the required tiles with the same `bake/tile.ts`, composes a 400×225 frame with the runtime compositor (no dragon unless asked), and writes PNGs with a 40-line encoder over `node:zlib` (no dependencies). Output per view: native 400×225 and a 3× nearest-neighbour upscale, plus `metrics.json`.

**Viewpoints** (centres come from `sites.json` and named features the generator emits, so they follow the seed):

| id | view |
|---|---|
| V01 | abbey hill and approach road, start area |
| V02 | lighthouse headland, exposed coast |
| V03 | seaside town in its bay |
| V04 | windmill ridge |
| V05 | ruined cathedral in its valley |
| V06 | bridge over a gorge |
| V07 | yew knoll in meadow |
| V08 | river delta and mouth |
| V09 | highland and alpine slopes with snow |
| V10 | lowland meanders and a lake |
| V11 | sea stacks, coves, cliffs |
| V12 | farmland with hedgerows and forest clumps |
| V13 | wrap seam: world corner (0,0) with the screen straddling all four edges |
| V14 | open sea and shallow shelf |
| MAP | whole world at ¼ scale |
| HYD | debug: rivers, lakes and sinks |
| COV | debug: cover class and region colour maps |

Every view renders at noon-summer-clear (primary), dusk and winter-overcast. That is 14 × 3 = 42 frames. Critics see the 14 primary frames, MAP and HYD first; the other conditions run only when the primary pass clears.

**Automated pre-gate (cheap, before any critic call):**

- Seam: V13 equals the same view rendered with coordinates offset by one world period. Pixel difference must be 0.
- Ink coverage between 2% and 7% per view.
- Grid artefact: autocorrelation of the shade plane at axis-aligned lags 32, 64 and 128 px must be no more than 1.25 × the diagonal lags.
- Stair-step: no run of more than 4 equal-height rows with an ink crease in smooth-cover areas.
- River width histogram: 95% of river pixels between 1 and 6 px wide.
- Region distinctness: material histograms of the 4 required regions differ by chi-square above a threshold.

**Rubric** (each 0 to 4, critics must name evidence by pixel box): 1 river and drainage logic; 2 valley and ridge structure; 3 coast variety; 4 cliffs read as cliffs; 5 ground cover follows land; 6 regional distinctness; 7 absence of artefacts (steps, grid, seams); 8 ink economy and line quality; 9 landmark placement believability; 10 palette and Ghibli-summer feel. Output JSON: `{view, scores, defects:[{box, kind, note}], verdict}`. A view passes with every score ≥ 3; the run passes with the minimum over views ≥ 3 and a mean ≥ 3.4. The loop keeps `.render/ledger.md` of look-hash, scores and the one change tried per round, so regressions are visible. Tunable look constants all live in `src/world/look.ts`, which affects the bake and not the generator.

## 9. Task breakdown for cursor-delegate (item 8)

Files are under `src/world/` unless stated. "Seam" is what the test pins. Models: C = `composer-2.5`, G = `grok-4.7-high`, F = Claude (Fable).

| # | task | files | seam (test) | model |
|---|---|---|---|---|
| T0 | RNG, hash, torus grid helpers, SHA stage-hash tool | `rng.ts`, `grid.ts`, `hash.ts` | identical streams for a seed; `idx(x+W)==idx(x)`; stable hash | C |
| T1 | Periodic gradient noise, warp, fbm, ridged | `noise.ts` | `f(x+W)==f(x)` bitwise; range bounds; golden hash | G |
| T2 | Base shape: islands, mask, uplift | `gen/base.ts` | land fraction 0.25 to 0.36; ≥ 6 big components; wrap shift invariance; golden | G |
| T3 | Priority-Flood epsilon + D8 receivers + accumulation | `gen/flood.ts` | no pits after fill (every non-sea cell has a lower neighbour); mass: sum of `A` at sinks = cell count; tie determinism; torus | G |
| T4 | Implicit stream-power erosion + talus + strata | `gen/erosion.ts` | steady state matches an analytic profile on a 1-D test; hashes equal across two runs and a worker; relief percentile = 78 px | G |
| T5 | Rivers, lakes, meanders, deltas, vector emit | `gen/hydro.ts` | every river vertex drains to sea or lake; `z` non-increasing; widths in [1, 6]; lakes ≥ 24 cells | G |
| T6 | Coasts: exposure, beaches, cliffs, stacks | `gen/coast.ts` | exposure symmetry on a mirrored synthetic coast; no beach with cliff height; stacks in bounds | G |
| T7 | Climate: moisture sweep, wetness, region scores | `gen/climate.ts` | moisture wraps; monotone loss uphill on a ramp fixture; region map has ≥ 6 regions and no 1-cell islands | G |
| T8 | Cover classes + forest density | `gen/cover.ts` | rule-table unit tests per class; snow only above threshold or on shade-facing slope | C |
| T9 | Sites: per-type scoring, NMS, dispersion, pads | `gen/sites.ts`, `gen/pads.ts` | min spacing; type counts; pad slope < 0.05 after stamp; river-mouth constraint | G |
| T10 | Roads: toroidal Dijkstra, Chaikin, cut and fill | `gen/roads.ts` | MST connectivity of all sites; road slope ≤ cap; path crosses the wrap correctly | G |
| T11 | Quantise + validate + golden | `gen/finalize.ts` | after u12 quantisation: no new pits beyond declared lakes; rivers still monotone; round-trip max error 1/64 px | G |
| T12 | Codec: MED predictor, deflate, packs, index | `codec.ts`, `pack.ts` | encode then decode is the identity; sizes within budget (whole world ≤ 3 MB, start pack ≤ 250 KB) | C |
| T13 | `scripts/gen-world.ts`, contact sheet | `scripts/gen-world.ts`, `scripts/contact-sheet.ts` | end to end hash equals `golden.json`; runtime ≤ 6 min | C |
| T14 | Tile bake core: upsample, detail, columns | `bake/tile.ts`, `bake/upsample.ts` | tile equals crop of a bigger window; offset by a world period gives identical pixels; Node ≤ 150 ms | G |
| T15 | Shadows (diagonal sweep) and Sobel shade | `bake/shadow.ts`, `bake/shade.ts` | equals a brute-force march on 32² fixtures; tile-edge agreement | G |
| T16 | Rivers, roads, pads, scatter stamps | `bake/features.ts`, `bake/scatter.ts` | spacing ≥ 3 px; tiles agree at edges; scatter is position-pure | G |
| T17 | Ink + hatching + dither passes | `bake/ink.ts`, `bake/hatch.ts` | synthetic height ramps and cliffs: ink only where depth jump > 3.2 px or wall ≥ 4 px | C (rules) |
| T18 | Palette LUT + compositor + dragon depth test | `runtime/compose.ts`, `runtime/lut.ts` | blit equals reference; frame bench ≤ budget on a fixture | G |
| T19 | Streaming scheduler, worker pool, LRU | `runtime/stream.ts` | scheduler order for a scripted flight; never blank; LRU cap holds | C |
| T20 | Matching and lock file | `match.ts` | new pin never moves existing; stable on reorder; abbey reserved | C |
| T21 | Render harness, PNG encoder, metrics | `harness/*.ts` | PNG decodes back to the buffer; metrics on synthetic images; deterministic output hash | C |

Order: T0 → T1 → T2 → T3 → T4 → T5, T6, T7 (parallel) → T8 → T9 → T10 → T11 → T12, T13. Bake track starts after T12: T14 → T15, T16, T17 → T18, T19, T20, T21.

**Stays with Claude (Fable):** pinned test authoring for every task; the look constants (`look.ts`), shade ramps, ink thresholds, palettes and the LUT design; site scoring weights judged on the harness images; region and cover rule tables as looks; seed selection from the contact sheet; critic prompts, rubric and the loop itself; voxel landmark sprites; reviewing every erosion constant (`K0`, `U0`, talus) by eye, because a test cannot see "chopped".

## 10. Risks, open questions, and what I left out (item 9)

**Risks.**

- *Erosion constants (`K0`, `U0`, belts) are the largest tuning risk.* They need real iteration. Mitigation: the contact sheet and the 3 to 4 minute loop; relief is normalised afterwards so only shape, not scale, is at stake.
- *Cliffs at 4 px macro cells can be too soft.* Mitigation: strata benching, coast steepening and fine-scale ridged detail; if still soft, a per-pixel "cliff sharpen" in the bake (a nonlinear slope boost) is cheap to add.
- *Phone bake cost is estimated, not measured.* Mitigation: the Node bench plus a browser bench before T19 closes; fallback is bake-on-ship for the start area only.
- *Hash drift across Node versions.* Mitigation: pin Node in CI; golden hashes per stage show where it moved.
- *River vector and heightfield disagreement at tile edges.* Mitigation: clipped-with-margin vectors and the crop-equality test.

**Questions for the owner.**

1. Is 6144×6400 with about 14 sites right, or should the world feel smaller and denser?
2. Should boost be a shortcut (as proposed, 16 to 27 s between landmarks) or should it also be gated by the dragon's stamina?
3. What should an unmatched site show: an empty pad, or a ruin of its type?
4. Is the ink-light palette from the fact sheet (Ghibli colour, Witch Hat line) confirmed? Ink economy numbers assume yes.
5. Seed: pick from the 16-seed contact sheet?

**Left out on purpose.**

- Glacial erosion (Cordonnier 2023): U-shaped valleys are the one thing it gives, and widening valley floors in highlands via `K` gets most of the look at no new solver.
- Plate tectonics and the Schott 2023 interactive uplift authoring; our painted uplift map covers what we need, one-shot.
- Droplet hydraulic erosion, wind erosion and vegetation ecosystem simulation.
- A second low-sun shadow bake (the sweep makes it cheap, but it is not needed yet).
- WebGL, 1 px hydrology, and Tonal Art Maps (Praun 2001) for hatching; two hatch densities are enough at 400×225.
- Blue-noise dither (Ulichney 1993, void-and-cluster): Bayer 8×8 gives the pixel-art look and needs no table. It is an easy later swap in `bake/shade.ts`.

## 11. Paper check

Searched and confirmed to exist: Braun & Willett 2013 (*Geomorphology* 180-181:170-179); Cordonnier et al. 2016 (*CGF* 35(2):165-175); Schott et al. 2023 (*ACM TOG*, 10.1145/3592787); Timonen & Westerholm 2010 (*CGF* 29(2):723-731). I use the first two directly. Schott is read only as a pointer to "uplift domain authoring", and Timonen as background for the horizon idea, which our exact diagonal sweep makes unnecessary. I did not re-fetch Barnes 2014, Galin 2010, Musgrave 1989, Beyer 2015, Bridson 2007, Saito & Takahashi 1990, Praun 2001, Ulichney 1993 or Max 1988. I cite them from memory for the ideas named above, and none of the numbers here depends on their text.
