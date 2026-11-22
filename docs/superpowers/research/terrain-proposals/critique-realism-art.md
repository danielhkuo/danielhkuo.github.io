# Critique: realism and art

Lens: will the land look like a real European place painted the Ghibli way, and will it read at one cell per pixel through the spike's camera (north-up, `screenY = 0.8·worldY − h`, no rotation)? I hunted for the failures the owner has already seen or would hate: stair-steps, grid rectangles, blobs with no drainage, hard colour bands, sameness, seams, rivers too thin to read, ink on every small step, landmarks in unbelievable places, and anything pagan or derivative.

Proposals: P1 (Fable, geomorphology), P2 (Opus, art), P3 (Sonnet, engineering).

## Verdict in brief

- **Take P1's land and P2's paint.** P1 builds geography that has a cause: fold-belt grain, rock stripes, an early stop that leaves moors, coasts cut by exposure on hard rock, waterfalls where hard rock meets soft. P2 knows what reads at one pixel: rivers drawn in screen space, a B-spline upsample, wide tree crowns, hatching on cliffs only, region accents, and staging around each landmark.
- **P3 would bring back the owner's complaints.** Its Bayer dither, jittered-grid forests, warped-grid fields, altitude-bucket colours, hatching on every wall and blob islands would each reproduce the spike's chopped look. Keep its determinism, seam and packaging work, which is the best of the three.
- **All three miss what the fixed camera does to the land.** What a ridge hides stays hidden forever, only south-facing walls have any width on screen, and the depth-jump ink rule they all inherit from the spike smears ink over every north-facing slope steeper than about 27°. I measured each of these (section 1). They are the top risks (section 7).

## 1. What I measured

These are throwaway Node 26 scripts in the session scratchpad. They may be cleared, but the numbers are recorded here:
`/private/tmp/claude-501/-Users-dkuo--claude-spares-spare-KxETbM/8a62374f-c95d-474a-8282-9354d5309fb1/scratchpad/critic-ra/`

**Test land.** A 512² torus eroded by implicit stream power, with a Priority-Flood every step, for 400 steps. I cropped 160² nodes, upsampled them ×4 with a cubic B-spline to 640² cells, and scaled the peak to 50, 90 or 160. I drew the result with the spike's column painter (`topY = floor(baseY − h)`, `faceBot = floor(baseY + KY − h)`). This land is steeper than the proposals intend (median slope 0.59 with a 90 peak), so treat the occlusion figures as upper bounds. The trends are what matter.

| Test | Result |
|---|---|
| Depth jump between vertically adjacent pixels on a smooth north-facing plane | The jumps come in steps of 1.64: 0.84, 2.48, 4.12, 5.76 and so on. Some rows jump 4.12 at slope 0.3, half of them at 0.4, and every row at 0.5 or steeper. So P1's threshold of 3.5, P3's 3.2 and P2's soft-ink 4.0 all ink every row of a north-facing slope steeper than about 0.5 (27°). The three thresholds behave identically. |
| The same rule on the test land with a 50 peak, where nothing is occluded (the steepest slope is 0.67) | 4.6 % of land pixels inked at a threshold of 3.5. Every one is a false silhouette. |
| The same with a 90 peak | Depth jumps ink 6.4 % of land pixels, as smears 3–8 px thick with a stippled fringe (`r_ink35_ky0.8_h90.png`). An occlusion test inks 1.6 %, as clean 1 px ridge lines (`r_occ_ky0.8_h90.png`). It inks when at least 3 world rows are hidden between the two pixels and the drop is at least 3. |
| Land occluded by terrain (hidden by more than 1 px) | Peak 50: 0 %. Peak 90: 4.3 % of land and 1.7 % of channel cells. Peak 160: 40 % of land, 72 % of channel cells and 67 % of river cells. |
| Wall pixels under the spike's face rule | None on south-facing planes up to slope 1.0. 12 % of land pixels with a 90 peak, 27 % with a 160 peak. |
| Near-flat land cells that own no screen pixel | 19 % at KY 0.8, 25 % at KY 0.75. |
| A 1-cell river rasterised in world cells, 4° off east–west | 23 % of its cells vanish. 91 of 400 screen columns show no river, in 39 separate gaps (`moire_bayer_world.png`). |
| Bayer 8×8 dither anchored to world cells, then projected | Strong moiré swirls that follow the height field (same image). |
| Raising sea level after erosion by 2, 4, 6 or 10 % of relief | Coast length per √(land area) goes from 18.2 to 21.2, 22.5, 23.9 or 25.4. Valley mouths become inlets and spurs become headlands (`drown0.png` against `drown6.png`). |
| P2's palette anchors, CIELAB L* | River base 68.6. Meadow base 67.6, pasture 60.7, hay 73.0, wheat 79.1, lit meadow 85.8. |
| P2's sine-generated meanders | Confirmed: sinuosity 1.24, 1.49 and 1.95 at ω = 0.9, 1.2 and 1.5, and a belt of 0.48·λ_v at ω = 1.2. |
| P3's noise-offset meanders (amplitude 1.5w, wavelength 14w) | Sinuosity 1.006 at every width, with a mean offset under one river width. In effect they are straight. |
| Channel spacing (land area ÷ channel cells) | About 23 nodes at A ≥ 64 nodes. P3's threshold of A ≥ 64 macro cells therefore gives a stream every 90 px or so, which is fine. |

