# Wonders and a larger map: design

Status: owner said "build all of it... and the larger map" (2026-11-18), after the list of rare structures in the
roadmap. The calls marked **[Call]** are Claude's; the owner can overturn any of them.

## Why

The owner wants wondrous buildings in the spirit of the bathhouse in *Spirited Away* and its railway across the sea:
places that make a flight feel like a discovery. The owner also wants more world to find them in.

## Goals

- Twelve **wonders**, our own designs in the world's European, church-built setting: none of a film's buildings,
  names, characters or spirits, and no pagan or occult motifs (CLAUDE.md).
- Each wonder is a place, hidden somewhere its land suits it and logged as a discovery when first seen. Most also have
  a **moment**, a short live event at that place on its own clock, also logged when witnessed.
- A **larger world**: more islands at today's scale, not today's islands magnified.
- The budgets stand: interactive in about 2 s and under 4 ms a frame on a mid-range laptop. A bake worker may not
  hold the whole world.

## Non-goals

- Time of day, so no "lit at dusk" moments yet. Those come with the time-of-day work.
- Title menu wording (the owner has three option sets and hasn't picked).
- Re-tuning the land's look. The larger world reuses the 6400 world's parameters, so the look should carry over;
  renders check it.

## The wonders

| Wonder | What stands | Where it goes | Moment |
|---|---|---|---|
| Thermal baths | Domed bathhouse stepped down a sea cliff in terraced pools, with a quay and a funicular | A south-facing sea cliff 12–35 high | Steam always; now and then a ferry calls at the quay |
| Tide railway | A single track on low trestles running out across the shallows to a lone halt (lamp, bench, name board) | The widest shallow flat between two shores | A two-carriage train glides along it |
| Drowned church | A bell tower standing out of a lake, with ruined walls under clear water | A lake at least 120 cells across | Ripples ring the tower, and a flock rises from it |
| Hotel in the cove | A white hotel on a rock in a sheltered cove, with a seaplane pontoon | A cove opening south, with a rock offshore | A seaplane lands, taxis in and moors |
| Floating garden | A small island with trailing roots, a ruined cloister and an orchard | Live only: drifts high over the sea with the high clouds | It is the moment: seen only now and then, over a cloud bank |
| Marsh house | A shuttered house on a rise in an estuary, with a causeway | An estuary or delta | A lamp in one window, and a cart on the causeway |
| Airship mast | An iron mooring tower on a headland | An exposed headland | An airship rides at the mast |
| Land-ship | A sailing ship on wheels | Live only: the widest sands | It sails along the sands |
| Bridge town | Houses and shops along an old stone bridge | A river 3–12 wide, near farmland | Carts and boats pass |
| Great oak | One enormous tree, taller than a spire, with a treehouse and a swing | A rise above a village | Leaves stream off it in a gust |
| Observatory | A domed observatory | The highest summit that is under the height cap | The dome turns and opens |
| Clock automata | (The town's bell tower) | The town | On the hour, carved saints file out and round |

**[Call] Baked or live.** A wonder that stands is baked, like the abbey and the lighthouse: a `Structure` from a
builder in `gen/`, sited by the generator and listed in the manifest as `wonders` (separate from the project
landmarks, which carry repos). The floating garden and the land-ship are live sprites only. Every moment is a live
layer.

**[Call] Rarity.** A moment runs on its own clock: one appearance in every 3–8 minutes at a seeded moment, lasting
20–60 s. It shows only when its wonder is in view, so a visitor mostly meets it by luck. That is the same scheme as
`live/rare.ts`, more often because you have to be there. `?sights=all` previews every moment.

**[Call] Siting.** Wonders are placed after the landmarks, most constrained first, never within 600 cells of a
landmark or another wonder. A wonder whose land is missing is skipped and named in the build log. It is never forced.

## The larger world

**[Call] 10240 × 10240 cells.** That is 2.56× today's area, and a lap at cruise takes 171 s. The size must be a
multiple of 1280, so that the 256-pixel chunks and the 256 blue-noise mask tile both across and down (0.8·n); 9600
fails this.

**[Call] More world, not a bigger copy.** `paramsFor(n)` today scales every length by n / 6400, which magnifies the
same islands. Above 6400 it will keep lengths at the 6400 scale and multiply island counts by the area ratio:

| Islands | Count |
|---|---|
| Highland | 2 |
| Home | 1 |
| Lakes | 3 |
| Slate | 2 |
| Karst | 5 |
| Skerries | 13–18 |

Landmarks scale the same way: one abbey and one town; five each of lighthouses, bridges, cathedrals, windmills and
yews. Site spacing stays 1500 cells. Worlds of 6400 and below are unchanged, byte for byte.

**[Call] Workers hold a window, not the world.** The file splits into:

- a **core**: manifest, meta, vectors and the small fields;
- **region tiles** of 1280 × 1280 cells, 64 for the 10240 world, each carrying that region's grids.

A worker fetches and decodes the tiles a chunk needs, plus its apron, and keeps a small cache of them. A chunk
baked from tiles must be byte-identical to one baked from the whole world. That test decides the seam; the seam itself
is chosen after mapping what the bake reads.

**Budgets.**

| What | Budget |
|---|---|
| Before first flight (core and start tiles) | ≤ 1 MB |
| Whole world | ≤ 10 MB |
| One worker's decoded tiles | ≤ 40 MB |
| Frame | unchanged |

## Who builds

- **Data path (Cursor, test-pinned):** window bake, tiled format, worker tile cache and streaming. Claude writes the
  tests.
- **Generator scale and the 10240 build (Claude):** small code, judged on renders.
- **Wonders, their siting and moments (Fable):** in rounds of three or four wonders, judged on renders and live
  strips. Iterated on the 6400 world, then re-sited on the larger one.

## Order

1. Generator scale, then generate a 10240 world and judge it.
2. In parallel, the data path, then the wonders.
3. Ship the 10240 world with the wonders.
4. Run the browser check (ready time, frame time, memory). Merge.
