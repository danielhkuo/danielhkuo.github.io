# Terrain proposal P2: art first (Opus)

The question behind this proposal: what makes a European-Ghibli landscape read beautifully when one world cell is one screen pixel, in lush colour with ink kept to silhouettes, cliffs and coasts? Each engineering choice is argued from that. All numbers are defaults for the tuning bench.

## 0. Key choices

- **World and projection.** 4,096² cells on a torus: four main islands plus islets, about 45% land, no vertical exaggeration. KY moves from 0.8 to **0.75**, so the screen wraps on an exact row (§2).
- **Shape.** Implicit stream-power erosion runs on a **jittered 1,024² graph**, with per-region diffusion setting valley spacing. A **cubic B-spline** upsample removes the solver's lattice. Cliffs, stacks, coves, pads, terraces and river channels are **explicit stamps**.
- **Cover and scatter.** Cover comes from shared rules keyed on **HAND** (height above nearest drainage). Trees and rocks come from a blue-noise mask and are **stamped into height and material**.
- **Shipping.** The world ships as recipe-level data: about **0.9 MB gzip for the whole world**, loaded behind the title menu, with no terrain streaming. Workers bake world-space cell tiles, then screen-space pixel tiles.
- **Light byte.** One byte per pixel holds tone, shadow depth and ink state. The palette decides what shadows and ink look like, so time, season and weather never touch the bake.
- **First minute.** It follows the home river from the sea to the abbey.

## 1. What reads at one cell per pixel

I ran throwaway experiments in Node 26 on an M5 Max. The renders are in the session scratchpad, `…/scratchpad/terrain-exp/`: `view4.png` to `view8.png`, and `crop_grid.png` against `crop_jit.png`. Each rule below comes from what they showed.

1. **Big simple forms, crisp small things.** Valleys narrower than about 16 px read as texture noise. Valleys should sit 40–250 px apart. Fine detail belongs to discrete objects (trees, rocks, sheep, roofs), not the heightfield. This is how Ghibli backgrounds work too: soft masses, with sharp detail only at focal points.
2. **Never shade the solver's lattice.** Shading a field with 4 cells per node directly gave diagonal stripes on every slope. A blur of σ ≈ 2 cells removed them. A cubic B-spline does exactly this in one pass: its kernel σ is about 0.58 node, or 2.3 cells.
3. **Most slopes stay under 37°.** With KY = 0.75, a south-facing slope steeper than 0.75 grows wall pixels, and a north-facing one hides itself.
   - My first eroded field was too steep. Almost all of it rendered as rock and comb-like walls.
   - Hillslope diffusion fixed it.
   - Walls and silhouettes should be rare, so that they mean something.
4. **Ink and hatching only where the form breaks.** Hatching every wall pixel striped whole mountains. So hatch only cliffs (slope above 2.0, about 63°), and ink only depth jumps of 4 rows or more.
5. **Draw lines in screen space.**
   - With KY = 0.75, a quarter of world rows own no screen row, so a 1-cell east–west river vanishes every fourth row.
   - Rivers made of D8 cells stair-step at 45°.
   - So rivers, roads, hedges and walls are smoothed polylines, drawn onto visible ground pixels.
6. **Make trees wider than they are tall.** Crowns taller than they were wide read as capsules. Broadleaf crowns get 0.6 × diameter of height, conifers 1.5 ×.
7. **Interpolation must not overshoot at the coast.** Bicubic ringing made a fringe of 1-cell islets, each with an ink ring. The B-spline's non-negative weights prevent it, and a minimum island area of 24 cells removes what remains.

## 2. Scale and pacing

| Quantity | Value | Why |
|---|---|---|
| World | 4,096² cells, torus | Pacing (below); power of two, so wrap is `& 4095` |
| Projection | screenY = worldY·0.75 − h | 4,096 × 0.75 = 3,072 = 12 × 256, so the screen wraps on an integer row and tiles align; 0.8 gives 3,276.8. Fallback: keep 0.8 with N = 4,000 and 250-cell tiles |
| Horizontal | 1 cell = 1 px ≈ 10 m | the torus is 41 km, like a cluster of Hebridean islands |
| Vertical | 1 height unit = 1 cell (VE 1.0) | true slopes, so walls only above about 37°; at VE 1.25, mid slopes turned into walls |
| Heights | sea 0, land 0–90, trees +3 to +8, landmarks to +45, HMAX 110 | peaks: highland 90, valley 55, town hills 45, coast 35, lowland 25 |
| Seabed | 0 to −24 | sets colour only; water is drawn flat |
| Height storage | u16 at 1/16 px on the 1,024² graph | normals come from the smooth upsample |
| Terraces | none in nature | only as man-made stamps: vineyard terraces (2 px), quarry benches (4 px, inked), lynchets (1 px) |

**Pacing.**

- Seven landmarks share 16.8 M cells, 2.4 M each. Hexagonal spacing is √(2.4 M/0.866) ≈ 1,665 cells.
- That gap takes 28 s straight at 60 cells/s, 15 s boosted, and 36–42 s following a river (sinuosity 1.3–1.5). A 3,072² world would give 21 s straight, which is too short.
- A landmark stays on screen 5–7 s, since the viewport shows 400 cells by 300 rows.
- **Minor beats** come every 300–600 cells, or 5–10 s. About 45 sit on land (hamlet, waterfall, bridge, tarn, wayside cross, sheepfold) and 20 at sea (wreck, stack, boats), by Poisson disk at 400 cells.
- Sea channels 150–400 cells wide give 3–7 s breathers.

## 3. Generation pipeline

`scripts/world/bake.ts` runs offline, caching each stage to `.cache/world/<seed>/<stage>.bin`, so tuning a late stage never reruns erosion.