**Analytic checks.**

- Catmull-Rom's negative lobe reaches −0.074 at t = 1/3, so it overshoots a step by 7.4 %. A cubic B-spline never overshoots.
- Jittering a 6 px grid by ±1.5 px keeps sinc²(π/2) = 0.41 of a perfect lattice's Bragg peak. The rows and columns stay visible.

## 2. P1: terrain from process (Fable)

### Strengths

- **The land has grain.** S1 gives each island an archetype, a fold-belt spine along one strike, and erodibility in stripes. That yields trellis drainage, hard-rock headlands and soft-rock bays. It is the only plan with geological structure, and the main cure for sameness.
- **It stops early (S2).** Stopping at 70–80 % of steady state leaves relict plateaus for the moor, the windmill ridge and the alpine meadow. Calm flat tops are what make a painted landscape restful.
- **Its processes are physical.** Scree comes from a debris layer, so it sits under cliffs because rock fell there (S4). Cliff height comes from retreat to a wave-cut platform (S5), and waterfalls fall at hard/soft rock contacts (S6.7). Rain switches to orographic halfway through erosion.
- **Its coast exposure suits the camera, perhaps by luck.** S5.1 weights the south-west double. Exposed cliffs therefore land on SW-facing shores, which the camera sees.
- **It makes no colour from altitude bands** (S7). Thresholds get noise, a majority filter and a minimum patch size, and cover is upsampled with blue-noise jitter (§5.1 step 1). The relief term, an unsharp mask on height (§5.1 step 2), makes drainage readable from above.
- **Wrap is exact.** The integer-matrix octaves and the choice of N keep KY = 0.8. It has an ink budget (3–7 %), sticky site assignment and the best seam views.

### Serious flaws

