# Look ledger — render-critic rounds

Each round: renders at 6400 (seeds 42 and 7, six auto viewpoints each, 400×225 at 1× and 3×), two independent Opus critics on the design's 10-point rubric (5.7), the lead's own read, and what changed next.

| Round | Date | Critic means (/4) | Worst problems (consensus) | Changes for next round |
|---|---|---|---|---|
| 1 (bake stand-in look) | 2026-11-17 | lead only | peaks to 180 → giant tan south walls; straight streaks for rivers on steep faces; uniform forest; beaches everywhere | land pipeline (cap 128, talus); real cover/palette; vector rivers |
| 2 (real cover, palette, vector rivers) | 2026-11-17 | 1.78, 1.56 | 1. land unlit — no relief reads; 2. rock/snow as height bands, grid hatch, coral snow edge; 3. Voronoi fields with ink, comb streams with single-file trees, ink on forest edges | bake: strong hillshade with warm/cool split and coloured shadow, shaded snow, fall-line hatching, ink only at form breaks + coastlines, watery rivers, comb-stream filter, paper grain; cover: contour-strip parcels on gentle ground, rock/snow by slope and aspect, scree fans, scatter tells removed |
| 3 (light, fall-line hatch, coast ink, teal rivers, sea wash, paper; coast stage) | 2026-11-17 | lead only | rivers saturated plastic cyan; rock still lavender domes; heather airbrushed; fields still Voronoi (cover fixes in flight); no structures yet | bake: watercolour rivers, cell-size coast stamps, oxbows, wood-edge AO, gates measured, tile speed; cover: rock/snow by slope+aspect, contour fields, scatter tells; coast: natural coves, varied shelf; new: sites, settlements, landmarks, roads |
| 4 (watercolour rivers, cell-size coast stamps, wood-edge shade; cover fixes; coast round 2) | 2026-11-17 | 2.0, 2.0 | 1. grey rock blanket on smooth steep faces, ticks as fill, no scree; 2. snow as a fog band with dithered edge, white ribbon under crests; 3. donut oxbows, sine meanders, ditch-grid and comb streams, tin-can stacks | bake: fall-line gully micro-relief, remove crest ribbon, warm/cool rock, ticks only on cliffs, turfed stacks, depth-based shallows; cover: rock only on cliffs/high exposed ground, crag bands, scree fans, couloir snow with clean edges, wet-meadow floodplains; rivers: rare crescent oxbows, varied meanders, noisy minor streams, no combs. (Gentler talus tried and reverted: no effect on the domes.) |
| 5 (gullies as geometry, cliff-only hatching, depth shallows, buff/violet rock; rock only on cliffs, crag bands, scree fans, couloir snow, wet-meadow floodplains; rivers: rare crescent oxbows, varied meanders, no combs; settlements and landmarks) | 2026-11-17 | 2.3, 1.9 (landmarks now scored: 2.5, 3) | grey slabs gone; critics' consensus: 1. steep faces read as static (per-pixel stipple, ink-coloured scree dashes, barcode heather stripes) or smeared planes; 2. mountains have no skeleton under a blanket of snow (no ribs, arêtes, crest ink; comb snowline); 3. coasts are one stair-stepped beach ribbon with scallop headlands and cream voids; also ruler-straight crests/forest edges along roads, star confluences, town lacks lanes, quay slab; heather on steep spurs in regular vertical stripes; snowfields still large and soft; some G-resolution stair-steps on coasts; scree fans rare (few true cliffs); oxbow/bar polygons not yet filled by the bake | next: heather streak variation, snow structure, coast stair-steps at cell size, oxbow/bar fill, bake tile speed (~20 ms), critic pass on round 5 |
| 6 (cover reads smoothed form, scree fans, crest-shedding snow, dune/saltmarsh; bake: depth sea, crest ink through snow, snow lit from normals, smooth sand, ponds/bars, turfed stacks; coast: beach width by bay shape, smooth waterline, cliff-back crease fixed) | 2026-11-17 | 2.1, 2.1 | plateau: coasts, sea, lowlands and the town are praised; the mountains now fail at the LAND level — straight crest walls with periodic domes, evenly spaced parallel gullies, flat ice-cap plateaus, contour tree belts; snow reads as bare paper; straight-edged triangular deltas and bars; crater-ring tarns; diagonal light streaks; no three value masses | next: generator-level mountain form (domain-warped ridge axes, saddles and spurs, stream-power incision into the range for branching couloirs, talus cones); cirque tarns open downslope; curved, drift-built bars and spits with flow-split distributaries; snow wash distinct from paper; value-mass palette pass; bake speed (279 ms per cold chunk on seed 3) |
| 7 (mountains: ridge-network uplift, threshold slopes, rockfall scree; water: curved distributaries, lobed deltas, drift spits, cirque tarns sited by their headwall; paint: blue-white snow, coloured darks, seamless relief light, even crest ink, paper flecks, faster noise) | 2026-11-17 | 2.7, 2.6 | best yet; 7 of 10 criteria at 3 for the first time (water, rivers, coasts, cover, region, landmarks, paint for one critic). Consensus worst: 1. snow pools in valley floors and gullies while summits stay bare; scree reads as tick-mark noise; 2. upland faces combed (forest strip in every gully at equal spacing) and airbrushed olive/mauve, blank moor slopes, hard crest tree lines; 3. cliffs are a picket fence of vertical strokes with no strata or foot; streams as white scratches | next: snow by height above snowline + shade − flow accumulation (caps on crests and cirques); pale talus fans; copse mask instead of gully strips, bracken/gorse texture on moors; cliff bedding bands, fissures, wet foot, shingle apron; streams as dark water lines; star confluence at the bridge site; duplicate ruin/chapel sprites |
| 8 (crest snow, debris scree, copse woods, moor texture; bedded cliffs with shingle feet, shaded streams, curved banks, arête ink; varied ruins/churchyards, single-reach bridges, town lanes, stone harbour, approaches) | 2026-11-17 | 2.6, 2.6 | plateau at ~2.6. Lowlands, estuaries and the harbour town read as storybook; peaks still read as airbrushed relief. NOTE the snow advice flipped: round 7 critics wanted snow off valley floors and onto crests; round 8 critics say crest "icing"/white piping is wrong and snow should fill cirques and hollows at altitude with steep crests bare — the right rule is altitude-dominated, concavity-weighted, steep-shed, never in low valleys. Also: lip ink across meadows reads as fences while skylines have none; white-bar waterfalls; cliff band one uniform height; full-width biome seam in seed 1 random; rectangular harbour basin; stair-step river edges; little watercolour/paper quality | next: snow rule as above; scree fans at cliff feet via flow; cliff height from local relief; tapered teal waterfalls with spray; ink skylines and summits, drop low-break lip ink; noise-warped biome thresholds; organic harbour basin; watercolour pass (three value steps, pigment pooling at edges, paper grain over land and sea) |
| 9 (altitude snow with couloir tongues and bare crests, fall-line scree, warped biome boundary, European karst; watercolour washes with pooled edges, paper grain, cream lit slopes, skyline ink, tapered falls, bedded mountain rock; varied cliff heights, rounded harbour, varied houses and green belt, terrain-following roads, coast-framed sea sites) | 2026-11-17 | 2.8, 2.8 | best yet; both critics give 3 on 8 of 10 criteria (ink economy and paint up to 3). "A visitor would find the coasts, town and sea genuinely beautiful at first glance"; peaks still the weakest (flat posterised snow shapes with no arête modelling, vertical column striping on walls, pinwheel scree). Also: harbour basin closed with no mouth to the sea; upland palette drab olive/khaki with mauve stripes; straight plateau rim + crest tree belt in seed 1 random; staircase/canal trunk river in seed 3; keyhole coves and equal cliff scallops repeat; stacks with no surf base | next: snow and rock lit from true normals with arête crests and cool far sides, strata noise across walls; harbour mouth; fresher upland greens, heather only on exposed spur crests; headward re-entrants to break straight rims; smoothed river centreline rendering with depth falloff |