| # | Stage | Algorithm | Output |
|---|---|---|---|
| S1 | Province plan | 4 island centres on a jittered 2×2 lattice (±300 cells), each split into 1–2 typed provinces; constraints: town bay faces east, exposed coast faces west | province map; U, K, D and rain per province |
| S2 | Land shape | Union of warped ellipses (radius 600–900) plus periodic fBm; warp 250; threshold set for 45% land; islets from fBm peaks | uplift U |
| S3 | Erosion | Implicit stream power (m 0.5, n 1) plus implicit diffusion, jittered graph, Priority-Flood routing | heights at 1,024² |
| S4 | Glacial proxy | U-valley reprofile, cirques, a ribbon lake (highland only) | heights |
| S5 | Hydrology | Priority-Flood, receivers, area, HAND, channels | flow, HAND, lakes |
| S6 | Rivers | Chaikin smoothing, sine-generated meanders, widths, levels, floodplains, oxbows, falls | polylines, stamps |
| S7 | Coasts | Fetch exposure, coast class, stamps, bathymetry | stamps, seabed |
| S8 | Climate | Orographic rain, moisture, exposure | 512² fields |
| S9 | Sites | Search, rank, pads | sites, pad stamps |
| S10 | Roads | Hamlets; least-cost roads (Galin et al. 2010); bridges | polylines |
| S11 | Fields | Warped Voronoi parcels, crops, hedges and walls | parcels, lines |
| S12 | Encode | MED predictor, byte planes, gzip, manifest | `public/world/<id>/` |

Cover and scatter are not baked. They are pure functions in `src/world/cover.ts` and `scatter.ts`, called by offline siting and by the browser's tile baker.

### Shape and erosion (S2–S4)

**Noise.** Periodic gradient noise, using a fixed table of 32 literal unit gradients and integer lattice periods that divide the domain. It tiles exactly and makes no runtime trig calls. Value noise is out: the spike showed its grid rectangles.

**Why a jittered graph.** On a plain grid, receivers drew 45° streaks across ridges and kinked rivers (`crop_grid.png`). Offsetting each node by a fixed ±0.4 node, and measuring neighbour distances from those positions, removed them (`crop_jit.png`). It keeps grid indexing and trivial wrap. A Delaunay mesh (mapgen4; Cordonnier et al. 2016) is slightly more isotropic but costs triangulation and point location.

**Why 1,024².** The solver's finest valley is 2–3 nodes wide. At 4 cells per node, that is 8–12 px after smoothing: the finest valley pixels can show. A full-resolution solve would add only gullies that read as noise, at 16× the cost.

```
per iteration (indices & 1023; base level = sea nodes):
  fill   = priorityFlood(h)                          // Barnes 2014, +ε
  rec[i] = argmax_j (fill[i]-fill[j]) / dist(i,j)    // 8 jittered neighbours
  order  = BFS from base over donors;  A = accumulate in reverse order
  for i in order: F = K[i]·dt·sqrt(A[i]) / dist(i,rec[i])   // m = 0.5, so sqrt is exact
                  h[i] = (fill[i] + dt·U[i] + F·h[rec[i]]) / (1 + F)
  h = diffuseImplicit(h, D[i]·dt)                    // explicit diffusion rang near its limit
stop when max|Δh| < 0.1% of relief, or after 300 iterations
```

**Measured cost.** 135 ms per iteration at 1,024², of which Priority-Flood takes 70 ms. So 250 iterations take about 35 s. The O(n) router of Cordonnier, Bovy & Braun (2019) would halve that, but it is not needed offline.

**Per-region parameters.** Relief scales with U/K. Valley spacing scales with (D/K)^(1/(2m+1)) (Perron et al. 2009). A 256² pre-run calibrates them by measuring spacing (from the ridge-field FFT) and peaks per province.

| Province | U | K× | Valley spacing | Peak | Character |
|---|---|---|---|---|---|
| Highland | 1.0 | 0.7 | 40–60 | 90 | sharp ridges, cirques |
| Valley country | 0.55 | 1.0 | 70–110 | 55 | rounded hills, V-valleys, moor tops |
| Lowland | 0.2 | 1.3 | 150–250 | 25 | swells, broad floodplains |
| Exposed coast | 0.45 to the shore | 0.6 | 60–90 | 35 | relief at the sea, so cliffs |
| Town hills | 0.4 | 1.0 | 60–80 | 45 | an amphitheatre behind the bay |

**Glacial proxy (highland only).** Channels with A > 8·A_c and floors above 35 px get a parabolic U section, half-width 8–16. Valley heads above 60 px facing N to E (as real northern cirques do) get a bowl of radius 15–30 with a 10–20 px headwall and a tarn. One 150–300-cell reach is overdeepened 6–10 px into a ribbon lake. That buys what glacial simulation (Cordonnier et al. 2023) would show at this scale, far more cheaply.

### Hydrology and rivers (S5–S6)

**Lakes and drainage.** Priority-Flood (Barnes et al. 2014) on the final heights turns each depression's spill level into a lake surface. Every channel therefore ends at the sea or a lake. The channel threshold is A_c ≈ 20,000 cells² (about 2 km²). HAND follows Rennó et al. (2008).

**Width** follows hydraulic geometry, w ∝ √Q (Leopold & Maddock 1953): **w_px = clamp(round(√(A/A_c)), 1, 6)**, so 1 px at A_c, 2 px at 4·A_c, 6 px at the largest mouths. Estuaries widen 1.5–3× over their last 40–80 cells.