1. **Peaks of 160 hide the highland's rivers and drown the viewport in walls** (§1.2, S1 table). A 160 px peak fills 71 % of a 225 px screen. On my test land, a 160 peak hid 72 % of channel cells and made 27 % of land pixels walls. A 90 peak hid 1.7 % of channels and made 12 % walls. The Lake country (120) and Mining valleys (90) are steep too. "Rivers are roads" fails exactly where the drama is. Cap the land at about 100 and add a visibility gate (section 7).
2. **One-pixel streams are rasterised in world cells** (§5.1 step 1, "Rasterise rivers, lakes and roads from vectors"). One flat row in five owns no screen row, so a 1 px stream running east–west breaks into dashes. That is 23 % of its cells and 39 gaps across one screen in my test. Most of the network by length is 1 px (Q from 600 to about 2,500). Draw lines in bake-pixel space, as P2 does.
3. **The silhouette rule smears or misses** (§5.1 step 5). A depth jump over 3.5 inks every row of a north-facing slope steeper than 0.5 (section 1). The extra condition "the occluding wall is ≥ 3 px" might suppress that. But a rounded ridge occludes with its top face, not a wall, so the same condition would also drop real hill silhouettes. Either way the result is wrong. Use an occlusion test instead.
4. **Hatching in every cast shadow** (§5.1 step 6). Trees cast shadows (S8), so every wood becomes a field of hatch flecks. That is "ink on every small step" in another form. Hatch cliffs and deep terrain shadow only.
5. **Flat poster colour, the same in every region** (§5.1 step 4). Five surface tones, dithered only near the thresholds, will draw tone contours on big smooth hills. No material varies in hue, so a pasture is the same green on the Home island and in Lake country. The regions differ in landform but not in paint.
6. **Catmull-Rom everywhere** (S2 "upsample bicubic", §5.1 step 1). It overshoots by up to 7.4 %. P2 measured the result: a fringe of 1-cell islets, each with an ink ring. Use a B-spline.
7. **The town rule cannot be met** (§6 against S5). The town needs water at least 3 deep within 25 cells of shore, with E ≤ 0.25. S5.5's bathymetry gives 0.12 × 25 × (0.6 + 0.8 × 0.25) = 2.4 at most, and the beach shelf (S5.3) raises it to 1.0. No sheltered bay passes. The fix is a dredged harbour or a mole stamp at siting time.
8. **The shadow sweep is off by √2** (§5.1 step 3). `v ← h[t] + 2·t` climbs 2 per diagonal step, which is √2 cells. That puts the sun at 54.7°, not the 63° used for Lambert shading and for the dragon's 0.354 offset. Baked shadows would come out 41 % longer than the dragon's. Use 2√2 per step, as P3 does.
9. **Coastlines are smooth sausages** (S1). The coast is the edge of the uplift footprint around each spine. S5 only cuts it back, so bays come only from soft-rock stripes. There are no drowned valleys, the rias that make Atlantic and Adriatic coasts (section 7.5).
10. **Tarns face north** (S3, "face north or north-east"). From the south, a north-facing cirque floor sits behind its own headwall and the ridge above it.
11. **Incision at 2 cells per node makes busy hillsides** (S2, 40 steps on G2 after 6 % noise). Valleys 2–3 nodes wide are 4–6 cells, under the 16 px that P2 found reads as landform. The relief term (r = 6) sharpens exactly that band. Let G2 sharpen G1's valleys, not cut new ones.
12. **Every wall shows earth** (§5.1 step 7, "a 1 px turf lip, then earth or rock below"). Steep grass at slope 1–2 would show bands of earth. Show earth or rock only on cliffs and scree.
13. **The aqueduct carries no water** (§6 Bridge). An aqueduct over a road gorge, fed by nothing, is unbelievable (section 7.6).

## 3. P2: art first (Opus)

### Strengths

- **The pixel-scale rules are measured, and right** (§1). Big simple forms with crisp small objects. Valleys under 16 px read as noise. Lines go in screen space. Crowns are wider than tall. Nothing overshoots at the coast.
- **Its upsample removes the lattice** (§3). A cubic B-spline (σ = 0.577 node, which I confirmed) and a jittered solver graph remove the 45° streaks. My test render, without the jitter, still shows straight D8 facets on ridges, so the jitter matters.
- **Rivers can be read** (§3, §6). Width is √(A/A_c), clamped to 1–6 px. Meanders are sine-generated with ω set by river size, and P2's numbers check out. Rivers are drawn in screen space and gated on 8-connectivity. Waterfalls get plunge pools. Rivers get no ink.
- **Regions read as places** (§4). Provinces are typed and blended over 100–200 cells. Each has a colour accent (heather purple, wheat gold, limestone white, terracotta) and signature features. Valley spacing is calibrated per province (Perron et al. 2009).
- **Cover follows HAND** (height above nearest drainage). That alone gives meadow on the floor, wood on the sides and heath on the tops. Each rule has its own edge width, and each cover has three hue variants blended over 8–16 cells. This is the best answer to hard colour bands.
- **The painting rules are right** (§5, §9). Ramps are interpolated in OKLab, with shade shifted toward blue. There are three value groups, and vermilion and gold are reserved for the dragon and landmarks. Flat ground sits at the base tone. Contrast grows with height, after Imhof. Hatching goes on cliffs only (s > 2), and canopy never inks against canopy.
- **The landmark staging is believable** (§7). A Durham-style abbey on a meander spur, with a switchback road from a riverside hamlet. A cathedral nave aligned east–west. A walled churchyard with a lychgate. A town amphitheatre of terraces. A windmill above the wheat it grinds.
- **The first minute is choreographed** (§8). It flies south to north toward the camera's far side, so the abbey rises at the top of the screen. That is the one place any proposal plans around the camera.
- **The critic gates are the most useful** (§12). An FFT grid detector, a stair detector, ink and hatch coverage, tone clipping, river connectivity, and three-frame strips to judge liveliness.