## 10240 polish rounds (2026-11-18, `terrain-polish`)

The 10240 world, seed 3, in 14 fixed views: three peaks, three upland slopes, a cove coast, stacks, the town, two fens in game and from above on the overview map, and a lake. Each round a fresh Opus critic scored the world as it stood at the start (BEFORE) and after the round (AFTER), on four axes (0–10) and the brief's six problem areas (0–4). The critic changes each round, so compare within a row.

| Round | Perspective | Depth | Quality | Detail | Peaks | Fens | Harbour | Uplands | Coast | Lakes | Changes in the round |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 6 → 6.5 | 5 → 6 | 4.5 → 5.5 | 4.5 → 5.5 | 1 → 2 | 1 → 2 | 2 → 3 | 1 → 2 | 1 → 2 | 1 → 3 | snow lit by its true normal; beds and lit ledges on walls; heather on crests; greener moor; fens closed, on a peat floor, with meres and 80-cell flats; lone lake shoals evened; coves and notches vary; stack surf rings; harbour mouth and fairway |
| 2 | 6 → 7 | 4 → 6 | 4 → 6 | 5 → 6 | 1 → 2 | 0 → 2 | 1 → 3 | 0 → 3 | 1 → 2 | 2 → 3 | lilac hollows in snow; snow and rock in ledges across faces; hatching along the contour; heather only on tops and crests; fen saltmarsh; deeper headland shoals |
| 3 | 6 → 6.5 | 5 → 6.5 | 5 → 6 | 4 → 6 | 1 → 2 | 0.5 → 2 | 2 → 3 | 1 → 2.5 | 1 → 2 | 1.5 → 3 | a floor of shade on snow faces turned from the sun; rock shade compressed so beds carry a face; reed beds; basin as deep as the sea; lake beds evened round islet nodes |
| 4 | 6 → 7 | 5 → 6.5 | 5 → 6 | 4 → 6 | 1 → 2 | 0 → 2 | 1.5 → 3 | 1 → 2.5 | 1 → 2 | 2 → 3 | soft snow terminator, no ink seams inside snowfields; irregular ledges; taller headlands, lower bays |
| 5 | 6 → 6.5 | 5 → 6.5 | 5 → 6.5 | 4 → 6 | 1 → 2 | 0 → 2 | 2 → 3 | 1 → 3 | 1 → 2 | 1 → 3 | sparser ledges; more lilac in lit snow; no keyhole coves; rarer heather; ochre reeds. Sea lavender flecks were then dropped (critics read them as magenta specks). |

