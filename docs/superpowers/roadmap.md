# Dragon world: roadmap

The one list of what is done, what is next, and every idea not built yet. Update it when something finishes, is decided or
is dropped. Details live in the documents it links; this page says what and in which order.

Last updated 2026-11-18.

## Where things are written down

| What | Where |
|---|---|
| What the site is becoming, and the rules every change follows | `.claude/CLAUDE.md` |
| Terrain design (approved) | `docs/superpowers/specs/2026-11-16-dragon-world-terrain-design.md` |
| Plans, one per piece of work | `docs/superpowers/plans/` |
| Look rounds: critic scores and what changed | `docs/superpowers/research/2026-11-17-look-ledger.md` |
| Bake speed gate | `docs/superpowers/research/2026-11-17-bake-gate.md` |
| This roadmap | `docs/superpowers/roadmap.md` |

## Done

- **Terrain**, nine look rounds, critics at 2.8 of 4. Coasts, the town and the sea read as beautiful; peaks are the
  weakest. See the look ledger.
- **First flight** (`/world`). Seed 3 ships as one 3.1 MB file. Workers paint the land ahead of the flier at
  60 fps, and the start view is ready in about 1.8 s. Plan: `plans/2026-11-17-dragon-world-flight.md`.
- **Clouds** (2026-11-18, Fable). Sculpted pixel-art cumulus in a five-tone ramp with warm rims, ground shadows, a
  composed opening view, low clouds under the flier and banks it flies through. Design:
  `specs/2026-11-17-dragon-world-clouds-design.md`. The owner rejected the first, Cursor-built version.
- **Moving water** (2026-11-18, Fable). Surf rolls in in sets, white water breaks on rock, a slow swell crosses the open
  sea, rivers flow on their sloping reaches, and waterfalls pour, with spray.
- **Wind, small life, occasional and rare sights** (2026-11-18, Fable). Gusts across grass and crops; sheep, gulls
  that scatter as you pass, sailing boats with wakes, chimney smoke; V-flocks, a kite over the town, a fishing boat, a
  rainbow; and, very rarely (each about once in 11–16 minutes), a whale, a balloon, a fox, a heron, a tall ship and a
  monk, each logged as a discovery with a caption. The flier leaves a wake on water. Preview every rare sight with
  `/world?sights=all`.
- **Live-layer plumbing** (Cursor). The bake pixel under each frame pixel, a layer hook before the paper grain, sprites
  hidden by nearer land, the flier handed to layers, a discovery log with a caption, and `npm run world:live` frame strips.

## Next: the world comes alive

Everything here is drawn each frame over the baked land (live layers, spec 5.5). Nothing is re-baked and the file
size is unchanged; it is TypeScript running in the browser. Order is a proposal.

1. ~~**Clouds.**~~ Done (see above). The most important. They drift over the land in the Ink & Glyph style: soft washed masses with inked
   edges, several sizes and heights, slow wind, sometimes parting to frame a landmark. Shadows are optional (the owner
   does not need them), but if added they come cheap from the shadow bits. Clouds must never hide the flier for long.
2. ~~**Water that moves.**~~ Done.
   - Waves: surf rolling in along beaches by shore distance, foam lines on rocks and cliff feet, a swell on open sea.
   - Rivers: streaks running downstream along the flow phase.
   - Glints on open water (a first version exists).
3. **Large waterfalls.** Falling water that animates, a spray cloud at the foot, a plunge pool ring. The big falls
   (tall drops on the larger rivers) get the full treatment; small ones a simpler flicker.
4. ~~**Wind in grass and trees.**~~ Done. Gusts brushing across meadows (a tone shift under a scrolling gust field) and crowns
   swaying slightly.
5. ~~**Small life.**~~ Done. Gulls over the harbour and cliffs, boats leaving and returning to the harbour, sheep on upland
   pasture, smoke from chimneys, windmill sails turning.
6. ~~**Occasional fun things.**~~ Done. Common enough to be seen on most flights: a flock of birds in a V, a kite flying over
   the town, a fishing boat with its nets out, a rainbow after a shower.

## Rare occurrences

Very rare sights a visitor might find once in many flights. **The owner is collecting a list of references for these.**
Rules:
- They are homages, never copies. No names, characters, logos or art from another property (CLAUDE.md, original work
  only), and no pagan or occult motifs.
- They never change the land. They are live sprites or overlays, timed by the clock and a seeded roll, so they appear
  where the land suits them (a whale only in deep water).
- They can be logged as a discovery in the visitor's progress.

Candidates until the list arrives: a whale breaching offshore; a shooting star at dusk; a hot-air balloon drifting
over the hills; a red fox crossing a field; a heron standing in a river shallows; a ship in full sail on the horizon;
a hermit monk walking the abbey road; bells ringing at the abbey on the hour.

## Rare structures (owner's references, 2026-11-18)

The owner wants more wondrous buildings in the Ghibli spirit, naming the bathhouse in *Spirited Away* and the railway
across the sea. Each is an homage translated into this world's European, church-built setting: our own design, never
the film's building, name or spirits. A structure is a place, hidden somewhere remote and logged when found; its
rarity comes from a moment at that place (a train crossing, a seaplane landing, a dome opening), timed by the clock and
a seeded roll. Candidates, not yet picked:

- **The thermal baths:** a domed bathhouse stepped down a sea cliff in steaming terraced pools, with its own quay and a
  funicular. Every window lights at dusk; a ferry calls now and then.
- **The tide railway:** a single track running out across the shallows to a lone halt (lamp, bench, name board) far
  from shore. Rarely, a two-carriage train glides over water that hides the rails.