**Meanders.** Two Chaikin passes smooth the path. Reaches with slope under 1% and w ≥ 2 then become **sine-generated curves** (Langbein & Leopold 1966), θ(s) = θ_valley(s) + ω·sin(2πs/λ_s).

- Sinuosity is 1/J₀(ω), checked numerically: 1.24 at ω = 0.9, 1.49 at 1.2, 1.95 at 1.5. Use ω = 0.6 for 1 px streams and 1.2 for big lowland rivers.
- Valley wavelength λ_v = max(16, 10·w); measured meanders run about 7–12 widths (Leopold & Wolman 1957, 1960).
- The belt is 0.48·λ_v at ω = 1.2. A floodplain 1.5 belts wide is flattened to water level + 1 px. On w ≥ 3, one loop in five stays as an oxbow with reeds.
- These curves look like real meanders and don't self-intersect at these ω; sinusoidal offsets look like worms.

**Levels and channels.** Water level is the running minimum of smoothed terrain minus 1 px, so it never rises downstream. Channels are carved 1 + 0.5·w px deep. A reach dropping more than 0.3 per cell gets a **waterfall** step of 4–12 px with a plunge pool; streams meeting cliff coasts fall onto the beach.

### Coasts (S7)

In an archipelago, the coast is most of what you see.

- **Exposure X** comes from fetch: march upwind for up to 600 cells, weighting the westerly (260° ± 30°) at 60% and other directions at 40%.
- **Coast class.**

  | Class | Condition |
  |---|---|
  | Cliff | X·hardness > 0.35 and the land rises 6 px within 12 cells |
  | Beach | X < 0.4 and the coastal slope is under 0.15 |
  | Rocky shore | everything else |

- **Cliff stamp:** move the shore 2–6 cells inland and hold the top at the height 8 cells inland, so a wall drops to the sea, with a 1–3-cell wave-cut platform.
- **Stacks:** 1–4 on convex cliff headlands, 4–14 cells offshore, radius 1.5–4, 0.6–1.0 of cliff height, turf on top.
- **Coves:** where a channel meets a cliff coast, a semicircle of radius 8–20 with a pocket beach and turquoise water (the Adriatic look).
- **Beaches** 2–10 cells wide, dune grass behind those over 6. **Mouths** get sand bars; a delta (2–4 distributaries, marsh islands) only where X < 0.15 and w ≥ 4.
- **Bathymetry:** depth 0.08·distance on beach coasts, 0.4·distance on cliff coasts, capped at 24.

### Roads, settlements, fields (S10–S11)

**Hamlets and farms.** Hamlets of 3–8 houses sit at crossings and junctions. Farmsteads appear about every 300 cells of farmland.

**Roads** join hamlets, the town and **every reserved site**, so pinning never changes them: a minimum spanning tree plus 20% extra edges. Each edge is a Galin-style least-cost path with cost = length·(1 + 40·s²), infinite above a 12% grade (which makes switchbacks). Water crossings cost 50, allowed only where w ≤ 4, and each records a bridge. A 16-direction neighbourhood with a curvature penalty prevents 45° zigzags.

**Fields** are the strongest "lived-in Europe" signal from above.

- **Parcels:** Voronoi cells of Poisson points 28–56 cells apart (smaller near hamlets), in a space warped by 6 cells, cut by rivers and roads.
- **Crops** by region: pasture 45%, hay 20%, wheat 12%, barley 8%, fallow 7%, orchard 4%, plus vineyard terraces on the town's south slopes. Each is a palette row, so it recolours with the season. Tone +1 on every third cell along the long axis gives mown stripes.
- **Boundaries:** lowland hedges in 1 px dark green; upland drystone walls in 1 px pale grey with a 1 px SE shadow. Both are drawn in screen space.

## 4. Regions, ground cover and scatter

| Region | Reads as | Accent | Signature features |
|---|---|---|---|
| Highland | alpine meadows and lakes | snow-blue | cirques, a ribbon lake, conifer belts, scree fans, snow on ledges but not on cliffs |
| Valley country | Welsh valleys | heather-purple, slate | hanging oak woods, a slate-roofed row village on the floor, an inked quarry, moor tops |
| Lowland | farm country | wheat-gold | hedged patchwork, meanders with oxbows, copses, hamlets |
| Exposed coast | Atlantic and Adriatic headlands | limestone-white, turquoise | cliffs, stacks, coves, heath with pink thrift, wind-bent thorns |
| Town bay | Adriatic seaside town | terracotta | red roofs on terraces, cypress and stone pine, vineyards, a harbour mole |
| Islets | skerries | foam white | stacks, surf rings, a stack-top lighthouse site |

Province edges blend over 100–200 cells, and the rules read soft region weights.

**Cover rules.**

- The rules run in order, and the first match wins.
- Inputs:
  - e: elevation in px;
  - s: slope;
  - north: northness;
  - M: moisture, from orographic rain, log A and low HAND;
  - X: exposure;
  - HAND;
  - region weights.
- Each threshold gets blue-noise jitter across its edge width, so every boundary between covers is a speckled band rather than a contour line.

| Cover | Rule | Edge width (cells) |
|---|---|---|
| snow | e > 74 − 10·north and s < 1.1; cliffs shed snow, so dark rock shows | 2 |
| rock | s > 1.7 or e > 86 | 3 |
| scree | 0.6 < s < 1.2 with rock within 30 cells upslope | 6 |
| alpine meadow | highland, e > 55, s < 0.5 | 10 |
| heath, heather | X > 0.55, or HAND > 30 in valley country | 12 |
| forest | 2 < HAND < 30, 0.08 < s < 0.8, M > 0.4, X < 0.5, below treeline (60 highland, 50 elsewhere) | per tree |
| fields | lowland or valley floor, s < 0.14, HAND < 25, within 250 road-cost cells of a settlement | parcel edge |
| wet meadow, reeds | HAND < 1, s < 0.02 | 4 |
| meadow, pasture | otherwise; dry variant where M < 0.3 | 8 |