Consensus left after round 5: a snow massif parts along one line rather than one per arête, and lit snow is plain; walls keep a faint pleat of ribs under their beds, and beds on rounded headlands read as onion rings; scree is almost absent at 10240; fens drain through a dense branching web (needs a fen-aware channel threshold); equal half-dome headlands between stream notches; stacks are smooth cylinders; sites painted into the land (a lighthouse pad cut down a cliff, a road down a cliff face, a ley cell on the town quay).


## Climate rounds (2026-11-18 to 19, `claude/biomes`)

The 10240 world, seed 3, with climates (`specs/2026-11-18-biomes-and-climate-design.md`), on the whole-world overview
in cover colours (`npm run world:map -- --view cover`) and sixteen fixed close views of wild land (`npm run
world:render -- --wild --views none --no-gates --at …`; `--temperate` draws the same places as they were). Round 1 was
judged by two fresh Opus critics: an art director scoring each biome 0–4 on Reads (a visitor names it from one frame),
Style (the same hand as the temperate look) and Craft (free of artefacts), and a geographer scoring the overview as a
globe and each border between climates 0–4. Rounds 2 and 3 are the lead's own passes on their findings; they have not
been scored by a fresh critic.

**Round 1, as first built (art director).**

| Biome | Reads | Style | Craft | What the critic saw |
|---|---|---|---|---|
| Ice and pack | 4 | 2 | 1 | Unmistakably polar; floes as evenly inked tiles, the cap one flat value, periwinkle meltwater |
| Tundra | 3 | 2 | 1 | Right ground; a grey dead band at the snowline, pasted pale patches |
| Taiga | 2 | 3 | 2 | Temperate forest with browner glades; no dark spruce mass |
| Mediterranean | 2 | 2 | 2 | Good maquis; large lilac fields and a rust square |
| Steppe | 2 | 3 | 2 | Good relief and dry colour; slate-lilac north faces read as dusk |
| Desert | 2 | 3 | 3 | Clean washes, lovely wadi palms; the view held little open sand |
| Savanna | 4 | 2 | 1 | Acacias name it at once; stamped as a uniform carpet, hard red blots |
| Jungle | 3 | 2 | 1 | Rich coast canopy, too saturated; lollipop emergents and bare scabs inland |

