# Dragon world: roadmap

The one list of what is done, what is next, and every idea not built yet. Update it when something finishes, is decided or
is dropped. Details live in the documents it links; this page says what and in which order.

Last updated 2026-11-19.

## Where things are written down

| What | Where |
|---|---|
| What the site is becoming, and the rules every change follows | `.claude/CLAUDE.md` |
| Terrain design (approved) | `docs/superpowers/specs/2026-11-16-dragon-world-terrain-design.md` |
| Landing and the Codex | `docs/superpowers/specs/2026-11-18-landing-and-codex-design.md` |
| Teaching the controls | `docs/superpowers/specs/2026-11-18-teaching-the-controls-design.md` |
| The story: a simple one (proposed) | `docs/superpowers/specs/2026-11-18-a-simple-story.md` |
| Lore and story (set aside by the owner, 2026-11-18) | `docs/superpowers/specs/2026-11-18-lore-and-story.md` |
| Climates and biomes, and one landmark of each kind | `docs/superpowers/specs/2026-11-18-biomes-and-climate-design.md` |
| Plans, one per piece of work | `docs/superpowers/plans/` |
| Look rounds: critic scores and what changed | `docs/superpowers/research/2026-11-17-look-ledger.md` |
| Bake speed gate | `docs/superpowers/research/2026-11-17-bake-gate.md` |
| The minimal version and the terminal as one page: design, and the Safari keyboard research behind it | `docs/superpowers/specs/2026-11-19-minimal-terminal-design.md`, `docs/superpowers/research/2026-11-19-minimal-terminal-mobile.md` |
| Sound: fact sheet, research, design (Fable, after an Opus critique), the tune's originality | `docs/superpowers/research/2026-11-18-sound-factsheet.md`, `…-sound-research-engine.md`, `…-sound-research-recipes.md`, `…-sound-design-critique.md`, `docs/superpowers/specs/2026-11-18-world-sound-design.md`, `docs/superpowers/research/2026-11-19-clock-tune-originality.md` |
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
- **Sights stay while they are watched** (2026-11-18, `sights-persist`, `live/linger.ts`). A timed sight in view as its
  time runs out is no longer cut off or faded: the balloon drifts on, the ship sails on (lying to off shoals), the fox
  trots on into cover, the heron flies on, the monk walks home, the kite comes down with the child, and each wonder's
  moment plays out or stays where its time left it, until it is out of view. The clocks are unchanged and every
  visitor's; what lingers is the watcher's own, and never shows twice at once.
- **Wonders** (2026-11-18). Nine baked wonders after their Ghibli counterparts, redrawn by Cursor at the owner's request
  and polished over three offense/defense critique rounds (Opus critics, Cursor building), each with a live moment
  (`live/moments.ts`), plus the floating garden and the land-ship. A crowded wonder falls back to half the spacing.
- **The Recruiter and the Herald** (2026-11-18, `recruiter-herald`, merged to `feat/dragon-world`): `/recruiter`,
  `/agents.md` and `/llms.txt`, generated from `content.ts` and the pinned repos; `npm run a11y` restored.
- **Tools and tests** read a shipped world in either format (`pack/shipped.ts`). The live-layer tests draw a fixture
  world, the first shipped 6400 world (`src/world/testing/fixture-world/`), so the site can ship any world.
- **Sprites cross the frame's edges whole** (2026-11-18, `edge-sprites`). Boats, gulls, sheep, smoke, the kite, the
  fishing boats, the rare sights, the wonders' moments and the wake vanished near the frame's edge, a boat with its
  whole hull still on screen and a startled gull up to 60 px in, because each layer read the land under a thing only
  from the frame's own bake. The layers now read the land past the edge (`LiveFrame.bakeSpace`, `live/sprites.ts`
  `bakeAt`) and cull each thing by how far it reaches; the rare sights no longer fade in at the edge, which only hid the
  old cull. `live/edges.test.ts` holds every sprite layer to a bigger view of the same land, at three frame sizes. The
  window's size never mattered then: the frame was 400 × 225, only scaled. Cost: about 0.01 ms a frame in Node; at 4×
  throttle, seven alternating world-fly runs on a loaded machine gave p50 3.2 ms for both builds and p95 4.5 ms against
  4.4 ms before. Re-check the p95 against 4 ms on a quiet machine.
