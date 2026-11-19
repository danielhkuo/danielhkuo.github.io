# Dragon world: roadmap

The one list of what is done, what is next, and every idea not built yet. Update it when something finishes, is decided or
is dropped. Details live in the documents it links; this page says what and in which order.

Last updated 2026-11-18.

## Where things are written down

| What | Where |
|---|---|
| What the site is becoming, and the rules every change follows | `.claude/CLAUDE.md` |
| Terrain design (approved) | `docs/superpowers/specs/2026-11-16-dragon-world-terrain-design.md` |
| Landing and the Codex | `docs/superpowers/specs/2026-11-18-landing-and-codex-design.md` |
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
- **A larger world** (2026-11-18, `world/bigmap`). 10240 × 10240 cells, seed 3: more islands at the 6400 world's
  scale (`lengthScale`, `countFor`), 27 landmarks, about 34 % land, a 171 s lap. It ships as a core plus 64 region files
  (format 2, `pack/regions.ts`): 9.0 MB in all, 1.45 MB before the first flight (core 0.93 MB, with the coast stamps in
  the regions). Workers bake each tile from a window of the grids (`bake/window.ts`) and keep a small region cache
  (`runtime/tiledHost.ts`), byte-identical to a whole-world bake, at about 30–50 MB of heap each. The page reads ground
  near the flier from regions and the haze from the core's overview (`runtime/regionLand.ts`). Design:
  `specs/2026-11-18-wonders-and-larger-map-design.md`.
- **Frame budget met** (2026-11-18, `frame-budget`). /world's p95 at 4× CPU throttle fell from 6.0 to 3.6 ms, with the
  look pinned byte-identical by differential tests.
- **Wonders** (2026-11-18). Nine baked wonders after their Ghibli counterparts, redrawn by Cursor at the owner's request
  and polished over three offense/defense critique rounds (Opus critics, Cursor building), each with a live moment
  (`live/moments.ts`), plus the floating garden and the land-ship. A crowded wonder falls back to half the spacing.
- **The Recruiter and the Herald** (2026-11-18, `recruiter-herald`, merged to `feat/dragon-world`): `/recruiter`,
  `/agents.md` and `/llms.txt`, generated from `content.ts` and the pinned repos; `npm run a11y` restored.
- **Tools and tests** read a shipped world in either format (`pack/shipped.ts`). The live-layer tests draw a fixture
  world, the first shipped 6400 world (`src/world/testing/fixture-world/`), so the site can ship any world.
- **Terrain polish on the 10240 world** (2026-11-18, `terrain-polish`), five critic rounds (look ledger). Snow lit by
  its true normal, parted at each crest into a bright face and a lilac one; rock walls in horizontal beds with lit
  ledges, hatching along the contour; heather only on exposed crests and tops, fresher upland greens; fens as compact
  low islands with meres, reed beds, saltmarsh and a narrow tidal rim; lake beds without pale squares; coves,
  stream notches and cliff heights vary, stacks stand in surf rings; the harbour opens to the sea through a dredged
  fairway. Seed 3 at 10240 still places every site; generation 4.7 min, 2.9 GB.
- **Island variety, first batch** (2026-11-18, `fable-islands`). Islands lie at any strike within 69° of west–east,
  round to long, and come in new forms, each wearing one of the six region looks: a caldera (a ring of sheer walls
  round a shallow lagoon, an islet in it, a narrow mouth), a volcanic cone (radial ravines, a crater lake at the
  summit), a table (flat top, sea walls, falls off the south edge), a fen (winding lodes, meres, saltmarsh, tidal
  flats) and a fjord highland (deep, steep inlets). Stage S5b `gen/forms.ts`. Next batch: more forms (atoll, tombolo
  pairs, sea arches, a drowned ria coast).
- **Landing and the Codex** (2026-11-18). The build matches the pinned repos to landmarks (sticky in
  `src/world/sites/assignments.json`, keyed by world). Near a landmark a prompt offers to land (Space, Enter or a tap);
  the dragon slows, circles and coils down round the landmark's own building, and the Codex opens: the project's name,
  description, language, stars, forks, date and links. At the abbey it holds About Me, a register of where each project
  is kept, and the terminal. Any landmark can be landed at; an empty one shows the register. Each landing is logged as a
  discovery, by repository. Preview a site with `/world?at=<site id>`.
