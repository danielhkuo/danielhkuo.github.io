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
- Changing how the land itself is grown. Erosion, coasts and rivers stay as they are.

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

   | Dry side, φ | 0 | 0.08 | 0.22 | 0.30 | 0.46 | 0.56 | 0.62 | 0.72 | 0.84 | 0.94 | 1 |
   |---|---|---|---|---|---|---|---|---|---|---|---|
   | temp | 1 | 0.97 | 0.88 | 0.82 | 0.70 | 0.58 | 0.50 | 0.40 | 0.28 | 0.142 | 0.02 |

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

| Dry side, φ | 0 | 0.06 | 0.10 | 0.16 | 0.22 | 0.27 | 0.30–0.44 | 0.50 | 0.58–0.64 | 0.74 | 0.84–0.94 | 1 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| rain | 1.7 | 1.55 | 1.2 | 0.9 | 0.62 | 0.36 | 0.28 | 0.42 | 0.55 | 0.5 | 0.55 | 0.5 |

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
| Jungle | both, one band over the equator | wet 0–0.31, dry 0–0.10 | heat and rain enough for closed forest |
| Savanna | dry | 0.10–0.24 | grass country in the latitudes with a dry season |
| Desert | dry | 0.26–0.46 | aridity under 0.20; thorn and thin steppe at its edges |
| Mediterranean | dry | 0.46–0.62 | the dry dress on the warm side of the plateau's temperature |
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
| **Warm forest** | The temperate fields and pastures, shrinking to clearings as the woods close over them; a dark evergreen floor | glossy evergreen crowns, larger and darker than home's woods, the jungle's own coming in toward the tropics; palms along the shore | Rock and rivers as temperate; pale sand; the clear sea begins |
| **Mediterranean** | Sage sward and pale stony earth; lavender-grey garrigue on the tops; straw meadow | umbrella pines, cypress spires, olive, shrub thickets; vines and wheat in the fields | Pale stone; white coves; turquoise shallows (the existing clear sea) |
| **Steppe** | Straw-olive grass that waves in the wind; bare earth patches | sage bushes; poplars by rivers | — |
| **Desert** | Sand seas with real dunes (low relief added in the bake, so they shade and cast shadow) in lobed patches a few hundred cells across; darker gravel plains between; salt on the flattest basin floors | thorn bushes, in contour bands toward the savanna (tiger bush); columnar cactus on rocky ground; palms and a green strip only by water | Banded ochre sandstone; bare dunes to the shore; small streams are dry wadis, big rivers keep their water and a ribbon of green |
| **Savanna** | Golden grass with red-earth patches and worn tracks | flat-topped acacias, wide apart, thicker toward the jungle; termite mounds; gallery forest on rivers | Waterholes with a green rim |
| **Jungle** | Dark understorey, seldom seen | closed canopy of large crowns in four greens, emergent giants, palms at every edge | Mossy rock; palm beaches of pale sand; mangrove on sheltered muddy shores; turquoise shallows |

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
  marsh house off tundra and jungle. The baths prefer cold country; the hotel prefers warm.

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
| Old bridge | the Mediterranean | old stone over a summer river | today's rule, on a river of the dry side |
| Windmill | the steppe | open grass and wind | today's rule, on a rise in open country |

So a lap passes one landmark in every stretch: home's two, the lighthouse at the ice, the windmill and the bridge
down the dry side, the cathedral at the equator, the yew before home. Seven kinds in five climates are told apart by
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

Each step ends in renders and a commit.

## 13. What is built (2026-11-19)

On `claude/biomes-f95fc9`. Not pushed, not merged; no world is committed. This section describes the first build,
which mirrored the climates about the equator and placed thirteen landmarks; it is rewritten when step 7 of the
build order lands.

| Part | State |
|---|---|
| Climate fields: latitude, the curve with its plateau, warp, inland extremes, the home rule, rain by zone (`gen/climate.ts`) | built |
| `temp` shipped a region, optional and flagged; windows; the bake reads it (`pack/`, `bake/window.ts`, `bake/cells.ts`) | built |
| Temperate as the identity: cover and scatter pinned by hash, the home view byte-identical, every older colour unchanged | built, tested |
| The cold family: taiga, tundra with pools and frost polygons, ice cap with drifts and crevasses, plate pack ice, frozen lakes and rivers | built |
| The warm family: Mediterranean dress, steppe, desert with sand seas and real dunes, gravel, salt, wadis, tiger bush, savanna, jungle | built |
| Pictures for palms, acacias, umbrella pines and cactus (`bake/sprites.ts`) | built |
| One landmark of each kind, in its climate; hamlets and houses by climate; pads keep the climate's ground | built |
| The six new landmarks and the wonders' climates | built: drawn by an Opus agent to this design's silhouettes, judged on renders by the lead; first drafts |
| Haze by climate (a plane in the core); manifest `climate` | built |
| The map and render tools: `world:map --view cover|climate --wild`, `world:render --wild --no-gates --temperate` | built |
| Bergs on the sea, mangrove crowns in the shallows (6.3 "stamps on water") | not built: mangroves stand on the mud of the shore; no bergs |
| A cold sea and a silty river colour | not built: follow-up (6.5) |
| Fields by climate beyond the Mediterranean (oasis plots are built; paddies are not) | partly |

Measured on seed 3 at 10240 (2026-11-19):

- **Land by cover:** about 15 % jungle, 15 % snow and ice, 10 % tundra, 9 % steppe, 7 % savanna, 2 to 4 % desert; the
  rest temperate, Mediterranean and taiga. All thirteen landmarks and all nine wonders are placed.
- **Download:** the whole world 9368 KB (was 9191); before first flight 1485 KB (was 1447); the core 979 KB.
- **Identity:** the build's own check of the start and abbey views gives the same shares to six figures as the world
  shipped today; the home view and a temperate hillside elsewhere render byte-identical with and without climates.
- **Bake:** a tile whose every climate node is on the plateau is built as a temperate world's is. Elsewhere a tile
  costs about 40 % more on average (62 ms against 43 in Node, under load), most in jungle, sand seas and pack ice.
  That is over the 15 % this design set itself in section 11; the bake stays above one chunk a second in the browser.
- **Frame:** nothing new is drawn per frame. `world-fly.mjs` against a build of the base, in turn, on a machine other
  sessions were loading (load average 8 to 16): at 4× throttle the base's p95 ran 3.7 to 5.1 ms and the new build's
  4.1 to 5.2; the new code over the old world, whose frames are byte-identical to the base's, ran 4.2 to 5.8. The test
  could not tell them apart that night. It wants a rerun on a quiet machine before the world ships.
- **Tests:** 1066, all passing (the dragon's timing test fails under load and passes alone); types and lint clean.

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