- **The world fills the window** (2026-11-19, `edge-sprites`). /world covers the browser window edge to edge at any
  size and shape, with no paper round it: the frame takes the window's shape (more world across on a wide window, more
  up and down on a tall one) at the finest whole number of device pixels per frame pixel that keeps it within 96,000
  frame pixels (`runtime/fit.ts`). 1600 × 900 keeps 400 × 225 at 4×; 1080p gets 384 × 216 at 5×, 1440p 366 × 206 at 7×,
  a 390 × 844 phone 195 × 422. It is sized from the visual viewport, keeps its size while a phone's toolbars come and
  go, and is fitted again when the window really changes or the page comes back; the stream view resizes and keeps its
  chunks. Each thousand frame pixels costs about 0.03 ms at 4× throttle (`world-fly.mjs --viewport`, `?pixels=` to try
  another budget): 1080p at today's 4× scale, 480 × 270, measured 5.3 ms p95.
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
- **Teaching the controls** (2026-11-18, `claude/unruffled-jones-c0c8ed`). Guides drawn into the world beside the
  dragon's head, in the slot its body leaves clearest: a first-flight lesson (steer, then speed, then leave and
  options) whose pixel key-caps light as they are pressed and fade once learned (`world:lesson`), and prompts to land,
  pull up and take off that replace the hint line. A click or tap on a prompt acts on it; a live region says it in
  words. Glyphs follow the device used last: key-caps, a gamepad (stick, triggers, face buttons by position; the pad
  flies, lands and takes off) or a tapping hand. One glyph set (`src/world/controls/`: our own pixel font, caps, pad and
  touch glyphs; drawn into the frame by `blit`, into the DOM by `PixelGlyph`) for the mobile work to reuse. O, the
  pad's Menu or the corner button opens a small pixel options panel: hold or toggle boost, a gentle pace, reduced motion
  (no boost streaks, a camera cut), rebinding the five letter keys, the lesson again, and leaving. The flight page was
  first split into a session and hooks (React Doctor 81 → 100). The guides cost 0.1 ms p95 at 4× (`world-fly.mjs`
  reports `guideMs`); a Fable critic judged two rounds of renders. Design:
  `specs/2026-11-18-teaching-the-controls-design.md`.
- **Flying on a phone** (2026-11-19, `claude/mobile-research-9125c0`). Research
  (`research/2026-11-18-mobile-web-game-controls.md`, with iOS 26.5 Simulator measurements) and an approved design
  (`specs/2026-11-18-mobile-design.md`; the owner took every recommended option). A touch screen opens on a "before you
  fly" card; Take wing goes fullscreen and locks landscape where the browser can (Android; fullscreen on iPad). A
  floating stick under the left thumb points where to fly; Boost and Brake are held under the right, with Land joining
  them near a landmark. The controls are drawn in the frame's pixels and keep clear of safe areas and back-gesture
  strips. Upright phones pause behind a "turn your phone" card, which can play sideways when rotation is locked. Hiding
  the page, a blur, a stall, Back or a lost fullscreen pauses; Fly on resumes. Nothing zooms, scrolls, refreshes or
  selects on `/world`. Phones bake with two workers and step down to 30 fps when frames run long. Hand, size, fade, one
  thumb, vibration and tilt are options. Tests: unit modules plus `npm run test:mobile` (15 flows, real multi-touch in
  phone emulation). The phone's own title screen (a rose-window contents page, the minimal version first) is built at the
  noindex bench `/phone-title`, to be mounted on `/` together with the desktop title.
- **The minimal version and the terminal, as one page** (2026-11-19, Fable). `/minimal` is a Terminal window whose
  scrollback is the whole site as static HTML (profile, projects, contact, the other pages), with a live prompt as
  its last line. Every command can be typed or tapped. On a phone the document itself scrolls and nothing is pinned,
  which is what keeps the prompt on Safari's keyboard bar; measured in the iOS Simulator. `/recruiter` forwards to
  it. Checks: `npm run test:minimal` (its two WebKit projects in the end-to-end suite, `e2e/minimal/`) and
  `npm run a11y`. The abbey's terminal in `/world` reads the same files (`site.pages`). Design:
  `specs/2026-11-19-minimal-terminal-design.md`.
