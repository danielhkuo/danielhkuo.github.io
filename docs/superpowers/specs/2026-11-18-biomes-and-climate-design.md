# Climates and biomes: design

**Date:** 2026-11-18, revised 2026-11-19. **Lead:** Fable; Opus subagents map, check and critique.
**Status:** the owner decided the open points on 2026-11-19 (section 0), and the build follows this document. Two
Opus critics read the first draft (a geographer and painter; a builder checking it against the code) and their
findings are folded in, marked **[Critic]**. Section 13 records what is built.

Labels: **[Owner]** is the owner's own words or decision. **[Decide]** is a smaller decision still the owner's to
make; each has a recommendation, and the build takes the recommendation until the owner says otherwise.
**[Call]** is this design's choice. Numbers are starting values, tuned on renders.

## 0. The owner's decisions (2026-11-19)

- **Story. [Owner]** Simple and reflective, with no world-building. Nothing in the generator follows the lore: no
  months as places, no Round.
- **Climate. [Owner]** Bands of temperature by latitude that loop: a cold band (ice and tundra) at one latitude, a
  hot band (jungle) at the opposite one, gradual change between, and cooling with height. The two routes between
  the bands differ by moisture, a wet side and a dry side, so no biome appears twice in a lap.
- **Landmarks. [Owner]** One of each kind, seven in all: the abbey, and six for the six projects. Each stands in a
  climate that suits it. The six new churches of the first build are cut.
- **Size. [Owner]** Left to this design. **[Call]** It stays 10240 (section 9).
- **The land itself. [Owner]** Asked on 2026-11-19 whether the geography differs by climate, or is the same
  generation as before with new cover. It was the same. Section 6.6 is the answer built now: landforms by climate
  over the grown land. Growing each climate's land natively is **[Decide 4]** there.
- **The land itself, decided. [Owner]** (2026-11-19, through the coordinator) Grow each climate's own land shapes
  before shipping: island outlines, coasts, relief and river courses that belong to each climate. Re-rolling
  everything outside home is accepted; home's start and abbey frames stay byte-identical; each biome still appears
  once a lap. Section 6.7.

## 1. The brief

> "We want different biomes, not just this one green thing. Also, we want to expand this even more. What if you made
> this map in, like, kind of looping, so spherical somehow? And also we want different temperatures biomes...
> gradually getting, like, colder and gradually getting hotter, etc... like a real biome, a jungle... Fable-driven,
> Fable-led. We don't want to be making silly mistakes here... And I don't think we want too many duplicates of
> landmarks because it gets a little bit confusing." **[Owner]**

Today the whole 10240 world is one temperate climate: six region looks vary its rock and cover, and five each of
lighthouses, bridges, cathedrals, windmills and yews stand on it.

## 2. Goals, non-goals, anti-goals

**Goals**

1. The world reads as round, and its two routes differ. Fly north from home and it grows colder, through taiga
   and tundra to the polar ice. Keep on, and the far side comes down dry: steppe, the Mediterranean, desert and
   savanna, into the jungle. Keep on again, and warm forest brings you home.
2. Ten climates a visitor can name from one frame, each met once in a lap: ice, tundra, taiga, temperate (today's
   look), warm forest, jungle, savanna, desert, Mediterranean, steppe.
3. Every change between them is gradual and follows the land. No ruled line, no stripe.
4. One house style: the same paper, washes, ink, three value masses and reserved vermilion and gold.
5. Seven landmarks, no kind twice: the abbey, and one site for each of the six projects.
6. Settlements, fields and wonders suit their climate.
7. The budgets stand: about 1.5 MB before first flight, under 4 ms a frame at 4× throttle, a worker's window bake.

**Non-goals**

- Seasons, time of day and weather (the palette session owns them). Biomes are baked; the palette still moves the
  season.