The world as a whole, before → after: Variety 3 → 8, Depth 7 → 6, Quality 7 → 5, Detail 6 → 7. The home view was
judged unchanged (and is, byte for byte).

**Round 1 (geographer).** The overview as a globe 2 of 4: the order of belts is right on both sides, but the pack was
a ruled stripe, deserts met jungle with nothing between, and savanna, steppe and desert all read as one tan. Borders:
ice/tundra 1, tundra/taiga 2, taiga/temperate 3, temperate/Mediterranean 2, Mediterranean or steppe/desert 2,
desert/savanna 2, savanna/jungle 1. Silly mistakes named: a liquid crater lake inside a snow cap, spruce against the
ice edge, river bars of sand on the ice, pale wadis that read as roads, acacias on steep banks.

**Round 2 (changes).** The pack fused deep in, drawn apart at its edge, with leads all one way; quiet lake and river
ice; late snow in the cold as patches of snow, not fellfield; acacias in open parkland, off banks and crests, in three
widths; pines rare and only short of the tropics, cloud forest above the jungle in its own crowns; the savanna's
forest line read at the sea; garrigue only at the heather's heart; quieter earths; lichen and frost polygons lower in
contrast.

**Round 3 (changes).** Home at 56° north, so its reach south ends in the Mediterranean; wider wander of the isotherms
and of the pack's edge; a longer rise of rain to the equator, a wider dry core, a greener savanna; forest and grass
run into each other both ways; water freezes by height as well as latitude; bars keep the climate's ground; the tundra
treeless; spruce and the cold's dress sooner; darker wadis; less thorn on gravel.

**Round 3, scored by a fresh critic** (one critic, art and geography together; a different critic from round 1, so
compare with care).

| Biome | Reads | Style | Craft | What the critic saw |
|---|---|---|---|---|
| Ice and pack | 3 | 2 | 1 | The cap reads; the pack's leads were a field of same-slant squiggles; dashes all over the ice |
| Tundra | 3 | 2 | 1 | Olive and rust work; hundreds of pond dots are speckle; stepped lake ice |
| Taiga | 3 | 3 | 3 | The strongest new biome: dark conifer masses on tawny ground |
| Mediterranean | 2 | 3 | 2 | Too green to tell from temperate; spike-topped clumps repeat |
| Steppe | 2 | 2 | 2 | Reads as dry; no grass texture |
| Desert | 2 | 3 | 2 | Dunes too faint to see; the palm-lined river is good |
| Savanna | 3 | 2 | 1 | Acacias read; pink dots (termite mounds), lone round bushes, banded scrub like eyelashes |
| Jungle | 4 | 3 | 3 | A convincing canopy; lime ridge highlights near a game green |

The world as a whole, before → after: Variety 3 → 7, Depth 5 → 5, Quality 6 → 4, Detail 5 → 6. The overview as a
globe 2 of 4. Borders: ice/tundra 2, taiga/temperate 2, temperate/Mediterranean 3, steppe/desert 2, desert/savanna 2,
savanna/jungle 3. Verdict: fit to show as a first version if it is said plainly that only taiga, jungle and the
unchanged temperate look are close to finished.