- **Climates and biomes** (2026-11-19, `claude/biomes`, Fable). The torus reads as round, and its two routes differ
  (the owner's decisions of 2026-11-19). Temperature is a band by latitude from an equator line to a pole line and
  back, cooler with height. The route through home is the wet side: taiga, the temperate belt (unchanged to the
  byte, and held round the home island), warm forest, jungle. The other is the dry side: stony tundra, steppe, the
  Mediterranean, desert with sand seas and wadis, savanna. So a lap meets each of ten climates once. Landforms by
  climate reshape the grown land outside the temperate belt: desert benches, mesas and dune ridges, an ice sheet,
  karst towers in the jungle, rock domes on the savanna (`gen/landforms.ts`); rivers, coasts and the home island
  are untouched. Palms, acacias, umbrella pines and cactus are small pictures drawn over the painted land. Seven
  landmarks, one of each kind, each in a climate that suits it: the lighthouse by the pack ice, the yew in temperate
  country off the home island, the ruined cathedral in the jungle, the windmill in the Mediterranean, the bridge on
  the steppe. Every island outside home is grown again for its climate (`gen/native.ts`): plains for the steppe and
  savanna, low mesa plateaus and ergs for the desert, fjords and glaciated hills for the taiga, an ice sheet at the
  pole, rugged limestone for the Mediterranean, rias for the warm forest, karst plains for the jungle. Two grown lands
  are joined island by island through open sea, so home's start and abbey frames are the same to the byte. Hamlets
  and houses by climate. Temperature and the dry side's share ship as two more sections a region;
  the haze and the manifest know the climate. Design, measurements and follow-ups:
  `specs/2026-11-18-biomes-and-climate-design.md`. The world on disk has not been re-shipped: `npm run world:build --
  --seed 3 --n 10240 --cache` makes the new one, and `src/world/sites/assignments.json` is pinned to it.
- **Live-layer plumbing** (Cursor). The bake pixel under each frame pixel, a layer hook before the paper grain, sprites
  hidden by nearer land, the flier handed to layers, a discovery log with a caption, and `npm run world:live` frame strips.
- **Coast glitches fixed** (2026-11-18, `gulls-coast`). Gulls remember their flight once startled, so turning, the
  landing coil and resting no longer make them jump across the sky or hang in the air; boats float on the water drawn
  under them, so their keels no longer blink under the sea; the flier's wake stays on the water it was laid on and
  fades, rather than vanishing the moment the flier crosses the shore. Pinned frame by frame in `live/coast.test.ts`.
- **Time of day and weather** (2026-11-19, `claude/gracious-hypatia-d55439`; three Fable agents over two critic
  rounds). The light follows the visitor's own clock: sun phase from the local hour, with longer days in summer
  (`sky/clock.ts`). The palette's day runs night, a deeper small hours, blue hour, dawn, golden hour, dusk, split-toned
  (lit faces in the light's colour, shade in its own); noon is unchanged, and a new light recolours the land without a
  re-bake (`StreamView.setLight`). The weather is the same for everyone flying at the same moment (`sky/weather.ts`:
  20-minute slots from the wall clock and the seed; about one in four holds a shower whose clouds gather for 2.5
  minutes first, about one in six a mist). At night the windows of lived-in buildings light from the builders' marks,
  lanterns burn on quays, jetties and moored boats with reflections, the five lighthouses sweep warm beams that show
  from afar, and stars glint on calm water (`live/night.ts`); the dragon keeps its own light. Rain falls in pixel
  streaks under the clouds and the flier, with splashes; mist lies in drifting banks (`live/mist.ts`) and stills the
  wind, as heavy rain does; every shadow follows the sun (`sunOn`). Rainbows need daylight and the town kite a fair day. `?time=` and
  `?weather=` hold either still; `world:live --times --weathers`, `world-fly --query`. Seasons do not follow the clock
  (coordinator, 2026-11-18): the page flies in summer.
- **Sound** (2026-11-19, `claude/sharp-golick-cbdced`; researched, designed and built by Fable, critiqued by Opus,
  judged on offline renders). Generated live with Web Audio, no audio files; muted until the visitor asks, by the
  speaker in the top corner or the options' new Sound section (on/off and five volume steps, mute included), remembered
  in localStorage; no AudioContext before that gesture, and none at all while off. Wind on five layers rising with
  speed and boost; a soft bloom on turns; surf on the picture's own wave clock (each wave fresh noise, heard where it
  breaks: beach, shingle, rock, quays, far coast and open sea); rivers made of bubbles, falls with rumble when tall;
  the abbey's five old-style bells on the world hour, a peal then the hour struck, with a generated reverb; herring
  gulls at the town and the lighthouses (tuned to a published sonogram), startled gulls on a low pass; the clock's
  figures and an original tune; the train, seaplane, ferry and baths, and the church flock, each in step with its
  picture through shared position functions in `live/moments.ts`. Mist muffles the world (not the wind); gulls roost
  at night. Reduced motion (the options' or the system's) softens the motion-linked sound. The tab hidden or the sound
  off: faded, then suspended. Listen at `/world-sound` (every scene, live, and offline renders with
  `node scripts/world-sound.mjs`, checked by `scripts/world-sound-check.mjs` for loudness, clipping, clicks and
  spectrograms). Frame budget (merged tree, five pairs): +0.10 ms on the 4× p95 with sound on, sound's own work
  0.1 ms p95 a frame at 1× (design §13).
- **End-to-end suite and a WebKit pass** (2026-11-19, `claude/e2e-webkit-3824c0`). `npm run e2e` builds the export
  and runs Playwright in Chromium and WebKit, at desktop and phone sizes. It covers opening the world (no haze, the
  frame filling the window), keyboard flight, the lesson, the options, landing and the Codex, the abbey's terminal, a
  broken world file, and the other pages. WebKit drew the options panel's labels above their choices; that is fixed,
  as is the Codex's name, which its illuminated initial split ("E mpty-state-repo"). Notes, and what still needs a real
  Safari or iPhone: `research/2026-11-19-webkit-pass.md`. The minimal version's WebKit tests are two more projects of
  it (`minimal-phone`, `minimal-desktop`, in `e2e/minimal/`), on the one Playwright (1.65.1).

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
- **Minimal version: what's left.** The desktop title menu's link to it (the phone title, the flight card's short
  version and the abbey's terminal on a phone open it already); removing the old pop-up terminal and home page once
  the title menu takes `/`; a pass on a real iPhone and on iOS 27.
- **Seasons**: not from the clock (settled 2026-11-18), and the lore that laid the months out as places is set aside.
  If they come back, the palette already carries the four, and `world:live --season` previews them.
- **Parchment map** for fast travel between landmarks.
- ~~**Sound**~~ (done; see Done) and a **photo mode** that saves a postcard of the view. Not in the design yet.
- **Sound, what is left.** A rain bed for the showers (drops on land, bubbles on water) and the final re-pin of every
  level against the whole mix: both wait for Fable (its usage limit, 2026-11-19). Later moments (the airship, the
  marsh and bridge carts, the observatory dome, the oak's gust; designed in spec §4.12). Headphones (HRTF) as an
  option (spec §6.3, last and optional). Night: an owl, crickets inland, perhaps no peal in the small hours. Tall
  falls listed in the manifest, so they are heard before they are seen. A town bed, the windmills, and sounds for the
  rare sights (whale, balloon, heron, tall ship). Clouds muffling sound.

## Ideas: mobile, controls and wayfinding (owner, 2026-11-18 evening)

The owner's asks: mobile as an option (the minimal page first, a different title screen, touch controls, the view
locked down, its own test suite, researched first); clearer interactivity with simple pixel-style guides; and no
minimap (a map is for fun only). Researched, designed and built 2026-11-19 (see Done); what is left is listed below.

**Mobile (optional; phones get the minimal page by default)**
- Left: mounting the phone title on `/` with the desktop title (`PhoneSwitch` is ready), when the phone title gains
  Settings from the desktop title's `settings.ts`; trimming the workers after a long hide; a real-phone pass (feel,
  heat, memory, the edge swipe); sound unlocked on Take wing once there is sound; one copy list for the phone and
  desktop titles when the desktop title lands.
- ~~A "Fly anyway" opt-in from the text page; a separate, simpler mobile title screen.~~
- ~~Touch flight: a floating joystick where the left thumb lands, boost and brake buttons on the right, tap a prompt to
  land; tilt steering as an option. All drawn as pixel-art controls.~~
- A locked view: landscape via the Screen Orientation API where it works (Android, in fullscreen or an installed PWA),
  a "turn your phone" card on iOS; no pinch or double-tap zoom, pull-to-refresh, overscroll or text callouts; safe
  areas and dynamic toolbars handled; pause when hidden.
- Phone performance: lower resolution and frame rate, fewer workers, a smaller region cache.
- Tests: Playwright mobile emulation (touch, orientation, viewport), synthesised multi-touch, pixel snapshots of the
  controls, and a real-device pass.

**Teaching the controls (desktop and mobile)**
- ~~Lesson, device-aware prompts, contextual prompts, options, gamepad.~~ Done (see Done). Left: touch flight itself
  (the mobile work, with the touch glyphs already in `controls/glyphs.ts`), "M for the map" once there is a map, and
  steering toward the pointer on desktop.

**Finding your way without a minimap**
- Landmarks visible from afar: smoke columns, ~~the lighthouse's sweeping beam~~ (done), gulls circling towers, banners.
- The dragon glances toward the nearest unvisited tower; a compass rose inked in the page margin.
- Signposts at crossroads, and roads and rivers that lead to towers.
- The parchment map, for fun (a key, not always on): hand-drawn, revealing only explored land, with visited towers
  marked; fast travel only between visited towers.

**More to do in the world**
- Landing and the Codex (the `landing-codex` session); a journal of discoveries with sketches and a completion count.
- Shareable places: a link that opens the world at a tower or a view, so a recruiter can be sent straight to a project.
- Photo mode: freeze, hide prompts, save a postcard with an ink border and caption.
- Errands between towns (carry a letter from tower to tower) as a light way to tour the projects.
- ~~Time of day and weather from the visitor's clock~~ (done); ~~sound (wind, sea, bells), muted until turned on~~
  (done; rain to come).
- Fly low to startle birds and skim water for spray; clouds muffle sound.

**Site**
- A pixel loading scene while the core loads (1.5 MB); a clear fallback to the text page if the world fails.
- OpenGraph postcards per tower; Continue where you left off.
- ~~An end-to-end suite: world → land → Codex → back, on desktop and mobile emulation.~~ Done (`npm run e2e`). Left:
  the title menu, once it is merged.
- ~~Split the flight page component into hooks before the controls and mobile work lands.~~ Done: `session.ts` and hooks.

## Backlog: cosmetic and look

From the clouds and water (2026-11-18):
- Big cumulus masses read a little like piles of similar bubbles; ground shadows ignore terrain height and sit about
  50 px from small puffs; a bank can drift over a landmark.
- Water: flat river reaches have no direction to flow in (the baked phase is water level); spray paints a few rock
  pixels beside tall falls; surf is missing within 16 px of the frame's edge. The water's shading also differs in the
  outer 1–3 px of the frame, and the wind never stirs a crown in its first column: both read neighbours only on the
  frame (`bakeAt` would fix them, at some cost in their hot loops).
- Two placements still follow the view: `?sights=all` puts each rare sight near the view's centre (by design), and
  while the land-ship is out of sight a stand-in runs whatever sand the frame shows (`moments.ts` `frameSand`), so it
  can jump as the view moves. Decide whether the stand-in should stay.
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

From the lingering sights (2026-11-18), for the frame-edge work:
- A rare sight in its window draws only while its candidate spot is 30 px inside the frame, though the balloon drifts
  up to 119 px from it, the ship 112, the fox 70 and the heron about 255: moving the view can drop one mid-frame. The
  ship and the fox are culled by their anchor at the frame's edge; the monk shows only while the abbey's whole road
  box is in frame. In its window the ship still vanishes where its course meets water shallower than tone 5.
From the climates (2026-11-19):
- Winds in bands for the rain (trades in the tropics, westerlies beyond), so deserts lie on the right coasts.
- A cold sea colour and a silty river: each needs the same line in five live-layer tables (`live/water.ts` CLASS, and
  `isSea` in life, sights, rare and moments).
- Life by climate: the live rain and rainbows have no land check, so they fall on dunes and ice; sheep only know
  pasture; no animal belongs to the new climates yet.
- Native land, next (look ledger, round 8): the steppe and Mediterranean as land of their own (an island takes the
  recipe of its mean climate, so one that reaches into the steppe band is still ridged; a recipe by latitude within
  the island, or plains cut by braided rivers); the warm forest drawn in the temperate hand, apart from the jungle;
  the jungle's coastal plains and mangroves (its rain cuts them into hills); the pack as floes along the coasts, not a
  band; repeated stamps (sea-stack rows, horseshoe amphitheatres, acacia carpets, tower cones) and roads ruled along
  the grid; the marsh house finds no marsh clear of the landmarks on seed 3 (8 of 9 wonders); a seed search for
  islands that fall more evenly into the climates.
- The climates' bake: tiles outside the temperate plateau cost 30 % more than as a temperate world (the design's
  limit is 15 %; `scripts/world-climate-cost.ts`). The frame is unchanged.