- New live animals and sights per biome (camels, penguins). Listed as follow-ups.
- New sea and river colours. The live layers key on four water ids; see 6.5.
- Changing how the land is grown: the plan, erosion, coasts and rivers stay as they are. (The first build stopped
  there. Since the owner's question of 2026-11-19 the climates do shape the land, over what was grown: 6.6.)

**Anti-goals: it fails, even with every test green, when**

- a biome border runs straight, or the overview map shows latitude stripes;
- a climate of one side shows on the other: hedged green fields between the steppe and the Mediterranean, or sand
  and savanna on the way from home to the jungle;
- green pasture, hedges, wheat or sheep stand on ice or dunes; a hamlet stands on an ice cap;
- the home island's approved opening flight looks different;
- a river crosses a desert as a full blue ribbon with no green beside it, or runs liquid across an ice cap;
- any ornament reads as pagan (no temples, idols, totems, standing stones), or copies a known property.

## 3. Constraints found in the code

- **Cover is a pure function per cell** in the bake (`cover.ts`), fed smooth fields from the C grid (8 cells a node):
  moisture, wind, exposure, debris, rock and six region weights. It already models a mountain's zones by a cold score,
  `e/100 + 0.1·northness`: broadleaf, conifer, tree line, alpine meadow, late snow, snow at 93 units.
- **Materials are a byte.** 102 of 256 ids are used. `gen/sites.ts` tests ids by range, so new ids are appended, never
  inserted.
- **The palette** caps terrain chroma at 0.09 between hues 8° and 106° (the dragon's vermilion and gold), and lifts
  the river until it is 15 L\* lighter than every vegetation it may cross. New vegetation must not raise that lift.
- **The live layers key on fixed id lists** (`live/water.ts` CLASS and KIND; `isSea`, `isPasture`, `isBeach`,
  `isField` in life, sights, rare and moments). Other sessions are editing those files now.
- **The haze** for unbaked land is coloured by height alone, from the core's overview.
- **The terrain cache** (`cli/worldcache.ts`) holds climate; a 10240 world takes 4.7 min and 2.9 GB to grow.
- **Tests bake a frozen fixture world** (format 1, no climate data) with the current look and pin the frames by hash
  (`live/water-speed.test.ts`). A world with no climate data must therefore bake exactly as it does today.
- **A trunk cannot be drawn.** The painter draws each cell as one column in one material, so a tree is a dome to the
  ground. A palm, an umbrella acacia or a saguaro needs a crown that floats over a stem.

## 4. Approaches

### 4.1 How the world becomes round

| | What | For | Against |
|---|---|---|---|
| **A. A looping climate on the torus** | Latitude is a function of y that loops: equator, pole, equator | No engine change; seamless; north stays up; climate becomes a compass | Topologically a torus: over the pole you keep flying north, where a globe would turn you south |
| B. A true sphere | Project a sphere (cube faces, or squeeze the poles) | Honest geometry | The fixed north-up camera, 256-cell chunks, blue-noise tiling and the region grid all need a flat torus; poles are singular; everything shipped is rebuilt |
| C. Mirror at the poles | Past the pole, reappear half a world east, heading south | Globe-like routes | The camera never turns, so the land would have to flip under the flier; the seam shows |
| D. Two cycles | Two poles and two equators in one lap | More crossings per lap | Each band is half as tall: under 300 cells, one screen |
| E. Climate in blobs | Noise decides hot and cold, no latitude | Easy | Nothing loops, nothing reads as a globe, and climate is no help finding your way |

**[Owner] A.** Built. What makes a world feel round to someone flying over it is that climate
follows latitude and comes round again. A gives exactly that and breaks nothing. East–west already loops like
longitude.

### 4.2 How a cell learns its climate

| | What | For | Against |
|---|---|---|---|
| **A. One smooth temperature field, shipped; biome decided per cell** | The generator ships sea-level temperature on C; the bake adds height, aspect and the lie of the land | Borders at cell size that follow the land; 4 KB a region; the rule table stays in the fast tuning loop | The cover grows |
| B. Ship a biome id per node | The generator classifies | Simple bake | 8-cell blocks and hard edges; a look change re-ships the world |
| C. Compute latitude in the bake, ship nothing | Temperature from y alone | No data | No sea or coast influence, no home rule, no warp tied to the land |
| D. A second set of region planes | Nine biome weights like the six archetypes | Reuses the blend | 9 more planes a region; weights blend colours, they do not make ecotones |

**[Call] A.** It is how cover already works: smooth fields in, a rule table per cell.

### 4.3 How biomes meet

Rejected: blending by dither alone (a speckled band is static on screen, and still a line), and blending colours
(the palette has no in-between of sand and grass).

**[Call] Four mechanisms, in this order of weight.**

1. **Shared rules.** From ice to the Mediterranean one rule table serves, shifted by climate (5.3), so every cold
   transition is the mountain zonation the look already has, laid on its side.
2. **Ecotones follow the land.** Each border is drawn on a local score, not on latitude: a south face turns dry before
   a north face, valley floors and river banks stay green deep into dry country, hollows hold snow below the line,
   gallery forest runs up savanna rivers.
3. **Plants mix one by one.** Scatter densities and species are continuous in temperature and moisture: conifers thin
   to dwarf birch, acacias thicken to forest.
4. **Patch noise, then blue noise.** What is left is broken by noise at 60, 15 and 4 cells, and last by the mask.

### 4.4 How the two routes differ

The loop has two routes from the pole to the equator: the one through home, and the one round the back.
**[Owner]** They differ by moisture, a wet side and a dry side.

| | What | For | Against |
|---|---|---|---|
| **A. Each side its own curves, and the side shipped** | Temperature and rain by latitude, one pair of curves a side, meeting at the pole and the equator; a small plane, `arid`, says how far a node lies on the dry side | The dry side needs no temperate plateau, so nothing temperate shows twice; the cover can dress dry ground whole where its temperature passes the plateau's | One more plane, nearly all of it flat |
| B. Rain alone differs | One temperature curve; the dry side gets less rain | No new field | The dry side keeps a plateau at exactly the temperate temperature, where the cover is by rule today's: a band of hedged green between steppe and Mediterranean |
| C. The bake works out its own side | From the row, the equator's row and the seed | No bytes | The isotherms' wander must be repeated in the bake, and can drift from the generator's |
| D. East and west differ, not the two routes | Banded winds: wet east coasts, dry west coasts | A globe's own asymmetry | Every climate still comes round twice in a lap, which is what the owner asked to end |

**[Call] A.** Home is green, so the route through home is the wet side.

## 5. The climate

### 5.1 Latitude

`φ(y) = |y − equatorY| / (n/2)` on the torus: 0 on the equator line, 1 on the pole line; `90·φ` is degrees.

**The two sides.** Signed latitude `s` runs from 0 on the equator line to +1 on the pole line through home, the
**wet side**, and from 0 to −1 the other way round, the **dry side**. The wander of 5.2 is added to `s` itself and
folded at 0 and ±1, so the two lines where the sides meet wander as the isotherms do; φ is `|s|` after it. Both
sides' curves agree at the pole and at the equator, so nothing shows where they meet: it is ice on both sides of
one line and jungle on both sides of the other.

`arid` is the dry side's share of a node: 0 on the wet side, 1 on the dry side, rising over a tenth of the
latitude from each meeting line. It lives on C and ships beside the temperature (7).

**[Call] Anchor.** `equatorY = homeY + 0.62·n/2`, where `homeY` is the home island's core. The home island's core
sits at 56° north, colder to its north, as in the Europe the land is drawn from; the island reaches further south
than north of its core, and at 56° that reach ends in the Mediterranean belt, not at the desert's edge (the first
anchor, 51°, left green home beside sand at one latitude: a geographer's catch). On seed 3 at 10240 the equator is
at y ≈ 6270 and the pole at y ≈ 1150, which by luck gives a table island on the equator, a fen under frost polygons
on the tundra and a snow-capped volcano with a frozen crater lake by the pole.

**[Decide 1] North is colder at home.** Recommended. The mirror (equator to the north) is one sign.

At 10240 the equator-to-pole run is 5120 cells: 85 s at cruise, 45 s boosting.

### 5.2 Temperature

`temp` is sea-level temperature, 0 (pole) to 1 (equator), with **0.5 the temperate plateau**. It lives on C and ships.

1. **The curves.** Piecewise linear in φ, one a side. The wet side is flat across the temperate belt; the dry side
   has no plateau and passes the temperate temperature at one latitude:

   | Wet side, φ | 0 | 0.10 | 0.22 | 0.34 | 0.46 | 0.52–0.66 | 0.73 | 0.85 | 0.92 | 1 |
   |---|---|---|---|---|---|---|---|---|---|---|
   | temp | 1 | 0.97 | 0.88 | 0.74 | 0.58 | 0.50 | 0.415 | 0.27 | 0.142 | 0.02 |

   | Dry side, φ | 0 | 0.08 | 0.20 | 0.30 | 0.42 | 0.50 | 0.56 | 0.62 | 0.72 | 0.84 | 0.94 | 1 |
   |---|---|---|---|---|---|---|---|---|---|---|---|---|
   | temp | 1 | 0.97 | 0.93 | 0.91 | 0.87 | 0.77 | 0.62 | 0.50 | 0.40 | 0.28 | 0.142 | 0.02 |

   The dry side stays hot through the desert's latitudes and falls fast across the Mediterranean, so the desert
   keeps its heat on high ground (as tuned on the land's shares: a first curve left it 2 % of the land).

   A plain cosine was weighed and dropped: it has no plateau, so no land would keep today's look. **[Critic]** The
   belts are cut nearer a globe's shares than equal bands: on a sphere the caps are small and the tropics broad.
   With each climate met once in a lap, a belt is 600 to 1100 cells tall, two to four screens.
2. **Warp.** φ is bent by periodic noise at n/2, n/5 and n/13 (about ±400 cells in all), so no isotherm is a ruled
   line. **[Critic]** The first draft's ±150 would have left the pack-ice edge straight across the open sea.
3. **Sea and coast.** Continentality is the land's share within about 320 cells. Inland is more extreme: colder in
   the cold belts (an island's coast is tundra where its heart is ice), hotter and drier in the hot belts. The sea
   itself keeps the curve. Nothing is added inside the plateau.
4. **The home rule [Decide 2].** Recommended: the home island keeps exactly today's climate, and the temperate belt
   swells round it, as a warm current bends the isotherms round Europe. The swell fades over about 1100 cells to the
   north and south and 2500 along the latitude, so it reads as a bend in the belt and not a ring round an island
   (**[Critic]**: a round halo would look like a mistake on the map). The land and cover of the approved opening
   flight (river mouth, town, abbey) are then unchanged to the byte, and the islands near home grade away from it.
   Without this the home island, 1900 cells from north to south, would run from taiga to desert edge.
5. **Height, per cell, in the bake.** Temperature falls with height, and a north face is a little colder. This is
   the existing cold score, shifted: see 5.3.

Alternatives weighed for the vertical: shipping a per-node biome (4.2 B), and cooling on the C grid (the snowline
would follow 8-cell blocks, not the ground).

### 5.3 The climate shift

The rules already read height as cold. So climate enters them as a height offset:

`shift = (0.5 − temp)·260` units where temp < 0.5, and `(0.5 − temp)·120` where temp > 0.5.

Every climatic use of height in the cover and in scatter reads `e + shift`: the cold score, the snowline, the tree
line, where scree grows over, where summits bare. Physical uses (the beach, the floodplain, shelter) keep `e`.

| temp | shift | At sea level |
|---|---|---|
| 0.5 | 0 | today's look, bit for bit |
| 0.415 | +22 | conifers take the woods: taiga |
| 0.27 | +60 | the tree line reaches the sea: tundra |
| 0.14 | +93 | the snowline reaches the sea: ice |
| 0.72 | −26 | the snowline stands at 119: the highest summits of the dry belt keep a cap |
| 1.0 | −60 | no snow; woods climb to 120. **[Critic]** A tropical tree line stands twice as high as an Alpine one |

**[Call] Temperate is the identity.** At `temp = 0.5` on the wet side (`arid` 0 or absent), and in any world with no
temperature field, the cover, the scatter and so the bake are exactly today's. `climate-identity.test.ts` pins it by hash over 300 000 inputs, and the
fixture tests' golden frames pin the bake. It covers the land and its cover. What is built on the land changes by
design, since the landmark set does (10).

**[Critic] The shift alone is not enough.** Walked through the rule table, a flat coast at shift 60 is still hedged
wheat on the home and karst looks, and at shift 93 its beaches, saltmarsh and floodplains are still sand and reeds.
So the cold family adds, each weighted in by the shift and absent at zero:

- an ice check before the shore and floodplain rules, so a polar beach is an ice foot;
- a tundra rule after late snow and before fields, fen and woods, in every region, not only highland and lakes;
- a cold limit on every field, and a hard tree line where the shift is large;
- conifers sooner the larger the shift, or the taiga would be a broadleaf wood until its last few cells.

Only comparisons of height against a climatic line are shifted. Rock beds and strata read the true height.

**[Call] The dry side is dressed whole.** On the wet side the cold and the warm dress both come on from nothing at
the plateau's edge, so no line shows where the temperate climate ends. The dry side has no plateau: its temperature
passes 0.5 between the steppe and the Mediterranean, and a dress that faded to nothing there would leave a belt of
temperate green. So where `arid` is above 0 the dry dress is whole at every temperature, and one rule lays it on
both sides of that latitude: sage and straw sward, with the Mediterranean's olives, cypress and vines coming in by
patches on the warm side and the steppe's bare khaki on the cold. Cooling with height is unchanged on both sides.

### 5.4 Moisture

Today's moisture is blurred orographic rain from a south-west wind, wetter to windward, with rain shadows. It keeps
that shape and is multiplied by a zonal factor, one curve a side:

| Wet side, φ | 0 | 0.30 | 0.46 | 0.52–0.66 | 0.73 | 0.85 | 0.92 | 1 |
|---|---|---|---|---|---|---|---|---|
| rain | 1.7 | 1.6 | 1.25 | 1 | 0.98 | 0.85 | 0.65 | 0.5 |

| Dry side, φ | 0 | 0.05 | 0.10 | 0.20 | 0.27 | 0.31–0.46 | 0.52 | 0.58–0.64 | 0.74 | 0.84–0.94 | 1 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| rain | 1.7 | 1.45 | 1.0 | 0.7 | 0.38 | 0.19 | 0.42 | 0.55 | 0.5 | 0.55 | 0.5 |

Inland the dry side is a little drier still. Within one latitude the south-west sides of high islands are the
greener and their north-east sides the drier: on the dry side the desert is widest in rain shadows and the
windward slopes keep steppe; on the wet side a lee slope is open glades in the forest, not savanna.

**[Critic] One wind is a simplification.** A globe has trades from the east in the tropics and westerlies beyond,
mirrored across the equator, which puts real deserts and Mediterranean coasts on the west of the land and wet
forest on the east. The first pass keeps the one south-west wind, because the exposure field, the cliffs and the
camera's best faces are all built on it. Banded winds for moisture alone are four sweeps of the existing rain model
and no change to the land; they are the first refinement after the looks land (14).

**[Call] The rivers are not re-grown.** Hydrology keeps its rain, so the land, its valleys and every river vector
stay as shipped. Climate decides how a river is drawn (6.4). Re-growing rivers by climate would move the home
island's water and re-roll every site.

## 6. The biomes

### 6.1 Which is which

Cold to temperate is one family, decided by the shifted rules. Hot country is a second family, decided by heat and
aridity, below a montane line; above that line a tropical mountain wears the shared rules (cloud forest, páramo,
rock, a cap of snow).

| Biome | Side | Where (φ, at sea level) | Decided by |
|---|---|---|---|
| Ice | both, one band over the pole | 0.92–1 | snow rule, shift ≥ 93 |
| Tundra | both, the ice's fringe: boggy on the wet side, stony on the dry | 0.85–0.92 | above the tree line and far from temperate (a new rule, weighted in by the shift) |
| Taiga | wet | 0.73–0.85 | woods rule; conifers by cold, sooner the larger the shift |
| Temperate | wet | 0.52–0.66, and round home | today's rules |
| Warm forest | wet | 0.31–0.50 | the woods close over the fields and pastures as the heat rises; evergreen crowns; palms on the coast |
| Jungle | both, one band over the equator | wet 0–0.31, dry 0–0.09 | heat and rain enough for closed forest |
| Savanna | dry | 0.09–0.26 | grass country in the latitudes with a dry season |
| Desert | dry | 0.28–0.50 | aridity under 0.20; thorn and thin steppe at its edges |
| Mediterranean | dry | 0.50–0.62, and the high ground of the desert's latitudes | the dry dress on the warm side of the plateau's temperature |
| Steppe | dry | 0.62–0.84 | the dry dress on its cold side, to the tree line |

These are where each is at home; every bound is a ramp, and the world has no latitude without a rule. A lap from
home, northward: temperate, taiga, tundra, ice, tundra, steppe, Mediterranean, desert, savanna, jungle, warm
forest, home.

Aridity is moisture plus local terms: a valley floor and a river bank are wetter, a south face and a spur drier,
patch noise either way.

### 6.2 What each looks like

All colours are new palette entries through the materials and palette tables; ramps keep the house shapes (LAND,
UPLAND, CANOPY, STONE, PALE). Warm grounds sit inside the reserved sector and keep chroma ≤ 0.09.

| Biome | Ground | Plants (scatter) | Rock, coast, water |
|---|---|---|---|
| **Ice** | Snow, lit by its true normal as today; bare blue glacier ice on steep tongues; wind-scoured rock on faces | none | An ice foot for a beach; pack ice on the sea, in floes with dark leads, thinning to open water; bergs; lakes and rivers frozen |
| **Tundra** | Russet, ochre and olive in a mosaic; pale lichen on dry rises; sedge and dark pools in the flats; a net of frost polygons on the flattest ground; snow patches in every hollow | dwarf birch and willow in sheltered hollows; boulders | Shingle shores; rivers run; many small pools |
| **Taiga** | A pale lichen floor under open spruce in the north, dark moss in the south; bog with pools in the flats | spruce (narrow dark spires, close set), birch along water and edges, thinning to krummholz | Grey rock; shingle and dark sand |
| **Temperate** | unchanged | unchanged | unchanged |
| **Warm forest** | The temperate fields and pastures, shrinking to clearings as the woods close over them; a dark evergreen floor | glossy evergreen crowns, larger and darker than home's woods, the jungle's own coming in toward the tropics; palms in the clearings and along the shore | Rock and rivers as temperate; pale sand; the clear sea begins |
| **Mediterranean** | Its own sage sward, greyer and paler than any temperate green, and pale stony earth; lavender-grey garrigue in patches on the tops; white limestone crags | umbrella pines, cypress spires, olive, shrub thickets; vines and wheat in the fields | Pale stone; white coves; turquoise shallows (the existing clear sea) |
| **Steppe** | Straw-olive grass that waves in the wind; bare earth patches | sage bushes; poplars by rivers | — |
| **Desert** | Sand seas with real dunes (low relief added in the bake, so they shade and cast shadow) in lobed patches a few hundred cells across; darker gravel plains between; salt on the flattest basin floors | thorn bushes, in contour bands toward the savanna (tiger bush); columnar cactus on rocky ground; palms and a green strip only by water | Banded ochre sandstone; bare dunes to the shore; small streams are dry wadis, big rivers keep their water and a ribbon of green |
| **Savanna** | Golden grass with red-earth patches and worn tracks | flat-topped acacias, wide apart, thicker toward the jungle; termite mounds; gallery forest on rivers | Waterholes with a green rim |
| **Jungle** | Dark understorey, seldom seen | closed canopy of large crowns in four greens, emergent giants, palms at every edge | Mossy rock; palm beaches of pale sand; mangrove on sheltered muddy shores; turquoise shallows |

**The two sides in the cold and the hot.** The dry side's winters are dry: its snowline stands 12 units higher and
its late snow is gone by summer, so its tundra shows stony ground where the wet side's lies white. That thin snow
fades out toward the pole (whole to a cold shift of 68 at the sea, gone by 75): the coasts of the pack ice keep the
polar snow, and the lighthouse and the baths stand in white. The dry side's savanna runs nearly to the equator on
level ground only; hills in those latitudes keep the forest of the shorter belt, as broken ground does where grass
fires run. (Both were found by the side-by-side scoring of 6.7: tundra stains on the polar snow, and a ridged
island's spurs as tan wedges.)

**[Critic] What tells them apart is texture and value, not hue.** Jungle and taiga are the two most likely to read
as a recoloured temperate wood, tundra as today's moor, steppe as mud. So: jungle crowns half as large again, lumpy,
with no ground between; taiga as dark spires on a pale floor; tundra lighter and rustier than moor, with its pools
and polygons; steppe waving, with bare earth showing. Every frame keeps three value masses; on the ice that means
rock and shadow must hold a tenth of it. New materials do not change with the palette's season unless a real plant
does: nothing turns a jungle autumnal or greens a desert.

### 6.3 New in the bake

- **`temp` reaches the cover** as `CoverInput.temp`, sampled bilinearly from C like moisture. Absent means 0.5.
- **Floating crowns.** Palms, acacias, umbrella pines, cactus arms and jungle emergents are small pictures, a
  crown over a stem, drawn into the chunk after the painter, one pixel at a time and hidden by anything nearer, as a
  building's windows and sails are drawn today. What stands behind shows round the stem. **[Critic]** The first
  draft floated a slab inside the painter; the painter keeps one frontier a column, so that would have meant a
  second ground layer in every tile and new meanings for the ink's bookkeeping. Tiles with no such plant bake
  exactly as before, by construction.
- **Dunes.** On arid sand the bake adds up to 3 units of dune relief, a pure function of position, as it cuts
  gullies today.
- **Stamps on water.** Bergs on polar sea, mangrove crowns in tropical shallows.
- **A channel is not always water.** A frozen river and a dry wadi are drawn along the river's line in their own
  materials, and neither animates. The painter's line pass reads a table of channels of its own, apart from the
  water table the live layers use.
- **Fewer streams in dry country. [Critic]** The land's channels were cut by a temperate rain. In true desert most
  one-pixel streams are not drawn at all, and the rest are wadis, or the sand would be a net of dry lines.

### 6.4 Rivers and lakes by climate

| Climate | Stream (1 px) | River | Lake |
|---|---|---|---|
| Ice | hidden under snow | frozen: a pale blue line | frozen, drifted with snow |
| Tundra, taiga | water | water | water |
| Desert, steppe edge | dry wadi | water, with reeds, palms and plots along it | water, an oasis; salt rim |
| Jungle, savanna | water | water, in a corridor of low green | water |

### 6.5 Water colours [Decide 3]

Recommended: no new water ids in this pass. The sea is `sea` or `seaClear` (now also the tropics), and rivers and
lakes are `river` and `lake`. Pack ice, lake ice, river ice and wadis are land-like ids that the water layer leaves
still. A steel-blue polar sea and a silty jungle river each need the same entry in five live-layer tables that other
sessions are editing; they are follow-ups once those merge.

**[Critic]** objects: the sea is the largest cue in every frame, and bergs on a tropic-blue sea would be a silly
omission. The pack ice covers most polar water and the clear sea is already turquoise, so this is judged on the
first polar renders; if the open polar sea reads wrong, a cold sea id is added and the five lists with it.

### 6.6 Landforms by climate

**[Owner]** "We're also making new landscapes, right? Like the geography is different in these different areas?"
In the first build it was not: every climate lay on land grown by one temperate rule, and only its cover, its ice
and its small dunes differed.

| | What | For | Against |
|---|---|---|---|
| **A. A landform stage over the grown land** | After the climate is known, the climate reshapes the ground where it is not temperate: benches and mesas, dune ridges, an ice sheet's smoothing, karst towers, rock domes | Seconds, not minutes; the home island is untouched by construction; every river keeps its bed; judged on renders the same day | The islands' outlines and the rivers' courses are still the temperate generator's |
| B. Grow each climate's land natively | The plan, uplift, erosion and rain take the climate: plains where it is steppe, plateaux cut by canyons and few rivers in the desert, fjords in the cold, atolls and deltas in the tropics | The real thing | Everything outside home is grown again and judged again (a new land, new sites, new pins); the generator's global steps must be shown not to move the home island; days, not hours |
| C. Choose each island's archetype by its climate | The six looks that exist, dealt out by latitude | No new landform code | The six are all temperate European country: no mesa, dune sea or tower among them |

**[Call] A now. [Decide 4] B** is the owner's to ask for: it is the larger half of the answer, and its cost is a new
land everywhere but home.

**The stage.** It runs after the climate, on G, and writes the final ground and the height above drainage. Its
change is a sum of landforms, each weighted by how far the node is in that landform's climate (0 on the temperate
plateau, so the home island's ground is the same to the bit), and all of it by two guards:

- **A river keeps its bed.** Nothing moves within 1 unit of height above the nearest drainage, and the change is
  whole only 7 units above it. No landform lowers ground to within half its height above drainage. So every channel
  still runs downhill in its valley, and no lake's shore moves.
- **The coast keeps its line.** Nothing moves within 12 cells of the shore, and the change is whole 48 cells inland,
  so beaches, cliffs, stacks and coves stand where the coast stage put them.

| Landform | Climate | What it is |
|---|---|---|
| **Benches and mesas** | desert (hot, arid) | The ground is stepped by height: level treads 11 units apart with steep risers, the beds wandering a little like strata. Slopes become benches, summits mesas, and valleys canyons with stepped walls; the bolder in some country than other. The cover draws every steep bank of the desert as red sandstone, so a riser is a scarp |
| **Dune ridges** | the desert's sand seas | Linear dunes running with the south-west wind, as in the great ergs, some 40 cells apart and up to 6.5 units high. The bake's small dunes ride on them, the same way. **[Call]** Crests across the wind would run along the north-west light and not show: its first version did not |
| **The ice sheet** | ice | Hollows and gullies fill toward the land's own smoothed surface: domes of ice with the peaks standing out of them. The main valleys stay, each with its frozen river: outlet glaciers |
| **Karst towers** | jungle, in patches | Steep-sided hills 14 to 22 cells across and 14 to 25 units high, close set on low gentle ground: tower karst, forest to their tops and bare on their sides |
| **Rock domes** | savanna | Lone domes of bare rock, 40 to 70 cells across, a few hundred cells apart on the plain: inselbergs. The cover draws steep hard rock in grass country as bare granite |

Not changed: temperate, taiga, the warm forest, the Mediterranean and the steppe keep the land as grown. The steppe
wants plains, and a plain cannot be made over land that is already cut by rivers without leaving them perched; that
is B's work.

**What follows from it.** Sites, hamlets and roads are placed on the reshaped ground, so a road goes round a scarp.
The change ships as part of the ground's own planes. The rain, the wind and the temperature are read off the land
as grown.

### 6.7 Native land by climate

**[Owner]** Every island outside home is grown again for its climate. Home's start and abbey frames stay the same
to the byte.

**Why the generator cannot simply take the climate.** Four couplings make every island's land depend on every
other's, so a climate-aware generator run once would move home:

- the erosion schedule runs until the erosion over all the land balances the uplift (`erode.ts`, `stopAt`);
- the cap scales all land by one factor so the highest peak stays under it (`capLand`);
- the rivers stage draws its bends, oxbows and wiggles from one random stream, in scan order from the top row
  (`rivers.ts`), and the polar islands north of home come first;
- region membership blends every island's look into every node with no cut-off (`plan.ts`).

| | What | For | Against |
|---|---|---|---|
| **A. Two grown lands, joined by island** | L0 is the land the generator grows today. L1 is grown with the same island placement, every island but the kept ones re-formed by its climate, eroded and drained under its climate's rain. The world takes each island whole from one of them; the join runs through open sea | Home is L0's by construction; every stage is reused as it is; the climates' land grows with the generator's own erosion, coasts and rivers | Two lands to grow (about 5 minutes each at 10240; each cached) |
| B. One run, the couplings made local | Fixed step count, a per-island cap, a random stream per reach, a blend with a cut-off | One land | Each change moves home today: the shipped home would change once, and every later tune risks it again |
| C. Re-grow each island on its own window | A small erosion run per island, pasted in | Fast to tune one climate | A second copy of the schedule, the coast and the rivers, at window edges |

**[Call] A.**

**What is kept from L0.** Home; every island whose own climate is temperate (its land is the temperate generator's
already); and every island whose land lies within 400 cells of the start or abbey view (one skerry group), since the
moisture blur and the wind's horizon reach about 360 cells.

**[Owner]** Nothing judged before may score lower. Each climate, landmark and wonder was scored side by side against
the climates on the old land (Fable's last state, `269bb41`) by fresh critics (look ledger, round 9), and where the new
land scored lower the old land was kept. So L0 also gives:

- fens, in every climate: low lobes round meres are a tundra of pools, a delta of lagoons or a swamp as the climate
  dresses them, and they hold the marshes and still water the marsh house and the bridge town need;
- tables outside dry country and the jungle: a karst plateau of the cold is already its own land;
- the warm forest's islands: its recipe (steep ridges, rias) is the generator's own land, and scored no better;
- the steppe's and the Mediterranean's own islands (the windmill's headland is on one), and the volcanoes of dry
  country (the Mediterranean's calanque is a caldera's wall): their recipes scored lower;
- islands on the equator line, whose land is both sides' jungle (the cove hotel's cove is on one).

On seed 3, 20 of 43 islands are grown again: six of the ice, three of the taiga, one of the dry side's tundra, three
of the desert, two of the savanna and five of the jungle. Skerry groups, and cones and calderas outside dry country,
keep their forms but are taken from L1, so they are eroded and drained under their own climate.

**Which recipe.** Each island takes the climate of its own land (L0's climate, averaged over the island): its mean
sea-level temperature, its side and its mean moisture.

| Recipe | Where (mean sea-level temperature of the island; side) | Form | Relief | Coast |
|---|---|---|---|---|
| Ice | under 0.2 | fjord belts | a high massif with a broad top (peak 150): the ice sheet of 6.6 fills it to a dome with nunataks | outlet fjords |
| Tundra, wet side | 0.2–0.29 | fen | low (22), lobed, studded with lakes, glacial ribbon lakes | ragged, many islets |
| Tundra, dry side | 0.2–0.29 | belts | a low stony upland (40), two to four ridges, under its snowline | plain, rocky |
| Taiga | 0.29–0.44, wet | belts | low glaciated lake country (26): a shield of troughs and lakes under its snowline | lobed, lake-cut |
| Steppe | 0.29–0.5, dry | broad belts | a plain: a low plateau (30, flat over three quarters of its half-width), smooth slopes, shallow valleys | smooth, low |
| Mediterranean | 0.5–0.7, dry | belts | rugged limestone ridges (85) | peninsulas, cliffs and coves |
| Desert | over 0.7, dry, moisture under 0.27 | belts | a low mesa plateau (34; high ground would cool out of hot country) over wide plains where the ergs lie; hard beds over soft, benched by 6.6 | straight, cliffed |
| Savanna | over 0.8, dry, moisture 0.27 and over | broad belts | a low plateau plain (34); its granite domes by 6.6 | smooth |
| Warm forest | 0.56–0.85, wet | belts | steep ridges (95) and deep valleys | rias |
| Jungle | over 0.85 wet, or 0.93 dry and moist | belts | rugged limestone mountains (70) over wide coastal plains, where the tower karst of 6.6 stands | inlets, deltas, mangrove |

A table island stays a table: a mesa in dry country, a tepui in the tropics; a table is too small to carry belts.
The steppe's, the Mediterranean's and the warm forest's recipes stand in the code, but their islands are kept from L0
(above), so on seed 3 those climates are the old land in their own dress.

An island keeps its size: it is rebuilt from the same drawn length at the same place, and shrunk if its new outline
would reach past the old one's extents, so the channels the placement kept between islands still hold.

**Rain by climate.** In L1 the erosion's drainage area and the hydrology's runoff are weighted by the climate's
zonal rain (`Climate.rainZone`, from L0's climate): a desert island wears little and keeps its plateau and has few
rivers; a jungle island is cut deep and carries many. The moisture field still comes from the orographic rain, so
the zonal factor is not counted twice.

**The join.** On G, a node belongs to the island whose outline lies nearest (`plan.owner`, L0's); kept islands' nodes
come from L0, the rest from L1. Land, coast fields, plan fields, hydrology fields and the river ground are taken by
that mask; stamps, glacial features, lakes and river reaches by the node they stand on. L1's lakes and reaches are
numbered after L0's, so home keeps its own numbers. The climate is then worked out over the joined land, with the
moisture normalised by L0's 95th percentile, and the landforms of 6.6 run as before.

**Proof.** The build's own check: the start and abbey frames, as generated and as shipped, hash the same as before
(`9b28eb…`, `b3064c…`, `4af97f…`, `99b54d…`). A test pins the join: a kept island's nodes equal L0's in every field.

**The join's seam.** The two lands' sea beds differ, so where both are sea within 30 G nodes (120 cells) of the join
the bed is blended across it, half and half at the join. The join runs through open sea, at least 347 cells from the
start view on seed 3, so home's views never see it.

**Settling the new land.** The landmarks are sited again by their climates (10). Wonders keep off the home island,
so the opening flight stays as it was however the rest is grown; a crowded world gives a wonder a last pass at 250
cells from landmarks and wonders (half and then 600 before), but not the bridge town, which would stand by the old
bridge. The marsh house may stand in any marsh off the ice; the bridge town counts grazed dry sward as working land.

## 7. Shipping

- **Regions** gain one section, `temp`: the C plane, 500 steps over [0, 1]. About 4 KB a region, 16 KB before first
  flight. `moisture` keeps its section with new values.
- **And a second, `arid`:** the C plane, 100 steps over [0, 1]. It is flat but for two wandering bands, so it packs to
  almost nothing. Absent, or all 0, means the wet side.
- **Optional, flagged in meta**, as base and conform are. A world without it decodes and bakes as today.
- **Windows.** `temp` and `arid` are cut, stripped and stood in exactly as moisture is; a tile from regions equals a tile from
  the whole world, byte for byte.
- **The manifest** gains `climate: { equatorY, poleY }`, for a latitude readout, the parchment map and the lore.
- **The haze.** The core gains an optional plane, one byte per overview sample, naming the haze wash where it is not
  temperate (sand, straw, jungle, tundra, snow). Without it the haze is today's.
- **The terrain cache** version is bumped. Climate is recomputed when a cached terrain is read, so tuning the curve
  costs seconds.

## 8. Settlements

- **Hamlets** keep off ice, are rare on tundra and in desert (only by water), and take a style from their climate
  with the builders that exist:

  | Climate | Walls | Roof |
  |---|---|---|
  | Tundra, taiga | dark timber or rubble | steep slate; turf on the tundra |
  | Temperate | as today | as today |
  | Mediterranean | whitewash | terracotta, low pitch |
  | Desert | mud plaster | flat, parapeted |
  | Savanna | mud plaster, round | conical thatch |
  | Jungle | timber on stilts | thatch |

- **Fields.** Enclosure is a temperate and Mediterranean thing. Elsewhere: irrigated plots only beside water in the
  desert, paddies beside jungle hamlets, nothing on tundra or ice. Hedges never leave temperate country.
- **Pads and yards** take the ground of their climate, not pasture.
- **Roads** run everywhere but across ice; a desert track is pale earth.
- **The town and the abbey** stay on the home island, unchanged.
- **Wonders** keep their terrain rules and each gains a climate window, so none lands somewhere silly: the great oak
  and the bridge town in temperate or Mediterranean country, the drowned church in a lake that is not frozen, the
  marsh house off tundra and jungle. The baths prefer cold country; the hotel prefers warm. The observatory stands
  under clear skies: the highest summit of the dry side's hot country (sea-level temperature 0.72 to 0.9), between the
  Mediterranean's woods and the equator's cloud forest. A wonder's window may name a side, as a landmark's does.

## 9. Size

**[Owner]** left this to the design. **[Call]** The world stays 10240.

| | 10240 (today) | 12800 | 15360 |
|---|---|---|---|
| Equator to pole at cruise | 85 s | 107 s | 128 s |
| A typical belt, each climate once a lap | 600–1100 cells, 2–4 screens | 750–1400 | 900–1650 |
| Islands | 25 and 18 skerry groups | about 39 and 28 | about 56 and 40 |
| Grow time, peak memory | 4.7 min, 2.9 GB | about 7.5 min, 4.5 GB | about 11 min, 6.5 GB |
| Whole world | 10 MB | about 15.6 MB | about 22.5 MB |
| Core (rivers, overview), before first flight | 0.93 MB, 1.45 MB | about 1.4 MB, 2.0 MB | about 2.0 MB, 2.6 MB |

It can grow as its own step if the owner wants more after seeing the biomes. The reasons:

- With each climate met once in a lap, every belt is already twice as tall as in the first, mirrored build.
- Every length in the climate is a share of n, so growing later is one argument and a seed search.
- Biomes multiply what there is to see far more than 56 % more of one climate would.
- 12800 gives each belt a quarter more room, which is not a different experience; the first-flight download would
  pass its 1.5 MB budget unless the core's rivers and overview are split into regions first.
- A new size is a new land: seed 3's islands, the placed sites and the wonders would all be re-rolled and judged
  again. Doing the biomes on the land that has had fourteen look rounds isolates what changed.

## 10. Landmarks

**[Owner]** One of each kind, seven in all: the abbey, and six for the six projects. A project is then "at the
windmill", never "at the third lighthouse". The abbey holds About Me; the other six hold one project each, with no
spare, so every one of them must be placed.

| Landmark | Climate | Why there | Site |
|---|---|---|---|
| Abbey | home, temperate | the opening flight | as today |
| Harbour town | home, temperate | the opening flight | as today |
| Lighthouse | the cold coast: taiga or tundra, by the pack ice | a light is for a hard coast | today's rule, on a cape of the cold sea |
| Churchyard yew | temperate, on another island of home's belt | a yew is a tree of wet, mild country | today's rule |
| Ruined cathedral | jungle | a roofless nave is most a ruin where the forest has taken it | today's rule, in the forest |
| Windmill | the Mediterranean | a mill on a dry hill over sage and olives | today's rule, on a rise in open country |
| Old bridge | the steppe | old stone over the one river of the grass | today's rule, on a river of the dry side |

So a lap passes one landmark in every stretch: home's two, the lighthouse at the ice, the bridge and the windmill
down the dry side, the cathedral at the equator, the yew before home. (The first siting had the bridge in the
Mediterranean and the windmill on the steppe; a critic read each one's ground as the other's, and they were
exchanged.) Seven kinds in five climates are told apart by
their ground as well as their shape.

**[Call] A landmark is never dropped.** Each kind is sited in its own climate first. If no ground there passes its
rule, it is sited in the nearest climate that has some, and the build says so; a project is never left without a
site.

Counts no longer scale with area. Today's 27 sites become seven, so most move. The world's id changes with any
re-shipped world, and the projects are assigned afresh: `src/world/sites/assignments.json` is re-pinned from a
build of the new world with the pinned repos.

Weighed and dropped: keeping five of each but varying their form by climate (a visitor still has five lighthouses to
tell apart); keeping two of each (the same, less); and thirteen, with six new churches of the climates (built first
as this design's recommendation, then cut by the owner: commit `967f669` holds them should they be wanted again).

**The story** (on `claude/lore-168547`: `specs/2026-11-18-a-simple-story.md`) has seven keepers, one to a kind. It
asks nothing of the generator, and nothing here follows it.

## 11. Budgets and tests

| What | Budget | How it is held |
|---|---|---|
| Before first flight | about 1.5 MB | `temp` adds about 16 KB; the haze plane about 20 KB |
| Frame | under 4 ms p95 at 4× | nothing new is drawn per frame; `world-fly.mjs` before and after |
| Bake | no slower on temperate tiles; under 15 % slower elsewhere | `world-tile-time.ts` before and after |
| Palette | every existing entry unchanged | a test compares the first 102 materials against the table before this work |

Tests, written before the code they pin:

- **Identity:** cover and scatter with `temp` absent or 0.5 equal the old functions on a sweep of inputs; the golden
  frames of `water-speed.test.ts` do not change.
- **Climate:** fields periodic and in range; temp falls from equator to pole on both sides; the wet side's plateau is
  exactly 0.5; home land is exactly 0.5; the dry side is the drier at every middle latitude; the two sides agree at
  the pole and the equator.
- **Once a lap:** on flat synthetic land the wet route shows no sand, savanna, steppe or garrigue, and the dry route
  no hedge, crop of the temperate fields, taiga or closed warm forest short of the jungle.
- **Gradual:** along any north–south line of flat synthetic land each climatic border is a mixed band at least
  150 cells wide (**[Critic]**: 40 is a tenth of a screen, a line), and it is mixed in clumps, never cell by cell.
- **Sanity:** no crop, hedge or pasture where shift ≥ 60; no crown on snow; nothing but water ids animates.
- **Pack:** `temp` and `arid` round-trip; windows from regions equal windows from the whole; a world without `temp` decodes.
- **Landforms:** nothing moves where the climate is temperate, on water, at a channel or at the shore; no node is
  lowered to its drainage; the change is periodic and deterministic; desert ground is stepped (its heights gather
  on the treads) and a sand sea has ridges.
- **Palette:** the reserved-hue, river and value-mass tests cover the new ids.
- **Painter:** a tile with no floating crown bakes as before; a floating crown never draws under nearer ground.

Look is judged apart from tests: fresh Opus critics on `world:map` overviews and `world:render` close views, before
and after, scored in the look ledger.

## 12. Build order

1. Climate fields, `temp` through pack and bake, tests of identity. The map tool learns to draw cover, so an
   overview shows biomes.
2. The cold family: shift, tundra, taiga, ice, frozen water, pack ice.
3. The warm family on existing crown shapes: Mediterranean skin, steppe, desert with dunes and wadis, savanna, jungle.
4. Floating crowns: palms, acacias, pines, cactus; bergs and mangroves.
5. Settlements by climate; landmark counts to one; the six new landmarks.
6. Haze plane; manifest climate; critics; ledger; roadmap.
7. After the owner's decisions (0): the two sides (curves, `arid`, the dry dress, the warm forest); landmarks back to
   seven, each in its climate; assignments re-pinned.
8. Landforms by climate (6.6).

Each step ends in renders and a commit.

## 13. What is built (2026-11-19)

On `claude/biomes-f95fc9`. Not pushed, not merged; no world is committed.

| Part | State |
|---|---|
| Climate fields: latitude, one pair of curves a side, the wet side's plateau, the wander folded at the pole and the equator, inland extremes, the home rule (`gen/climate.ts`) | built |
| `temp` and `arid` shipped a region, optional and flagged, `arid` only where a region has some; windows; the bake reads both (`pack/`, `bake/window.ts`, `bake/cells.ts`) | built |
| Temperate as the identity: cover and scatter pinned by hash, the home view byte-identical, every older colour unchanged | built, tested |
| The wet side: taiga, the temperate plateau, warm forest closing over the fields, jungle | built |
| The dry side, dressed whole: stony tundra, khaki steppe with wheat and pine groves, sage Mediterranean with olives, cypress and pines, desert with sand seas, gravel, salt and wadis, tiger bush, savanna | built |
| The cold band: tundra with pools and frost polygons, ice cap with drifts and crevasses, plate pack ice, frozen lakes and rivers | built |
| Pictures for palms, acacias, umbrella pines and cactus (`bake/sprites.ts`) | built |
| Landforms by climate (6.6, `gen/landforms.ts`): desert benches, linear dunes, the ice sheet, karst towers, granite domes | built |
| Native land by climate (6.7, `gen/native.ts`): every island outside home grown again for its climate and joined to today's | built |
| Seven landmarks, one of each kind, each in its climate and side, never dropped; hamlets and houses by climate and side; no hamlet on snow | built |
| The wonders' climates | built |
| Haze by climate and side (a plane in the core); manifest `climate` | built |
| The map and render tools: `world:map --view cover|climate --wild`, `world:render --wild --no-gates --temperate` | built |
| Growing each climate's land natively (6.6 B) | built as 6.7, after the owner's decision |
| Bergs on the sea, mangrove crowns in the shallows (6.3 "stamps on water") | not built: mangroves stand on the mud of the shore; no bergs |
| A cold sea and a silty river colour | not built: follow-up (6.5) |
| Fields by climate beyond the Mediterranean and the steppe (oasis plots are built; paddies are not) | partly |
| The six churches of the climates | built, then cut by the owner: commit `967f669` holds them |

Measured on seed 3 at 10240 (2026-11-19, on the native land of 6.7 after the side-by-side scoring, world
`3a2f194713e2`, with `world/bigmap` merged at `19db4c2`):

- **Native land:** of the 43 islands, 20 are taken from the land grown for the climates (six of the ice, three of the
  taiga, one of the dry side's tundra, three of the desert, two of the savanna, five of the jungle) and 23 from
  today's land (home, six temperate, five of the warm forest, five of the Mediterranean, the steppe's, two of the dry
  tundra, three on the equator line, one desert volcano): 6.7 says why each is kept. Land is 30 % of the world. The
  land for the climates takes about 4 minutes to grow and is cached apart; the join, the climate and the landforms
  take seconds on every read.
- **Landmarks and wonders:** all seven landmarks placed in their own climate and side, none let out: lighthouse by the
  pack ice, yew off home, cathedral in the wet side's jungle, windmill in the Mediterranean, bridge on the steppe. All
  nine wonders placed. The six projects hold the six landmarks that are not the abbey (`assignments.json`, world
  `3a2f194713e2`, from a build with the real pinned repos; a second build asks for no change).
- **Nothing lower than before:** every climate, landmark and wonder scored side by side against Fable's last state by
  three fresh critics (look ledger, round 9).
- **Download:** the whole world 8519 KB (9191 before climates); before first flight 1330 KB (1447); the core 803 KB.
- **Identity:** the build's start and abbey frames, as generated and as shipped, are the same files, to the byte, as
  every earlier build's (md5 `9b28eb…`, `b3064c…`, `4af97f…`, `99b54d…`).
- **Bake** (`scripts/world-climate-cost.ts`: the same tiles of this world built with its climates and as a temperate
  world, in turn, warm; three runs at load averages of 3 to 8): a tile whose every climate node is on the wet side's
  plateau costs what it did (+1 to 2 %); any other tile 53 to 54 ms against 39 to 40, **+34 to 37 %**, over the 15 %
  this design set in section 11. The painter's chunk over cached tiles costs the same (7.6 ms against 7.7). The bake
  runs in workers; it is the time to a full view, not the frame.
- **Frame:** nothing new is drawn per frame. Measured on the earlier native world (`3389a57cc203`): `world-fly.mjs`
  on a quiet machine, in turn with a build of `world/bigmap` at `0aef5c8` on its own world, three pairs: at 4×
  throttle the base's p95 ran 3.9, 4.1 and 4.0 ms and this branch's 4.2, 4.1 and 3.8; at 1× 2.1 to 2.5 against 2.3 to
  2.6. The two cannot be told apart, and both sit on the 4 ms line. Not measured again on this world: the changes
  since are to land, cover and siting, which the frame does not read.
- **Tests:** 1571, all passing; types and lint clean. `npm run build` passes with the real pinned repos and without a
  token.

Critic scores and what each round changed are in the look ledger ("Climate rounds").

## 14. Follow-ups

- Banded winds for moisture: trades in the tropics, westerlies beyond, mirrored across the equator (5.4).
- Polar sea and silty river colours, once the live-layer sessions merge.
- Life by climate: no rain showers over deserts and ice (the live rain has no land check today); animals of each
  biome; burn scars and smoke on the savanna.
- Black sand on the volcanic islands of the tropics; tidewater glaciers calving in the polar fjords.
- Islands grown for their climate (atolls and reefs in the tropics, more fjords in the cold): a plan-stage change and
  a new seed search.
- The larger world, as its own step, if the owner wants it after seeing the biomes.