**HAND is the main art lever.** On its own it gives meadows on valley floors, woods on the lower sides and heath on the tops: the British upland valley look. Each big cover also gets three hue variants, chosen by 200-cell periodic noise and blended with blue noise over 8–16 cells. The result is the slow colour bloom of a painted wash, not a flat fill.

**Scatter mechanism.** A void-and-cluster 128² blue-noise mask (Ulichney 1993) is read at `(x + offset_c) & 127`. Category c places an instance where `BN < ρ_c(cell)`. Since 128 divides 4,096, the mask wraps.

**Why not Bridson.** This beats Bridson's Poisson disks (2007) for three reasons:

- it is per-cell and periodic, with no instance lists and no tile seams;
- it adapts to density;
- low densities come out spaced like blue noise.

Species, size and colour come from a world-position hash, and each category uses two mask offsets to hide the 128-cell period.

| Category | ρmax | Shape stamped into height and material |
|---|---|---|
| broadleaf | 0.20 in forest, 0.02 in pasture | crown radius 1.5–3, height 0.6·diameter + 1.5; 3 colour variants |
| conifer | 0.22 | radius 1–2, cone 1.5·diameter |
| cypress, stone pine | town only | a 1×5 column; an umbrella of radius 2.5 |
| wind-bent thorn | 0.03 on the exposed coast | radius 1–1.5, crown 1 cell to the lee (east) |
| hedgerow tree | 1 per 15–40 cells of hedge | broadleaf |
| boulder | 0.04 on scree and moor | radius 0.7–1.5, height 1–2 |
| flowers | ≤ 0.03 | 1 px speckles with no height: alpine, thrift, poppies at wheat edges, buttercups |

**Stamped scatter.** Because trees and rocks are stamped into the cell layers, each crown gets its own highlight and shade from its normal. It casts a real shadow, takes forest-edge ink and depth-tests against the dragon. In the experiments, forest masses read as overlapping crowns (`view8.png`).

**Clearings.** No trees within w/2 + 2 cells of a river or 1.5 cells of a road. Real canopies open over streams, and a 1 px river under trees would vanish.

**Life (live sprites).**

- Sheep in flocks of 5–15, one flock per 300² cells of pasture: 2×1 px white with a 1 px shadow.
- Cows in the lowland.
- Boats at the town and river mouths.
- Gulls at the coast.

## 5. Colour

**Ramps.**

- Each material has a 16-tone ramp, interpolated in **OKLab** from deep shade (tone 0) through base (tone 9) to lit (tone 15).
- OKLab keeps the mid-tones saturated, where RGB mixing goes muddy.
- Hue shifts 25–40° toward blue in shade and 10–20° toward yellow in light, so shadows stay coloured and never go grey.

Summer daylight anchors, as used in the experiments:

| Material | shade / base / lit |
|---|---|
| meadow | `#2f6a4f` `#74b552` `#c4e27a` |
| pasture | `#2d6447` `#62a24a` `#a2cf63` |
| hay | `#6b6a3f` `#c2b46a` `#ecdf9c` |
| heather (Aug–Sep) | `#4f3e5c` `#8e6a8a` `#c49ab5` |
| broadleaf | `#123c3a` `#2f6e45` `#8fbf55` |
| conifer | `#0f2f34` `#24533f` `#5d8f58` |
| granite, slate | `#474c63` `#9a9488` `#e2dac6` |
| limestone | `#6a7088` `#cfcabb` `#fbf6e8` |
| snow | `#8fa3c8` `#e3ebf2` `#ffffff` |
| sand | `#a8936a` `#e6d199` `#f9efcf` |
| wheat | `#8a6f2a` `#e0c25a` `#f6e39a` |
| river | `#3b7fa5` `#5fb2cf` `#9fe0ea` |
| sea, shallow to abyss | `#86d9cf` `#4fb7bf` `#317fa6` `#2a5d8a` `#1d3f66` |
| terracotta | `#7e3424` `#c0533a` `#e07f5c` |
| ink | `#2e2a24` warm sepia; soft ink is a 55% mix |

**Rules.**

- **Three value groups per frame:**
  - light: meadow, sand, snow, foam;
  - mid: lit canopy, rock;
  - dark: forest shade, deep sea, ink.
- Rivers are at least 15 L* lighter than any vegetation they cross, in every palette.
- Vermilion and gold are reserved for the dragon and landmarks. Terrain reds are only roofs and poppies.
- Pure white is for small highlights only.
- Following Imhof, contrast grows with height (tone offset × (0.7 + 0.5·e/90)): peaks are crisp and lowlands soft.

## 6. Water

Water needs no hillshade, so its 4 tone bits hold something else: shore distance at sea, flow phase in rivers.

| Water | Baked | Live |
|---|---|---|
| sea | 5 depth bands dithered over 3–6 cells; turquoise shelves on beach coasts; dark water under cliffs | glints; surf lines rolling shoreward, lit where (t·k − shoreDist) mod 6 < 1 |
| surf | a 1–2 px foam ring at cliff feet and stacks | two-phase flicker |
| rivers | screen-space polyline of width w; flow direction in 3 bits | bright streaks move downstream: (s − t·v) mod 7 = 0 |
| lakes | flat, with a sky-tinted ramp; reeds at the margins | sparse glints, mirror-calm |
| falls | wall pixels of material `falls`, phase = row; a foam pool | streaks scroll down at 30 px/s |
| wake | none | a V of foam from a ring buffer, on water pixels only |