### Serious flaws

1. **It changes the camera the owner already decided** (§0, §2: KY 0.8 to 0.75). The change is unnecessary: any N that is a multiple of 1280 wraps exactly at 0.8, for example 5120 or 6400. It also makes rows drop out more often: 25 % of flat rows own no pixel at 0.75, against 19 % at 0.8.
2. **It faces its showpieces away from the camera.** S1 says "exposed coast faces west". §3 Coasts weights the westerly (260° ± 30°) and §7 has the town bay "facing E or SE". In this projection, a wall facing west or east has no width on screen. A north–south cliff draws as one ink line between sea and cliff top, so the Atlantic cliffs vanish. A town climbing an east-facing slope is seen side-on, so its terraces read as flat strips of roof. Put cliffs on S to SW shores, and put the town on a slope that faces south, above a bay opening S to SE.
3. **Rivers fail P2's own contrast rule** (§5: "at least 15 L* lighter than any vegetation they cross"). By its own anchors the river base is 68.6, the meadow base 67.6, hay 73.0 and wheat 79.1. A 1 px river through hay is darker than the hay, and through meadow it differs only in hue. Lift the river ramp, or give rivers a 1 px lit edge.
4. **Tone is dithered per cell and then projected** (§9 cell tiles, "normals and tone"). One flat row in four is dropped, and south slopes repeat rows. Blue noise survives this better than Bayer, but it still stripes along contours. Dither per bake pixel.
5. **Soft ink at a 4-row jump smears north slopes** (§9 Ink). Jumps reach 4.12 on slopes of 0.3–0.5, so every north-facing slope from about 25° up to the occlusion angle gets soft ink. The 1.5–6 % ink gate will not catch it: my 50-peak test inked 4.6 % of land pixels, inside the gate, and every one was false.
6. **Trees on the south bank hide east–west rivers** (§4 Clearings: no trees within w/2 + 2 cells). A tree 5 px tall hides 6 cells of land north of it, so the "3 px river in a canopy gap" of §8 disappears under the gap's southern edge. The rule also strips the tree lines that mark rivers in European farmland. Make clearance asymmetric (section 7.7).
7. **The jitter and the upsample disagree** (§3). Heights are solved at jittered positions (±0.4 node, ±1.6 cells) but upsampled as if they sat on the lattice, while river vectors come from the jittered graph. Carving (S6) can then cut the channel up to 1.6 cells off the rendered valley floor. That leaves a notch in one valley wall and a dry groove beside it. Vectorise rivers at lattice positions, or carve before the upsample.
8. **The coast is a noise threshold** (S2). Warped ellipses plus fBm, thresholded at 45 % land, give blob outlines. Coves appear only where a channel meets a cliff. There are no drowned valleys.
9. **Pacing falls under the floor** (§2). Seven landmarks are 1,665 cells apart: 28 s of straight flight, and 21 s with twelve. The minor beats make it feel fuller, but the bar is 30–60 s.
10. **Cirques face N to E** (§3 Glacial). The north-facing ones hide their tarns behind the headwall, as in P1.
11. **The aqueduct carries no water** (§7). Same as P1.

## 4. P3: engineering (Sonnet)

### Strengths

- **Determinism is done properly** (§2.0). A list of banned calls, `(key, index)` tie-breaks, a single thread, stage hashes, and a CI matrix across macOS arm64 and Linux x64.
- **Every pixel is a pure function of world position and shipped data** (§4). Crop equality therefore covers tile seams and the wrap. The 6144 × 6400 world wraps on whole rows (6400 × 0.8 = 5120) without touching the camera.
- **Look changes never re-run generation** (§0.4). This is the right split for the critic loop. The harness also keeps a ledger (§8).
- **Some judgements are good.** Ink on coasts only where there are cliffs, and foam on beaches. Fords across small streams. Every big river leads to a site (§7). The stream density works out about right (section 1).

### Fatal or serious flaws

