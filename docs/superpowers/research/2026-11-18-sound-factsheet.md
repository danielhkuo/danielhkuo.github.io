# Sound for the world: fact sheet

The facts the sound design rests on, gathered from the code on `world/bigmap` at 89b2370 (2026-11-18). Read this
before the research notes and the design.

## The brief

- Give `/world` sound, generated in the browser with the Web Audio API. No audio files, or only tiny ones we make.
- Sounds asked for: **wind** that rises with the dragon's speed and boost; **sea** surf near coasts, louder over beaches
  and cliffs; **rivers and waterfalls** when close; the **abbey's bells** on the hour; **gulls** near harbours; the
  **wonders' moments** (the train, the clock figures, and the rest); a **soft whoosh** for the dragon's turns.
- Read where things are from the same data the live layers use.
- Muted by default, with a clear pixel toggle, remembered in localStorage. Respect reduced motion and sound settings.
  Handle the browser's audio unlock (a user gesture first). Pause when the tab is hidden.
- Main thread: under 0.3 ms a frame for sound. Frame budget: under 4 ms p95 at 4× CPU throttle
  (`npm run build && node scripts/world-fly.mjs --port 4371`).
- Unit-test the pure parts: the mix by position and speed, and the schedules.
- **The owner's bar (2026-11-18):** transitions must be smooth (fades, crossfades), the sound as realistic as possible
  in 3D space. "If we're going to have audio at all, it must be perfect." Research it; Fable leads.

## Scale and motion

- The world is a torus of n = 10240 cells a side. Positions wrap; use `ringDelta` / `torusDelta` for offsets.
- The frame is 400 × 225 pixels, scaled up with hard pixels. One frame pixel is one cell east–west; bake rows are
  0.8 × world y, so one pixel is 1.25 cells north–south. Height h lifts a point h pixels up the screen.
- The camera is overhead and tilted (north is up the screen). While flying, the dragon sits near the frame's centre;
  the ground under it is `alt` pixels below the centre. The frame shows about ±200 cells east–west and ±140 north–south.
- Flight (`runtime/flight.ts`): cruise 60 cells/s; boost ×1.8 (108), brake ×0.5 (30); speed eases toward its target at
  2/s; bank eases toward −1…1 at 6/s; full bank turns 1.6 rad/s. Height is kept about 18 units over the ground
  (`CLEARANCE`), climbing or sinking at most 30 units/s. A lap of the world takes about 171 s.
- Landing (`sites/landing.ts`): near a landmark (110 cells) Space/Enter lands. Phases: `flying` → `landing` (the dragon
  slows, circles and coils down round the building) → `landed` (at rest; the Codex dialog opens; the camera eases onto
  the site, offset to sit beside the Codex) → take off. `restShare(phase)` says how far into rest the body is.

## What the live layers read each frame

`view.frame(out, t, flier)` runs the live layers (`live/registry.ts`, `makeLayers`) after compositing. Each gets a
`LiveFrame` (`live/live.ts`):

- `bake[i]`: the bake pixel under frame pixel i: `material | light << 8 | depth << 16`; 0 where haze shows
  (`live/pixel.ts`: `matOf`, `toneOf`, `depthOf`).