Rivers get no ink: ink on both banks would turn a 1 px river into 3 px of dark. Lakes get soft ink only where the bank is at least 2 px high.

## 7. Landmark sites and their settings

**Reservation.**

- The generator reserves 1 abbey, 1 town and 2–3 ranked sites of every other type.
- Sites of any type stay at least 900 cells apart.
- The rank-1 sites of all seven types form a tour with nearest-neighbour gaps of 1,200–2,000 cells.
- Each pad is stamped flat to ±0.5 px and blended over 10 cells.

| Landmark | Terrain test | Pad | Approach | Staging |
|---|---|---|---|---|
| Abbey (first) | Valley country beside lowland. A spur 25–45 px above a river, inside a meander if possible (Durham-style). Crown slope < 0.12 over 30×24. The **home river** reaches a sheltered beach mouth within 1,500–2,400 channel cells | 30×24 | switchback road, ≤ 12% grade, from a riverside hamlet with a stone bridge | orchards and a walled garden on the south slope, woods on the north, fields along the river |
| Lighthouse | Exposed coast. ≥ 220° of open sea within 40 cells, cliff ≥ 12 px, X > 0.6. Or a stack with a top of radius ≥ 4 | r 6 | cliff-top path from a road ≤ 400 cells away; a stack has no path (dragon only) | heath with thrift, thorns, a surf ring, perhaps a wreck |
| Windmill | Ridge crest: negative cross-ridge curvature, along-ridge slope < 0.08, 20–45 px, nothing higher within 300 cells upwind | r 6 | farm track up the ridge | wheat and barley below (the mill grinds them), hedges, sheep |
| Bridge, aqueduct | A road crosses a river with w ≥ 2. Gorge variant: both banks ≥ 15 px within 10 cells (tall arches, span 12–30). Otherwise a low multi-arch bridge | two abutments level within ±2 px | the road | a weir or mill upstream, a hamlet |
| Ruined cathedral | Valley floor (HAND < 4, s < 0.05) at least 60 wide, hills ≥ 25 px on both sides within 250, river 30–80 cells away | 34×16, nave E–W ±15° (churches face east) | lane, then a ford | grass in the nave, yews and a birch, sheep, wooded valley sides |
| Churchyard yew | Isolated knoll: prominence 6–15 px, radius 15–40, nothing higher within 120 | r 10 | lane through a lychgate | walled oval churchyard, a chapel, the darkest and largest crown in the world (r 5), fields all round |
| Seaside town | Sheltered bay: concave, opening 40–120°, X < 0.3, facing E or SE. Beach ≥ 30 cells, hillside rising 25–50 px within 120, a stream entering | about 160×120; street terraces every 8–12 cells (2–3 px steps); harbour mole | coast road and the stream valley | red roofs, white walls, cypress, vineyard terraces, boats, the clock tower by the harbour |

**Missing site types.** A seed lacking a type may get one small edit (a 10 px knoll, or a gorge from two wall stamps); anything bigger rejects it. `scripts/world/seeds.ts` sweeps seeds at 256² (about 5 s each) into a contact sheet of overview maps with site scores, for the owner to choose from.

**Matching projects to sites.**

- A repo's type comes from `src/world/landmarks.config.ts`, or else a stable name hash over unused types.
- Sites have fixed ranks within a type. Projects, in pin order, take the best free site of their type, so a pin change moves only that type's landmarks. Rank 1 guarantees pacing; rank 2 is used only when two projects share a type.
- Unclaimed sites stay landscape, still reached by roads. The town always exists; its clock tower is the landmark if claimed.

## 8. The first minute

New visitors spawn 250 cells offshore from the home river's mouth, heading north, 50 px up. The river is the tutorial: rivers are roads. From mouth to abbey is about 2,000–2,400 cells of river, or about 40 s.

| t (s) | On screen | It teaches |
|---|---|---|
| 0–4 | ink-wash reveal from the title page; dithered sea; a stack with surf; gulls | the world is painted and alive |
| 4–10 | the coast enters at the top: a sheltered beach, turquoise shelf, sand bar, 5 px estuary, red-roofed quay | coasts vary; water leads inland |
| 10–22 | water meadows, hedged patchwork, sheep, an oxbow, a stone bridge; **wind ripples cross the hay**; a wake on the river | skim the river |
| 22–32 | the valley narrows: hanging woods, a 3 px river in a canopy gap, a weir, a sweeping cloud shadow | height and enclosure |
| 32–40 | the abbey hill rises at the top of the screen with an inked silhouette, rose-window glint and switchback road; the river bends round the spur | landmarks sit believably |
| 40–50 | approach, coil, land; the Artificer opens | landing opens entries |

The abbey test in §7 guarantees this route exists. Returning visitors use Continue.

## 9. Rendering upgrades

The bake happens in two levels, in workers.

1. **Cell tiles.** 256² world cells, with margins of 64 cells north and 16 elsewhere, cached. Each one gets:
   - the B-spline upsample;
   - stamps;
   - cover;
   - scatter stamps;
   - normals and tone;
   - the cast-shadow march;
   - valley darkening.
2. **Pixel tiles.** 256 × 192 px each, 16 × 12 of them on the wrap. Each one gets:
   - a painter's pass over the cell tiles beneath it, reaching up to 147 rows further south;
   - screen-space lines (rivers, roads, hedges, walls), depth-tested so they never draw over a ridge;
   - ink and hatching.

**Per-pixel layout.**