- **The drowned church:** a bell tower standing out of a lake, the village visible under clear water.
- **The hotel in the cove:** a white hotel on a rock in a sheltered cove, with a seaplane pontoon. Rarely, a seaplane
  lands and taxis in.
- **The floating garden:** a small island above the clouds, roots trailing beneath, a ruined cloister and orchard on
  top. Seen only from above a cloud bank.
- **The marsh house:** a shuttered house across a tidal marsh, reached by a causeway at low tide; one window lit.
- **The airship mast:** an iron mooring tower on a headland. Rarely, an airship is tied up there.
- **The land-ship:** a sailing ship on wheels crossing a salt flat under full sail.
- **The bridge town:** houses and shops built along an old stone bridge over the river.
- **The great oak:** one enormous tree above the village, taller than the spire, with a treehouse and a swing.
- **The observatory:** a domed observatory on the highest summit; at night the dome opens.
- **The clock automata:** on the hour, carved saints process out of the town clock (church-built, like old astronomical
  clocks).

## Interactions

- Landing on a tower or landmark opens that project (needs the landmarks below).
- Flying low startles birds from trees and gulls from the harbour.
- The flier's wake on water, and its shadow on the land (the shadow exists).
- Passing the abbey rings its bell; passing the windmill turns its sails faster.
- Discoveries (rare sights, every landmark visited) remembered in localStorage, with Continue.

## Later

- **The dragon: what's left.** Landing (coiling onto a site's pad), with the landmarks. The river-dragon is built and
  flying, boost streaks included.
- **Landmarks and projects.** Sprites for the abbey, lighthouse, windmill, bridge, ruined cathedral, churchyard yew
  and the town's bell tower; the six pinned repos assigned to sites; landing opens a project page; the abbey holds
  About Me and the terminal (the Artificer).
- **Title menu.** The rose-window design stays (the owner likes it). Rewrite the wording: role taglines like "the
  scriptorium" and "a record of things made by hand" read oddly.
- **Recruiter page** (text-only, generated from `content.ts` and GitHub) and **Herald** files (`agents.md`, `llms.txt`).
- **Time of day, seasons and weather** from the visitor's clock: palette swaps, lit windows at night, autumn leaves,
  snow line moving, rain and mist.
- **Parchment map** for fast travel between landmarks.
- **Sound** (wind, sea, bells) and a **photo mode** that saves a postcard of the view. Not in the design yet.

## Backlog: cosmetic and look

From the clouds and water (2026-11-18):
- Big cumulus masses read a little like piles of similar bubbles; ground shadows ignore terrain height and sit about
  50 px from small puffs; a bank can drift over a landmark.
- Water: flat river reaches have no direction to flow in (the baked phase is water level); spray paints a few rock
  pixels beside tall falls; surf is missing within 16 px of the frame's edge.
- **Frame budget (first priority).** With every layer and the dragon on, the browser check measures 3.2 ms p95
  unthrottled and 5.6 ms at 4× CPU throttle, still over the 4 ms budget. The water cache (merged 2026-11-18) and
  `depthAt` reusing its last chunk are in. Node breakdown per frame before the cache: water 0.5–1.1 ms, paper grain
  0.27, wind 0.12–0.18, sky about 0.1, life and sights under 0.1; the dragon adds about 0.15 ms in the browser.
- The flight page component is large (React Doctor); split it into hooks.
- The dragon (2026-11-18): the boost's bow of air reads as loose white curves by the head in some frames, and nearly
  vanishes over pale meadow; judged on stills and one live frame, not watched in motion. `depthAt` used to rebuild a cache
  key for every pixel, which doubled the throttled frame with the dragon on; it now reuses its last chunk.

From the round-9 critics (peaks first):
- Peaks: snow and rock lit from true normals so each arête shows a bright side and a cool far side; horizontal strata
  across walls instead of vertical striping; scree that does not fan like a pinwheel.
- Harbour basin needs a mouth to the sea.
- Upland palette: fresher greens; heather only on small exposed spur crests.
- Break the straight plateau rim (headward re-entrants); the trunk river that reads as a canal.
- Coves and cliff scallops repeat; sea stacks need surf at their base.

From the first-flight review:
- Over land not painted yet, the dragon draws over hills that should hide it, and its shadow vanishes.
- Over lakes, the shadow falls on the lake bed and vanishes.
- Small code cleanups: the worker message types are defined twice; the codec branches on the same node kinds in
  three places.

## Decisions waiting (2026-11-18 morning)

- ~~**The dragon.**~~ Decided 2026-11-18: A, the river-dragon. It is now the flier (`specs/2026-11-18-dragon-options.md`).
- ~~**Merge `world/perf`?**~~ Merged 2026-11-18. The water layer reuses its shore-distance work between frames (4×
  throttle: 6.1 → 5.6 ms p95 with the dragon on).
- **The rare-sights list.** Six candidates are built; the owner's references can replace or add to them.
- **Title menu wording** (rose-window look kept). Three option sets offered 2026-11-18: plain, storybook, game-menu.
- **A bigger map?** Today: 6400², a 107 s lap, 3.24 MB. `paramsFor` scales every length with size, so a larger `n`
  alone magnifies the same islands; more world means more islands at today's scale, a re-tune, and splitting
  `world.bin` into streamed region packs (9600² is about 7 MB).

## Open checks

- Owner: open `/world` in Safari (Chrome is measured; Safari is not).
- `npm run a11y` points at `scripts/run-axe.mjs`, which was never committed: restore or remove the script.