- `rect` (x, y, w, h in bake space), `t` (seconds on the page's requestAnimationFrame clock, from navigation), `palette`,
  `n`, `flier` {x, y, alt, heading (0 east, π/2 south), speed}, `bakeVersion` (changes when the land under the view does).

Materials (`look/materials.ts`): `sea`, `seaClear`, `lake`, `river`. Beach-like: `sand`, `sandPale`, `duneGrass`
(and `shingle`, which water.ts treats as rock and life.ts as beach). Rock: `boulder`, `rockHard/Sed/Lime/Slate`,
`cliffHard/Sed/Lime/Slate`, `scree*`. Built ground (`isBuilt`) makes a calm shore (quays). Everything else is land.

- On sea and lake pixels the tone (0–15) holds the shore distance; on river pixels, the flow phase.
- River tones `FALL_TONE` (14) and `FOAM_TONE` (15) (`bake/chunk.ts`) mark falling water and foam: the falls and their
  feet. A fall 9 pixels or taller (`TALL_FALL`) gets the wide spray.

The page also hands the layers a `LayerContext`: `seed` (3), `n`, `sites` [{id, type, x, y}], `land` (the overview
ground grid, gN = n/8 a side, −1 where sea), `wonders` (with named anchors), `discover(id, label)`.

## The water's clocks (`live/water.ts`)

- `WAVE_PERIOD` = 5.2 s from one wave reaching a shore to the next. Waves come in sets of nine with strengths
  `SET = [2, 3, 3, 1, 2, 3, 2, 0, 1]` (0 a lull … 3 the big one). Two trains run half a period apart, so one breaks while
  the last drains. Each spot on a shore is offset by a spatial "bend" of 0–1 period, so a long shore never breaks all
  at once. Shore kinds: beach, rock, calm (lakes are calm).
- Swell crosses open sea at 3.2 px/s. Rivers flow (5 eighths of a unit a second on easy reaches, 9 on steep). Falls
  pour at 15 px/s; the spray at each foot breathes about every 2 s, each on its own beat.

## Places (seed 3, the shipped 10240 world, `public/world/ae1d17a8da49/manifest.json`)

- Start (6878, 3816), heading (0.8, −0.6): offshore by the town.
- `town-0` (6814, 3710), with a harbour. `abbey-0` (7798, 3126), about 1150 cells (19 s of cruise) from the start.
  Five each of lighthouse, bridge, (ruined) cathedral, windmill and yew.
- Wonders and their anchors: cove-hotel (pontoon, cove), drowned-church (tower), railway (shore, halt, far), baths
  (quay, funicularFoot, funicularTop), observatory (dome), bridge-town (west, east, upstream, downstream), marsh-house
  (gate, firm, lamp), airship-mast (mast), great-oak (crown, swing, village). The floating garden (over open sea) and
  the land-ship (along the widest beach) are live only.

## Life and moments

- Gulls (`live/life.ts`): 9 wheel round the town (within 105 cells of a point 30 cells south of it, seaward) and 5
  round each lighthouse (within 42), 42–64 units up. Gulls rest on beaches and lift when the flier's track passes
  within 46 cells and 60 units; they settle after about 4.4 s. Twelve boats sail out of the harbour and home.
- The world hour (`live/moments.ts`): `WORLD_HOUR` = 240 s of `t`. At the top of each hour the town clock's carved
  figures file out for `CLOCK_LASTS` = 36 s (`clockWindow(t)`). The abbey's bells should keep the same hour.
- Each wonder's moment keeps a seeded clock (`momentSpan`, `momentWindow`: pure): one appearance every 180–480 s,
  lasting 20–60 s, with a 2.5 s fade at each end (`shown`). Where things are, as functions of the anchors and `at`
  (seconds into the appearance):
  - **train** (railway): engine and carriage glide from `shore` to `halt` over the first half and back over the second,
    puffing smoke; it runs on rails hidden under shallow water.
  - **plane** (cove-hotel): the seaplane comes in from 48 cells south of the `pontoon` at 16 units up, lands (by 34 %),
    taxis 8 cells in (to 62 %), then bobs at the jetty.
  - **ferry** (baths): crosses from 42 cells out to the `quay` and back. Steam rises off the pools whenever the baths are
    in view.
  - **church** (drowned-church): ripples on the lake and five birds spiralling up off the `tower`.
  - **marsh**: a lamp flickers and a cart crosses the causeway (`gate` → `firm` and back).
  - **airship** (airship-mast): an airship tied at the `mast`, swinging.
  - **bridge** (bridge-town): two carts cross the bridge, a boat passes under (`upstream` → `downstream`).
  - **oak** (great-oak): a gust streams leaves off the `crown`.
  - **dome** (observatory): the dome turns and opens.
  - **garden**: the floating garden drifts over open sea, 74 units up. **land-ship**: a ship on wheels sails the beach.
- Occasional and rare sights (`live/sights.ts`, `live/rare.ts`): V-flocks, a kite over the town, a fishing boat with
  nets, a rainbow; very rarely a whale breaching, a balloon, a fox, a heron, a tall ship, a monk on the abbey road.
  `?sights=all` holds every rare sight and moment open (a preview).

## The page and the constraints

- Next.js 16 static export on GitHub Pages: no custom headers, so no cross-origin isolation and no
  `SharedArrayBuffer`. AudioWorklet is available (secure context) but cannot share memory with the page.
- `src/app/world/Flight.tsx` runs the frame loop (`tick`, ~60 fps): flight step, `view.frame` (live layers), sky,
  dragon, `putImageData`. `?stats` exposes `window.__flight` (frame ms per frame, sky ms) to `scripts/world-fly.mjs`.
  Current p95 at 4× throttle is about 3.6 ms. Other sessions are changing `Flight.tsx` too (controls and prompts,
  mobile, time of day and weather): keep sound's edits to it small.
- World code: TypeScript run under Node's type stripping (imports end in `.ts`; no enums, namespaces or parameter
  properties; no `node:` imports in browser code). Never `Math.random()` in world code: use `core/rng.ts` and
  `core/hash.ts` (`hash2`, `mix32`). Tests: `node --test` on `src/**/*.test.ts`.
- Art direction: Ink & Glyph, a storybook on cream paper; European Ghibli seaside (Welsh valleys, Adriatic coves,
  alpine meadows, windmills); Gothic, church-built ornament. Original work only: no sampled or copied audio, no melody
  from an existing work.
- Coming soon from other sessions: time of day, seasons and weather (night, rain, mist); a settings menu with reduced
  motion; phones (touch, less CPU). The sound should leave a place for them.

## Tools on this machine

- Puppeteer (headless Chrome, `headless: "shell"`), as `scripts/world-fly.mjs` uses. A page can render the real engine
  offline with `OfflineAudioContext`, stepping automation with `suspend(t)` / `resume()`.
- ffmpeg 8 (`showspectrumpic`, `ebur128`, `astats`, `aspectralstats`), numpy (no scipy, no matplotlib), `afplay`.