| Field | Type | Contents |
|---|---|---|
| `mat` | u8 | material |
| `light` | u8 | tone (4 bits), shadow depth (2 bits), ink state (2 bits: none, hatch, soft, full) |
| `depth` | u16 | n = worldY + 0.75·h in 1/8 units, tile-relative |

That is 192 KB per tile, so a 24-tile LRU cache holds 4.7 MB.

**Measured.** My throwaway renderer did 347k cells (upsample, smoothing, cover, trees, shading, a 90-step shadow march, painter, ink) in 150–190 ms on the M5 Max. So an optimised cell tile (about 100k cells) should take about 60 ms there and about 300 ms on a mid-range phone, assumed 5× slower. The spawn view needs about 12 cell tiles: about 1.8 s with 2 workers, while the title menu is up. A pixel tile costs 20–40 ms.

**Shading (baked).**

- t = 9 + 14·(n·L − L_z)·k(e) − 2·valley, where valley = clamp((blur64(h) − h)/8, 0, 1).
- Then blue-noise dither to 16 tones. The dither reads as paper grain and kills Mach bands. Bayer dither added visible 45° texture.

**Cast shadows (baked).**

- March toward the NW sun, 0.7071 cells per step, with the ray climbing 1.5 per cell (elevation 56°). A 40 px ridge throws a 27-cell shadow.
- The occlusion depth (1, 2, or 3 or more) fills the two shadow bits, which gives a dithered penumbra.
- The dragon's shadow offset becomes 0.7071/1.5 = 0.471 cells per height unit on each axis, replacing 0.354.
- Tiles bake per visit, so a visit that starts at golden hour can bake with a climb of 0.6. That replaces the optional second bake. The NW azimuth also matches a summer evening at 52°N.
- If those low-sun marches prove slow, horizon methods (Max 1988; Timonen & Westerholm 2010) are the fallback.

**Ink (baked, screen space).** This is the G-buffer edge idea of Saito & Takahashi (1990).

- **Silhouette:** a depth jump of 4 rows or more gives soft ink, 12 or more gives full ink, on the nearer pixel.
  - Canopy against canopy gets no ink.
  - Canopy against ground does, so forests get a south-edge outline.
- **Cliff lip:** full ink above a wall run of at least 4 px on a cell with s > 2.0.
- **Coast:** full ink on cliffs, soft ink on beaches.
- **Never:** hedges, roads, rivers or fields.

**Hatching (cliffs only).** Wall pixels of cells with s > 2.0 get vertical strokes from nested masks, after the nesting property of tonal art maps (Praun et al. 2001):

- tone 10 or above: none;
- tone 6–9: x mod 4 = 0;
- tone below 6: x mod 2 = 0.

Strokes break where blue noise is above 0.8.

**Palette.**

- Index = `mat·256 + light`, giving a table of 48 × 256 u32 (48 KB).
- It is rebuilt only when time, season or weather changes, in about 2 ms.
- What each state does to the shadow bits and tones:
  - **Sun:** shadow depth 3 is three tones darker and cooler.
  - **Overcast:** shadows are dropped and contrast is compressed to 0.6.
  - **Dusk:** warm light and violet shadows.
  - **Night:** window materials glow.

**Live, per frame.** The core is `out = PAL[(mat<<8) | light]`, plus:

- **Cloud shadows:** `light |= 2<<4` wherever a scrolling, tileable 256² cumulus field (cells 150–400 wide) passes its threshold.
- **Wind:** wind materials (meadow, hay, cereals, heather) gain +1 or +2 tone where an eastward gust field (25 cells/s) exceeds 0.72 or 0.85. These are the pale undersides of grass blades turning over.
- **Water:** see §6.
- **Then:** the dragon, its shadow, its wake and the life sprites.

| Per frame, mid-range phone (estimate) | ms |
|---|---|
| composite, 90k px, with cloud and wind | 1.3–1.8 |
| water live | 0.3 |
| dragon and shadow | 0.6–1.0 |
| wake and life | 0.2 |
| **total** (budget 4) | **2.4–3.3** |

## 10. Data formats and where generation runs

**Ship recipes, not pixels.** The heightfield's useful information sits at node resolution. Everything finer comes from stamps, rules and scatter. I measured it on the eroded 1,024² test field: heights at 1/16 px, encoded as MED residuals split into byte planes, come to **419 KB gzip** (371 KB brotli). That is the whole world's height.

| File in `public/world/<worldId>/` | Contents | gzip |
|---|---|---|
| `manifest.json` | id, seed, generator version, N, KY, VE, sun, layer hashes, regions, sites | 5 KB |
| `height.bin.gz` | 1,024² u16 at 1/16 px: MED, zigzag, byte planes | 420 KB, measured |
| `fields.bin.gz` | moisture, exposure, HAND and coast class at 512² u8; region weights at 256² × 6 | 150–250 KB, estimated |
| `vectors.bin.gz` | rivers (¼-cell int16 deltas, width, level), lakes, roads, hedges, parcels, stamps, sites, minor beats | 150–250 KB, estimated |
| `bluenoise.bin` | 128² u8 | 16 KB |
| **total** | | **0.75–0.95 MB** |

**Decoding.** A worker decodes with the native `DecompressionStream('gzip')`, so no brotli decoder ships. GitHub Pages will not set `Content-Encoding` on `.bin` files.

**Loading.**

- The whole world loads behind the title menu, which leaves room in the 1.5 MB first-flight budget for about 150 KB of sprites.
- Terrain needs no proximity streaming. The 8 MB ceiling stays as headroom, for example a 2,048² height layer (+1.4 MB) if critics want it crisper.
- **Bake order:** tiles under the camera first, then a ring scored by distance − 0.5·(heading alignment). Use 2 workers when `hardwareConcurrency ≥ 4`.