**Round 4 (changes, not yet scored).** Few, long leads in the pack and its edge in continental lobes; a lake freezes
whole; pools in fields, rounded, a few cells across, and frost polygons only on the wettest flats; crevasses rare;
dunes half as tall again, wider apart and full-bodied; termite mounds rare and browner; forest islands larger; less
thorn in the bands; the Mediterranean's dress sooner and to straw, cypress rarer; a calmer green by a desert river;
lower jungle crowns and a quieter emergent.

**Round 5 (2026-11-19: the owner's decisions, and landforms).** The climates no longer mirror about the equator:
the route through home is the wet side (taiga, temperate, warm forest, jungle) and the other the dry side (stony
tundra, steppe, Mediterranean, desert, savanna), so a lap meets each climate once. New looks: the warm forest (woods
closing over the temperate fields, slopes first, evergreen crowns with the jungle's coming in); the steppe as its
own country (khaki grass, wheat, pine groves, grey-green bushes, green only by water); the Mediterranean in sage
with garrigue in patches and fewer pines; a hotter, drier desert core (2 % of the land on the first curves, 5 %
after); warm sandstone in place of slate on desert hills. Landforms by climate over the grown land: desert benches
with red scarps, dune ridges on the sand seas, an ice sheet filling hollows, karst towers in the jungle, rock domes
on the savanna. Seven landmarks, each in its climate: lighthouse by the pack ice, yew off the home island, ruined
cathedral in the jungle, bridge in the Mediterranean, windmill on the steppe.

**Round 5, scored by a fresh critic** (one Opus critic, art and geography together, on the overview before and
after, five sheets of labelled close views and a sheet of the same places before climates; a different critic from
rounds 1 and 3, so compare with care).

| Biome | Reads | Style | Craft | What the critic saw |
|---|---|---|---|---|
| Ice and pack | 3 | 3 | 1 | Dark dashes all over the ice, stray ink strokes, straight lines through the floes |
| Tundra | 2 | 3 | 2 | The view was an alpine snowfield over conifers, not tundra |
| Taiga | 2 | 3 | 2 | Rust-brown slopes under lavender snow read as autumn or desert; the coast view names itself |
| Temperate | 4 | 4 | 3 | Unchanged and good |
| Warm forest | 1 | 4 | 3 | The temperate look a shade darker |
| Jungle | 3 | 3 | 2 | Pale grey cones in the canopy like tents (the towers' limestone); tonal steps in the canopy |
| Savanna | 2 | 3 | 2 | Red squiggle stamps evenly over the slopes; dark clumps, no flat-topped trees on the hills |
| Desert | 3 | 2 | 1 | Green ribbons in every valley, trees on the sand, lavender-grey washes that look dirty |
| Mediterranean | 1 | 4 | 3 | Green hills with tan stripes: a visitor would call them temperate |
| Steppe | 3 | 3 | 3 | Too many trees for open grassland |

The world as a whole, before → after: Variety 2 → 7, Depth 5 → 6, Quality 7 → 5, Detail 6 → 6. The overview as a
globe 2 of 4: the two sides do read as different (green wet above the equator, khaki and orange dry below), but the
middle climates run together; the taiga's dark green and the jungle's read as one forest twice; the rust of the
polar islands as a second desert; the sea ice and the clear tropical sea as two latitude bands that ignore the
land. Landforms: benches and scarps 3 of 4 ("red badlands"), dune ridges 1, karst towers 1 ("darker bumps, no
height"), ice sheet 2. Landmarks: abbey, town and lighthouse strong; cathedral small and pale; the bridge's ground
read as steppe and the windmill's as Mediterranean; the yew weakest, a dark blob by a building.

**Round 6 (changes on round 5's findings, not yet scored).** The Mediterranean has its own sage sward (three new
materials, greyer and paler than any temperate green), white limestone for its crags, opener woods and a lighter
maquis; the warm forest has palms in its clearings and along its shores; the desert's gravel shades warm, sand and
gravel carry a third of their bushes, and only a real river greens its banks; crevasses rare, pale and only on
steep ice; the savanna's red earth rare and off the banks; the steppe a sixth of its bushes; a field's grass in dry
country is sage, not a temperate green; less russet in the tundra; the pack ice reaches further over a shelf and
less over deep sea, so its edge follows the land more; dune ridges closer set; towers a little taller. The windmill
now stands in the Mediterranean and the bridge on the steppe, as the critic read their grounds. Not answered: the
yew's own drawing; towers and dune ridges that read at a glance (towers want to be drawn at cell size, as sea
stacks are); the taiga's and the jungle's greens on the overview; tundra on level ground in a close view.


**Round 7 (2026-11-19: native land, spec 6.7), scored by a fresh critic** (one Opus critic, art and geography and
geomorphology together; overviews of the temperate world, the climates on the old land and the native land; sheets
of each climate's island inland, on its coast and on its high ground, the landforms and the landmarks). Four scores:
Reads, Land (the relief and coast belong to the climate), Style, Craft.

| Biome | Reads | Land | Style | Craft | What the critic saw |
|---|---|---|---|---|---|
| Ice | 4 | 2 | 2 | 2 | Ridged mountains with valley glaciers, not a domed sheet; flat fills and floes |
| Tundra | 1 | 2 | 3 | 3 | The dry side's tundra is the steppe's khaki, with conifer stands |
| Taiga | 1 | 3 | 2 | 1 | No boreal forest in any frame: half snow, the coast all snow; lines across the pack ice |
| Temperate | 4 | 4 | 4 | 3 | The great oak upstages the yew |
| Warm forest | 1 | 3 | 4 | 3 | The temperate palette and canopy |
| Jungle | 4 | 2 | 3 | 3 | No coastal plain: steep hills to the water |
| Savanna | 2 | 3 | 2 | 2 | Its biggest island is closed canopy |
| Desert | 4 | 3 | 3 | 2 | Flat facets with ruler-straight edges on the benches |
| Mediterranean | 1 | 2 | 3 | 3 | The desert's palette, no maquis or olive |
| Steppe | 3 | 3 | 3 | 2 | A snowfield in the middle of the plain |

The world, temperate → climates → native: Variety 3 → 6 → 7, Depth 4 → 4 → 6, Quality 7 → 4 → 5, Detail 6 → 6 → 7.
The globe 2 of 4: the sides differ broadly, but four dry climates share one khaki; the polar belt reads as a stripe;
the geography differs by climate in places (fjords, a ria bay, desert cuestas, flat steppe lowlands), elsewhere the
belts' parallel ridges are the temperate recipe repainted, and the volcanoes come back where they were. Landmarks:
abbey and town the best of the pack; the windmill reads as a second lighthouse; the yew barely registers; the bridge
weakest. The home island matches the climates' overview to 0.1 %.

**Round 8 (changes on round 7's findings).** The dry side's savanna reaches nearly to the equator; the
Mediterranean's crags are limestone, sandstone only toward the desert; the dry side's tundra is stone and lichen with
no trees, and its snowline stands 12 units higher (no snowfield on the steppe); the pack's long leads are gone and
its edge pulled back; the warm forest takes the jungle's brighter crowns early. Land: the taiga is a low lake-studded
shield under its tree line, with fjords; plains are one broad belt, not parallel ridges; cones and calderas of dry
country stand as mesas; the ice sheet fills its hollows to a dome; karst towers stand in clusters, larger,
flat-topped and of many heights; benches softer at their edges.

ROUND8SCORES

Consensus left: the borders the tests hold to 150 cells are measured on level ground; one south-west wind puts rain
on the same side of every island, where a globe has trades and westerlies; the open polar sea and the polar shallows
are the temperate blue and turquoise (a cold sea colour is a live-layer change); the jungle's coastal plains are cut
into hills by its rain; some building kinds (a slate-roofed hall with silos) are not dressed by climate.