- The landforms are a first pass: benches are faint on gentle ground, the ice sheet only fills hollows, rock domes
  are few. Pingos on the tundra and terraces on Mediterranean coasts are not built.
- Black sand on tropical volcanic islands; tidewater glaciers; burn scars on the savanna.

From landing (2026-11-18):
- Fixed the same day, after the owner's first flight: the coil unravelling at rest and the body regrowing on take-off
  (the chain forgot its path), the tail hanging in the air, stiff whiskers and a rolled body at rest; and the dragon is
  now about 78 % of its first size. See the landing design.
- A lighthouse stands on a cliff's edge, so its coil is draped from the sea up over the rock behind the tower. A coil
  wound up the tower itself, held by it, would be the better picture there.
- Take-off, from the render critic: where the coil is a closed ring (the harbour, a lighthouse) the head crosses its
  own tail for about half a second as it leaves; at the ruined cathedral the wooded bank in front cuts the rising body
  in two for a moment. Both pass; a take-off that leaves outward, and climbs faster where it is hidden, would cure them.
- A cloud bank can drift over the landmark the dragon rests at; the dragon still shows, the building does not. The sky
  could part round a landed site.
- ~~In the town the coil lies among the houses round the bell tower, and the houses hide some of it.~~ The town now
  lands in its harbour. A landmark close behind trees or a bank can still hide part of the resting body (the head is
  kept in view).