**Generate locally and commit the assets** (about 1 MB per accepted world). Three reasons:

1. **The land is content.** The owner approves each change, picked from a seed contact sheet.
2. **A CI rebuild can drift.** If V8's math functions change in the last bit, a Priority-Flood tie flips, which moves a river, which moves a site.
3. **CI stays fast.**

CI still regenerates a fixed 256² mini-world and compares its hash, which catches nondeterminism in our own code. World code also avoids `sin`, `cos`, `exp` and `pow` wherever they feed discrete decisions: gradients come from literal tables, and m = 0.5 uses `sqrt`.

## 11. Wrapping

| Stage | How it stays seamless |
|---|---|
| noise and warp | integer lattice periods that divide the domain; the warp field is periodic too |
| graph, erosion, flood, flow | indices `& 1023`; jitter stored per node; no boundary, since base level is the sea |
| distances, fetch, HAND | minimum-image toroidal distance; marches wrap |
| upsample, blur, shadows | wrapped reads |
| vectors | stored unwrapped; each segment registered in every tile its wrapped bounding box touches; drawn shifted by multiples of N |
| cover, scatter | functions of `(x & 4095, y & 4095)`; the 128 mask period divides 4,096 |
| screen tiles | 16 × 12 tiles; the screen wraps at exactly 4,096 × 3,072 |
| live fields | 256² tiling textures, sampled `& 255` |

Tests check three things:

- a view at (x, y) equals the view at (x + N, y + N), byte for byte;
- cell-tile margins equal their neighbours' interiors;
- a pixel tile baked alone equals the same region cut from a one-shot bake.

## 12. The render-critic harness

`scripts/world/critic.ts --world <id> --run <name>` runs the browser's own baker and compositor in Node. It writes to `out/critic/<run>/`:

- each view at 400×225, plus a ×3 nearest-neighbour copy;
- a contact sheet;
- a 1,024² overview with regions, rivers and sites;
- diagnostic layers (HAND, cover, ink);
- `metrics.json`.

**Viewpoints (28).**

| Views | What they show |
|---|---|
| V01–V06 | first-minute frames at t = 0, 8, 16, 24, 32, 40 s |
| V07–V20 | each rank-1 landmark site: approach (site in the upper third, 250 cells south), then landing |
| V21–V26 | one per region: snowline and tarn; valley woods and village; meanders and fields; cliffs and stacks; town bay; islets |
| V27 | the wrap corner and a tile corner, each compared against a reference |
| V28 | V16 at dusk, at night, overcast, and in spring, autumn and winter |

**Automatic gates.** Any failure blocks the run.

| Gate | Pass condition |
|---|---|
| seams | identical pixels |
| ink coverage | 1.5–6% of land pixels |
| hatch coverage | ≤ 4% |
| rivers | each visible river raster is 8-connected and ≥ 1 px wide |
| grid detector | FFT power on axis-aligned frequencies of the tone image ≤ 1.5 × the median at other angles |
| stair detector | no ink on steps under 4 px |
| tone clipping | under 5% of pixels at tone 0 or 15 |

**Rubric**, each scored 0–4 against anchors:

1. **Water shaped the land:** valleys, branching drainage, wide lowland floors.
2. **Silhouette economy:** ink only at form breaks, weighted by the drop.
3. **Value structure:** three masses when you squint.
4. **Colour:** lush, coloured shadows, no mud, the region's accent present.
5. **Texture:** scatter reads as objects; meadows stay calm.
6. **Water:** 1 px rivers legible, varied coasts, glowing shallows.
7. **Region identity:** nameable from one frame.
8. **Landmark staging:** believable pad, approach and framing.
9. **Liveliness:** wind, surf and life, from 3-frame strips.
10. **Painted from a real place.**

Each critic returns its scores, its 3 worst problems with pixel coordinates, and one parameter change each. Runs are compared to catch regressions.

## 13. Task breakdown for cursor-delegate

Models: C = composer-2.5, G = grok-4.7-high.

| # | Task | Files | Test seam | Model |
|---|---|---|---|---|
| 1 | RNG, hash, torus | `src/world/rng.ts`, `torus.ts` | sequence determinism; wrap; minimum-image distance | C |
| 2 | Periodic noise, fBm, warp | `noise.ts` | f(x+P) = f(x) exactly; gradient-angle histogram flat within 5% | G |
| 3 | Province plan, land shape | `plan.ts` | land 45 ± 3%; 4 islands; constraints; periodic | G |
| 4 | Jittered graph, Priority-Flood | `graph.ts`, `flood.ts` | no pits after filling; filled ≥ original | G |
| 5 | Stream power and diffusion | `erode.ts` | all nodes drain to sea; U = 0 never raises h; translating input translates output; determinism | G |
| 6 | Flow, HAND, channels | `flow.ts` | area sums to land area; channels end at sea or lake; HAND ≥ 0 | G |
| 7 | Rivers | `rivers.ts` | sinuosity within 2% of 1/J₀(ω); level never rises downstream; mouth at sea; no self-intersection | G |
| 8 | Glacial proxy, lakes | `glacial.ts`, `lakes.ts` | highland only; one outlet per lake; no undeclared pits | G |
| 9 | Coasts | `coast.ts` | fetch rotates with the wind; stacks 4–14 offshore; islets ≥ 24 cells | G |
| 10 | B-spline upsample, stamps | `upsample.ts`, `stamps.ts` | output within the min and max of its node patch; tile edges agree; pads flat to ±0.5 | G |
| 11 | Climate fields | `climate.ts` | windward rain > leeward; periodic | C |
| 12 | Sites and matching | `sites.ts`, `match.ts`, `landmarks.config.ts` | every type present; spacing ≥ 900; abbey home-river test; a pin change moves only its type | G |
| 13 | Roads, hamlets, bridges | `roads.ts`, `settle.ts` | all sites connected; grade ≤ 12%; a bridge at every crossing | G |
| 14 | Fields | `fields.ts` | no gaps in farmland; boundaries never cross rivers | G |
| 15 | Blue-noise mask | `bluenoise.ts`, `public/world/bluenoise.bin` | toroidal; low radial power below 0.25 cycles per cell; each rank used once | G |
| 16 | Cover and scatter mechanics | `cover.ts`, `scatter.ts` | pure and periodic; rule order; riparian clearance | C |
| 17 | Codec, bake CLI, seed sweep | `encode.ts`, `scripts/world/bake.ts`, `seeds.ts` | round-trip exact; ≤ 1 MB; manifest hashes | C |
| 18 | Cell-tile bake | `bake/cellTile.ts`, `shadow.ts` | neighbour margins agree; ≤ 80 ms per tile in the Node bench | G |
| 19 | Pixel-tile bake | `bake/pixelTile.ts`, `ink.ts`, `lines.ts` | wrap and tile seams identical; river connectivity; ink-coverage gate | G |
| 20 | Palette, compositor, live layers | `render/palette.ts`, `composite.ts`, `live.ts` | restyling never touches the bake; ≤ 1 ms per frame in the bench | G |
| 21 | Tile cache and scheduler | `stream.ts` | priority order; LRU bound; cancellation | C |
| 22 | Critic CLI, PNG writer | `scripts/world/critic.ts`, `png.ts` | PNG decodes; byte-identical across runs; metrics present | C |