- **Live-layer plumbing** (Cursor). The bake pixel under each frame pixel, a layer hook before the paper grain, sprites
  hidden by nearer land, the flier handed to layers, a discovery log with a caption, and `npm run world:live` frame strips.
- **Coast glitches fixed** (2026-11-18, `gulls-coast`). Gulls remember their flight once startled, so turning, the
  landing coil and resting no longer make them jump across the sky or hang in the air; boats float on the water drawn
  under them, so their keels no longer blink under the sea; the flier's wake stays on the water it was laid on and
  fades, rather than vanishing the moment the flier crosses the shore. Pinned frame by frame in `live/coast.test.ts`.

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

**Built, round one (2026-11-18, Fable; design in `specs/2026-11-18-wonders-and-larger-map-design.md`):** the thermal
baths, the tide railway, the drowned church and the hotel in the cove are baked and sited (`gen/wonders.ts`,
`gen/wonderworks.ts`), listed in the manifest as `wonders`, and rendered by `npm run world:wonders`. On seed 3 the
hotel's rock stands off a headland 150 cells from its cove, not inside one: no sheltered south-facing cove on this
land has a rock in it.

**Moments (2026-11-18, `live/moments.ts`):** seeing a wonder logs it. Each has a seeded moment — steam and a ferry,
the train, ripples and a flock, the seaplane, a lamp and a cart, an airship at the mast, carts and a boat, leaves off
the oak, the dome opening — and the town clock sends carved figures out on the hour. The floating garden and the
land-ship are live only. `npm run world:live -- --view moments` draws each one. `?sights=all` holds them open.

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
- **The clock automata:** on the hour, small carved figures file out of the town clock and round the face.

## Interactions

- ~~Landing on a tower or landmark opens that project.~~ Done (see above).
- Flying low startles birds from trees and gulls from the harbour.
- The flier's wake on water, and its shadow on the land (the shadow exists).
- Passing the abbey rings its bell; passing the windmill turns its sails faster.
- Discoveries (rare sights, every landmark visited) remembered in localStorage, with Continue.

## Later

- ~~**The dragon: what's left.**~~ Landing is built: it coils down round the landmark's building.
- **Landmarks and projects.** Assignments, landing and the Codex are built (see Done). Open: more than six projects.
  Pins cap the world at six; a GitHub topic (tag a repo, it appears at the next build) would add more with no other
  upkeep. It touches `src/lib/github.ts` and every page that reads it, so it is its own task.
- **Title menu.** The rose-window design stays (the owner likes it). Rewrite the wording: role taglines like "the
  scriptorium" and "a record of things made by hand" read oddly.
- **Time of day, seasons and weather** from the visitor's clock: palette swaps, lit windows at night, autumn leaves,
  snow line moving, rain and mist.
- **Parchment map** for fast travel between landmarks.
- **Sound** (wind, sea, bells) and a **photo mode** that saves a postcard of the view. Not in the design yet.

## Ideas: mobile, controls and wayfinding (owner, 2026-11-18 evening)

The owner's asks: mobile as an option (the minimal page first, a different title screen, touch controls, the view
locked down, its own test suite, researched first); clearer interactivity with simple pixel-style guides; and no
minimap (a map is for fun only). A `mobile-research` session is writing the research and a design.

**Mobile (optional; phones get the minimal page by default)**
- A "Fly anyway" opt-in from the text page; a separate, simpler mobile title screen.
- Touch flight: a floating joystick where the left thumb lands, boost and brake buttons on the right, tap a prompt to
  land; tilt steering as an option. All drawn as pixel-art controls.
- A locked view: landscape via the Screen Orientation API where it works (Android, in fullscreen or an installed PWA),
  a "turn your phone" card on iOS; no pinch or double-tap zoom, pull-to-refresh, overscroll or text callouts; safe
  areas and dynamic toolbars handled; pause when hidden.
- Phone performance: lower resolution and frame rate, fewer workers, a smaller region cache.
- Tests: Playwright mobile emulation (touch, orientation, viewport), synthesised multi-touch, pixel snapshots of the
  controls, and a real-device pass.

**Teaching the controls (desktop and mobile)**
- A first-flight lesson drawn in the world: pixel key-caps (WASD or arrows, Shift) that light as they are pressed and
  fade once learned, remembered in localStorage.