1. **Bayer dither anchored to world cells** (§4 step 5; §10 leaves out blue noise). The projection turns it into moiré swirls that follow the height field (`moire_bayer_world.png`). That is the grid pattern the owner rejected, in a new form. **Fatal** unless swapped for blue noise per bake pixel.
2. **Forests on a lattice** (§2.6: a 6 px grid jittered ±1.5 px). This keeps 41 % of a perfect lattice's Bragg peak, so dense woods show rows and columns: a plantation, not a wood. Each tree is a bump 3 px wide and 4–6 px tall, a 2:1 capsule on screen, which is the shape P2 found reads badly.
3. **Fields as a bent chessboard** (§2.6, `floor(warp(x, y) / 48)`). Low-frequency warp leaves the field pattern as a deformed square grid of 48 px. Real field systems are irregular polygons that follow streams, roads and contours.
4. **Colour in hard bands by altitude** (§5 LUT `[material][shade][heightBucket 4]`). Four height buckets per material change colour along contour lines, the exact complaint in section 4 of the fact sheet. §2.5 adds more altitude rules: snow above 70, conifers above 45 px, highland above 45 and alpine above 62.
5. **Hatching on every wall pixel** (§4 step 6, "vertical hatch every 3rd col"). That is 12 % of land pixels on my 90-peak test, and P2 measured mountains striped by the same rule.
6. **Coasts are raised after hydrology** (§2.4: "Raise the coast to at least 14 to 30 px within 3 cells", which runs after §2.3). This builds a rim around every exposed coast. It makes pits behind the rim (T11's no-new-pits check would fail), slot gorges at river mouths, and levees that look like dams. Real cliffs form by retreat, not uplift.
7. **No lakes are guaranteed** (§2.3, "I do not carve lakes artificially"). Stream power near steady state, with an outlet that keeps incising, leaves almost no closed basins. The bar asks for lakes in natural depressions.
8. **Regions are local classes, not places** (§2.5). "Valley" is every valley and "highland" every patch above 45 px. Six islands come from one recipe (§2.1). That is sameness by construction.
9. **The islands are blobs** (§2.1). They are warped radial falloffs, with nothing to give them grain or indented coasts.
10. **The meanders are straight** (§2.3). A noise offset of 1.5w at a wavelength of 14w gives a sinuosity of 1.006 (section 1). The lowland rivers will read as canals.
11. **One-pixel rivers are rasterised into the fine heightfield** (§4 step 3). They break into dashes, as in P1.
12. **The silhouette threshold of 3.2** (§5 Ink) smears north slopes, as in P1.
13. **The town is a flat 40 × 30 px pad** (§7). That cannot make a red-roofed town climbing a hill above a harbour. The churchyard yew is a bare knoll, with no wall ring and no chapel reserved.
14. **The sun disagrees with itself** (§4): shading uses a 45° sun, shadows a 63° sun.
15. **Smaller gaps.**
    - Cover lives on 4 px macro cells, and the upsample is unspecified (§2.8). Nearest-neighbour would give 4 × 4 blocks.
    - Strata benching with `tri(h / 3)` (§2.2) follows contours, so steep hard-rock slopes become terraces. Real bedding dips.
    - The shelf `8 − min(8, 0.55·d)` (§2.4) gives every coast the same 15-cell halo of shallow water.

## 5. Scores

On a scale of 1 to 5, where 5 is best. For risk, 5 means safest, with the look and the build both counted.

| | P1 | P2 | P3 |
|---|---|---|---|
| Realism | 4 | 4 | 2 |
| Art fit at pixel scale | 3 | 4 | 2 |
| Seams and wrap | 5 | 4 | 5 |
| Budgets | 3 | 4 | 4 |
| Determinism | 5 | 3 | 5 |
| Testability | 4 | 5 | 4 |
| Risk | 3 | 3 | 2 |

- **P1.** The best physical land. Its art rules have gaps, and at 160 relief it hides its own rivers.
- **P2.** The best pixel-scale craft. It points its cliffs and town away from the camera, changes a decided camera parameter, and has the weakest determinism.
- **P3.** The safest engineering and the riskiest look. Its testability lacks look gates for hatching and tone.

## 6. Per-stage picks

| Stage | Winner | Graft from the others |
|---|---|---|
| **Scale and projection** | P1's rule: keep KY 0.8 and choose N as a multiple of 1280. Use **6400²** (rows wrap at 5120 = 20 × 256), not 7680². At 6400², seven landmarks are 43 s apart and twelve are 33 s. | P2's relief: peaks of about 90–110, so that slopes stay under 0.8 away from cliffs. P2's minor beats every 5–10 s. |
| **Base shape and uplift** | P1: island cores, fold-belt spines along one strike, rock stripes, an archetype quota. | P2's per-province U, K and D calibrated to valley spacing, and its region accents. Rewrite P2's orientation rules for the camera. Add drowning (section 7.5). |
| **Erosion** | P2's solver: jittered graph, implicit diffusion, D per province. | P1's coarse-to-fine schedule, its stop at 70–80 % of steady state, and its switch to orographic rain. P3's `(height, index)` tie-breaks. Fix the jitter/upsample mismatch. |
| **Glacial forms and lakes** | P1: 3–6 ribbon lakes, tarns, moraine dams. | P2's U section on large channels and its cirque headwalls. Face the cirques E to SE, not N, so their tarns can be seen. |
| **Rivers** | P2: width √(A/A_c) from 1 to 6, sine-generated meanders with ω by size, screen-space polylines, waterfalls with pools. | P1's discharge from rain, waterfalls at rock contacts, valley floors that widen downstream, and the river graph for navigation. P3's fords. Clearance asymmetric by bank. Put waterfalls only on reaches that flow south. |
| **Coasts** | P1: fetch times rock, retreat to a wave-cut platform, cliff height equal to land height, SW-weighted wind. | P2's stacks on convex headlands, coves where channels meet cliffs, dune grass, and bathymetry by coast class. Add drowned valleys. |
| **Regions and climate** | P2: typed provinces with blended weights and colour accents. | P1's archetype per island. P3's chi-square gate on region distinctness. |
| **Ground cover** | P2: HAND-led rules, an edge width per rule, three hue variants per cover. | P1's debris-layer scree, majority filter, minimum patch size and snow rank, plus broadleaf split from conifer for autumn. |
| **Scatter and fields** | P2: crowns stamped into height and material, wider than tall, from a blue-noise mask. Fields as warped Voronoi parcels with hedges and walls. | P1's ranked Poisson points (either mechanism works), its parcels laid along the contour, and lynchets near the town. Reject P3's jittered grid and grid fields. |
| **Landmark sites** | P2's staging table. | P1's sticky, maximin assignment. P3's most-constrained-first order and its failure reports. Add visibility and orientation rules. Give the aqueduct water or call it a viaduct. Fix P1's harbour depth. |
| **Roads** | P2: a minimum spanning tree plus 20 % extra edges reaching every reserved site, a 12 % grade (which makes switchbacks), 16 directions, hamlets at junctions. | P1's bridges chosen after routing. P3's fords. Run the switchbacks up south-facing flanks where possible, so they can be seen. |
| **Upsample** | P2's cubic B-spline. | P1's blue-noise-jittered nearest neighbour for categorical layers. |
| **Shading and tone** | P2: 16-tone OKLab ramps, flat ground at the base tone, Imhof contrast. | P1's relief term (unsharp mask). Compute tone per bake pixel from the sub-cell surface. |
| **Dither** | Blue noise, applied per bake pixel. | Reject P3's Bayer. |
| **Cast shadows** | The exact diagonal sweep of P1 and P3, climbing 2√2 per diagonal step (P3 has the right constant). | P2's 2-bit occlusion depth for the penumbra and the palette. |
| **Ink** | P2's rules: soft or full by drop, no ink canopy against canopy, never on rivers, roads, hedges or fields. | Replace the depth-jump test with an occlusion test. Keep both ink budgets (P1 3–7 %, P2 1.5–6 %) and P1's "never on 1 px steps". |
| **Hatching and walls** | P2: cliffs only (s > 2). | P1's bedding lines on sedimentary cliffs. Shade walls on slopes under 2 as surface, with no earth band and no hatch. |
| **Water, colour, live layers** | P2. | Fix the river L*. P1's palette-cycled flow phase and its seasonal handling. |
| **Data and streaming** | P2: recipe-level data of about 0.9 MB, committed, with the option of a 2,048² height layer. | P1's argument for committing assets. P3's packs and streaming order if the world grows to 6400². |
| **Critic harness** | P2: first-minute frames, an approach and a landing for each site, automatic gates. | P1's seam views and per-layer diagnostics. P3's ledger. Add the views and metrics in section 7.10. |

## 7. Risks none of them addressed

1. **Occlusion is permanent.** The camera never moves relative to the land, so whatever a ridge hides in the bake is never seen, from any position. No siting rule checks that a pad is visible. A cathedral on a valley floor just north of a 45 px ridge is invisible, and so are rivers in steep east–west valleys: 72 % of channel cells at a 160 peak in my test. The fix: the generator computes a visibility map (one sweep per column, south to north, tracking the minimum screen row). Sites must show at least 80 % of their pad and sprite. Each reach records the share of it that is visible, and the critics see a "hidden river" overlay. Steep south walls along major rivers get lowered or set back.
2. **Orientation decides what reads.** Only walls facing south (or partly SW and SE) have screen width. So:
   - cliffs belong on S to SW coasts, and a prevailing wind from the SW is realistic for Atlantic Europe;
   - the town needs a south-facing hillside above a bay opening S to SE;
   - waterfalls show only on reaches flowing south;
   - cirques and tarns should face E to SE;
   - north-facing snow will barely show, so the snow cue must come from summits and plateaus;
   - switchbacks should climb south-facing flanks.
3. **The silhouette rule must test occlusion, not depth.** The spike's depth-jump rule worked only because its land was terraces. On smooth land, every row of a north-facing slope steeper than 0.5 trips every proposed threshold (section 1). Ink a pixel pair when at least k world rows between them are hidden and the drop is at least d. This also stops the mixed-up fixes: P1's wall guard and P2's soft-ink tier.
4. **World-space detail does not survive the column projection.** At KY 0.8, one flat row in five owns no pixel, and south slopes repeat rows. Anything drawn per world cell decimates or aliases: dither, 1 px flowers, single-cell hedges, 1 px rivers and roads, cover speckle. So dither, tone, ink and lines go per bake pixel, and any world-cell feature that must read is at least 2 rows deep.
5. **Drowned coasts.** None of them raises the sea after erosion. Raising it by 2–4 % of relief turns valley mouths into rias and spurs into headlands. In my test that lengthened the coast by 16–24 %, and by 31 % at 6 %. It puts sheltered bays at river mouths, where the town belongs and where "rivers are roads" pays off. Atlantic and Adriatic coasts are mostly drowned land. This is cheaper and more believable than stamped coves.
6. **The aqueduct needs water.** All three treat it as a road bridge over a gorge. A believable aqueduct runs from a lake or spring on high ground to the town or abbey, with a leat at both ends. Otherwise build a viaduct or a packhorse bridge, and keep "aqueduct" for a site that has a source.
7. **Trees hide rivers.** A tree h px tall hides land up to 1.25h cells north of it. Clearance should be about 1.25 × tree height on the south bank and 1–2 cells on the north bank. In open farmland, line rivers with trees on the north bank, the European river-in-a-line-of-alders look.
8. **Derivative and pagan readings.**
   - A red-roofed harbour town with a prominent clock tower reads as one well-known Ghibli town. Model the tower on an Istrian or Dalmatian campanile instead (Piran, Rovinj), which are real and church-built.
   - A Welsh mining valley with row houses, pit-head winding gear and a rail trestle across a gorge reads as another Ghibli film. Keep P2's slate quarry and drop the headframes and trestles.
   - Boulder scatter on moors must never form upright stones, rings or rows, which read as standing stones and cairns. Keep boulders low (P2's 1–2 px) and spaced by blue noise.
9. **The look is never checked while moving.** Shimmer from world-anchored patterns, scatter repeating with a 128–256 px period, and palette-cycling water all show only in motion. Every harness renders still frames. Add a 2-second scrolling strip per region, and give the critics an autocorrelation number for scatter.
10. **Critic views to add.** All of these are generated from the seed:
    - a north-facing slope at 25–35°, for ink;
    - an east–west river in a steep valley, for visibility;
    - a west-facing and a south-facing cliff side by side;
    - the town from its approach;
    - a forest edge along an east–west river.

    Metrics to add: the share of each site that is visible, the visible share of each river, ink share on north-facing slopes alone, and wall share by cover class.