All `src/world/` paths are relative to that folder unless shown in full.

**Claude (Fable) keeps these:**

- palette anchors and the season, time and weather transforms;
- cover thresholds and edge widths;
- the shapes of trees, rocks and flowers;
- ink and hatch thresholds;
- region accents and the look of cliffs, coves, terraces and the town;
- the minor-beat library;
- landmark staging;
- golden-path tuning;
- critic runs and choosing a seed with the owner.

## 14. Risks, open questions, left out

**Risks**

1. **Phone bake time.** The 300 ms per tile is an estimate, scaled from desktop. Fixes, if needed: 2 workers, cell-tile caching, smaller margins, or pre-baked spawn tiles (about 150 KB).
2. **Generic erosion.** Fern-like relief everywhere. Per-region U, K and D, stamps and accents counter it, and the region-identity score watches for it.
3. **Over-smoothing.** It could soften crisp features, which is why cliffs, gorges, stacks and pads are stamps.
4. **Visible 128-period repetition in scatter.** Check the autocorrelation; if it shows, move to a 256² mask (64 KB).
5. **Seeds missing a site type.** The sweep, rejection and small stamp edits cover this.

**Open questions for the owner**

1. KY 0.75 instead of 0.8, so the wrap is exact? The fallback is N = 4,000 with 250-cell tiles.
2. Should the season move the snowline and the cover (winter snow down to 40 px)? It is free, since tiles bake per visit.
3. Should new visitors start offshore and follow the river to the abbey, or start at the abbey?
4. Should landmark types be set per repo in config, or by hash?
5. Is life welcome (sheep, cows, boats, gulls)? And industrial Welsh touches (a quarry, conifer plantations)?
6. Should unclaimed sites stay empty landscape?

**Left out on purpose**

- **Glacial simulation** (Cordonnier et al. 2023): stamps give the same pixels.
- **Hydrology-first terrain** (Génevaux et al. 2013): it gives strong network control, but its relief looks less eroded. The golden-path test and the seed sweep give enough control.
- **Droplet and thermal erosion** (Beyer 2015; Musgrave et al. 1989): their 1–3-cell gullies and talus are below what reads. Scree is a cover rule plus boulders.
- **Interactive authoring** (Schott et al. 2023): nobody hand-sculpts this world.
- **Irregular meshes** (mapgen4; Cordonnier et al. 2016): see §3.
- **Also left out:** per-visitor terrain, tectonics beyond uplift maps, and vegetation simulation.

## References (each checked; what I take is cited where used)

- Barnes, Lehman & Mulla 2014, *Computers & Geosciences* 62 (Priority-Flood).
- Braun & Willett 2013, *Geomorphology* 180–181 (implicit stream power).
- Cordonnier, Bovy & Braun 2019, *Earth Surface Dynamics* 7:549 (O(n) depression routing, in reserve).
- Cordonnier et al. 2016, CGF 35(2) (uplift-driven relief).
- Galin, Peytavie, Maréchal & Guérin 2010, CGF 29(2):429 (roads).
- Imhof, *Cartographic Relief Presentation*, 1965; English 1982.
- Langbein & Leopold 1966, USGS PP 422-H (sine-generated meanders; 1/J₀ is my own numeric check).
- Leopold & Maddock 1953, USGS PP 252; Leopold & Wolman 1957 (PP 282-B) and 1960 (GSA Bulletin 71).
- Perron, Kirchner & Dietrich 2009, *Nature* 460:502 (valley spacing).
- Praun et al. 2001, SIGGRAPH (tonal art maps).
- Rennó et al. 2008, *Remote Sensing of Environment* 112(9) (HAND).
- Saito & Takahashi 1990, SIGGRAPH (G-buffer ink).
- Ulichney 1993, SPIE 1913 (void-and-cluster).
- Ottosson 2020, OKLab (a blog post).
- Weighed but not used: Cordonnier et al. 2023; Génevaux et al. 2013; Bridson 2007; Max 1988; Timonen & Westerholm 2010.