- Device-aware prompts: keyboard glyphs, gamepad glyphs when a pad connects (Gamepad API), touch glyphs on phones.
- Contextual prompts by the dragon, not a HUD: "E to land" near a tower, "Space to take off", "M for the map".
- Options: remap keys, hold or toggle boost, a slower cruise, reduced motion.
- Gamepad support, and steering toward the pointer on desktop.

**Finding your way without a minimap**
- Landmarks visible from afar: smoke columns, the lighthouse's sweeping beam, gulls circling towers, banners.
- The dragon glances toward the nearest unvisited tower; a compass rose inked in the page margin.
- Signposts at crossroads, and roads and rivers that lead to towers.
- The parchment map, for fun (a key, not always on): hand-drawn, revealing only explored land, with visited towers
  marked; fast travel only between visited towers.

**More to do in the world**
- Landing and the Codex (the `landing-codex` session); a journal of discoveries with sketches and a completion count.
- Shareable places: a link that opens the world at a tower or a view, so a recruiter can be sent straight to a project.
- Photo mode: freeze, hide prompts, save a postcard with an ink border and caption.
- Errands between towns (carry a letter from tower to tower) as a light way to tour the projects.
- Time of day and weather from the visitor's clock; sound (wind, sea, bells), muted until turned on.
- Fly low to startle birds and skim water for spray; clouds muffle sound.

**Site**
- A pixel loading scene while the core loads (1.5 MB); a clear fallback to the text page if the world fails.
- OpenGraph postcards per tower; Continue where you left off.
- An end-to-end suite: title → world → land → Codex → back, on desktop and mobile emulation.
- Split the flight page component into hooks before the controls and mobile work lands.

## Backlog: cosmetic and look

From the clouds and water (2026-11-18):
- Big cumulus masses read a little like piles of similar bubbles; ground shadows ignore terrain height and sit about
  50 px from small puffs; a bank can drift over a landmark.
- Water: flat river reaches have no direction to flow in (the baked phase is water level); spray paints a few rock
  pixels beside tall falls; surf is missing within 16 px of the frame's edge.
- The flight page component is large (React Doctor); split it into hooks.
- The dragon (2026-11-18): the boost's bow of air reads as loose white curves by the head in some frames, and nearly
  vanishes over pale meadow; judged on stills and one live frame, not watched in motion. `depthAt` used to rebuild a cache
  key for every pixel, which doubled the throttled frame with the dragon on; it now reuses its last chunk.

From the 10240 polish critics (2026-11-18; the round-9 items are done unless listed):
- Peaks: a snow massif parts along one line, not one per arête (the land needs more, sharper arêtes); lit snow is
  still flat; rock walls keep a faint pleat of ribs under their beds. Scree is almost absent at 10240.
- Fens: the drainage is a dense branching web, not a few slow lodes (needs a fen-aware channel threshold in
  hydro/rivers); meres have no reed fringe (the cover cannot see a lake's shore); flats are one width all round.
- Coast: cliffed shores between stream notches still make equal half-dome headlands; stacks are smooth cylinders
  (bake/cells.ts reshapeStacks: taper, notch and beds wanted).
- Sites painted into the land: a lighthouse pad cut down a sea cliff reads as a green box, and a road runs straight
  down a cliff face (settle.ts pads and roads).
- Break the straight plateau rim (headward re-entrants); the trunk river that reads as a canal.

From landing (2026-11-18):
- A cloud bank can drift over the landmark the dragon rests at; the dragon still shows, the building does not. The sky
  could part round a landed site.
- In the town the coil lies among the houses round the bell tower, and the houses hide some of it.
- `Flight.tsx` grew with landing (React Doctor's giant-component warning was already there); the page's slim-project
  mapping for the terminal repeats the home page's.

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
- **Title menu: parked by the owner** (2026-11-18 evening). The `title-menu` session explored twenty directions (A–T)
  in its browser pane; none is picked or built. Mobile gets a separate title screen (see Ideas).
- ~~**A bigger map?**~~ Built: 10240 with more islands at today's scale, shipped in regions (see Done).

## Open checks

- Owner: open `/world` in Safari (Chrome is measured; Safari is not).
- ~~`npm run a11y`~~ restored (axe, no violations on /recruiter).