- `Flight.tsx` grew with landing (React Doctor's giant-component warning was already there); the page's slim-project
  mapping for the terminal repeats the home page's.

From time of day and weather (2026-11-19):
- The sailing boats out in the bay carry no lanterns at night (they belong to the life layer); the marsh house's one lit
  window is found by its light bytes, not by the wonder's type.
- No moon: a sheen or glade on the sea needs a live layer (a palette cannot place it).
- Rain cannot see the clouds, so there are no denser shafts under them.
- The observatory's dome opens on its own clock; it could open only at night.
- Frame budget, after merging `world/bigmap` (2026-11-19): flown run for run against a build of it (`world-fly`, 4×
  throttle, a quiet machine), p95 3.5–3.8 ms at noon, 3.5–3.7 on a clear night, 3.1–3.4 in night rain and 3.4–3.8 in
  night mist, against 3.6–3.8 for `world/bigmap` alone. Thick mist and heavy rain still the wind's gusts in the grass
  (the dearest layer), which pays for the banks, the rain and the gathered clouds. In Node the night layer costs
  18–24 µs a frame, rain and splashes about 22, the mist banks 79–86 at full mist, and the gathered clouds about +80
  on the sky.

From the first-flight review:
- Over land not painted yet, the dragon draws over hills that should hide it, and its shadow vanishes.
- Over lakes, the shadow falls on the lake bed and vanishes.
- Small code cleanups: the worker message types are defined twice; the codec branches on the same node kinds in
  three places.

## Decisions waiting: climates (2026-11-19)

The owner decided the large ones on 2026-11-19 (a simple story that asks nothing of the generator; two sides, each
climate once a lap; seven landmarks; size left to the design, which keeps 10240). Still open in
`specs/2026-11-18-biomes-and-climate-design.md`, each built as recommended until the owner says otherwise: north
colder at home; the home island kept temperate with the belt swelling round it; no new water colours yet. Native
land was decided (grow it) and is built (spec 6.7).

## Decisions waiting (2026-11-18 morning)

- ~~**The dragon.**~~ Decided 2026-11-18: A, the river-dragon. It is now the flier (`specs/2026-11-18-dragon-options.md`).
- ~~**Merge `world/perf`?**~~ Merged 2026-11-18. The water layer reuses its shore-distance work between frames (4×
  throttle: 6.1 → 5.6 ms p95 with the dragon on).
- **The rare-sights list.** Six candidates are built; the owner's references can replace or add to them.
- **Title menu: parked by the owner** (2026-11-18 evening). The `title-menu` session explored twenty directions (A–T)
  in its browser pane; none is picked or built. Mobile gets a separate title screen (see Ideas).
- **The minimal version** (2026-11-19). Eight decisions, each built to its recommended option: where the page lives
  (`/minimal`, `/recruiter` or `/` under the title menu), what happens to `/recruiter`, the old pop-up terminal,
  programs on a phone, text size, what `clear` clears, the contact form, the LinkedIn address
  (`specs/2026-11-19-minimal-terminal-design.md`, section 11).
- ~~**A bigger map?**~~ Built: 10240 with more islands at today's scale, shipped in regions (see Done).
- **The story** (2026-11-18, Fable). The owner set aside the first brainstorm, a world with an order, a history and
  months as places (`specs/2026-11-18-lore-and-story.md`): "I just want something simple", in the spirit of *The
  Little Prince*, about people and not world-building. `specs/2026-11-18-a-simple-story.md` proposes it: the dragon has
  never made anything, so it asks the keeper of each landmark why they do, and each page of the Codex ends with one
  short encounter. No gates, nothing on the text page, and nothing asked of the generator. Not built.

## Open checks

- Owner: open `/world` in Safari and on an iPhone. WebKit now runs in `npm run e2e`; what automation cannot see
  (toolbars and `vh`, touch gestures, keyboard taps, phone performance) is listed in
  `research/2026-11-19-webkit-pass.md`. A phone on the LAN needs HTTPS, or the world will not load.
- Owner: open `/minimal` on a real iPhone and type at its prompt. The keyboard behaviour is measured in the iOS 26.5
  Simulator only, with synthesised touches, and not on iOS 27.
- Owner: in desktop Safari, on `/minimal`, click `cat`, then `projects/`, then `README.md`. The page should rest at
  the top of the projects, with the prompt below the fold and still holding the keys. WebKit scrolls to a focused
  field whose value a script changes; the fix is checked in Playwright's WebKit only.
- Owner, sound: on an iPhone, the first enable, a sliding tap, lock and unlock, background and back, silent mode
  ("ambient" session); in desktop Safari, a sound panned hard left (WebKit 257447; the engine pans by gain pairs, not
  StereoPannerNode); with Bluetooth headphones, whether the abbey's bells meet the clock's figures. Listening set:
  `side-session-notes/…/sound-listening/index.html`.
- Owner: the clock's tune in two public melody indexes (Musipedia's contour search, FolkTuneFinder): both need one
  "Verify you are human" tick in the app's browser. The corpus check (13,367 tunes) found nothing close; see
  `research/2026-11-19-clock-tune-originality.md`.
- ~~`npm run a11y`~~ restored (axe). It gates `/minimal`, which `/recruiter` now forwards to; add a page to its
  `PAGES` list once it passes.
