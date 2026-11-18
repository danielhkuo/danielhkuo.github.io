# Dragon world: roadmap

The one list of what is done, what is next, and every idea not built yet. Update it when something finishes, is decided or
is dropped. Details live in the documents it links; this page says what and in which order.

Last updated 2026-11-17.

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
- **First flight** (`/world`). Seed 3 ships as one 3.1 MB file. Workers paint the land ahead of a stand-in kite at
  60 fps, and the start view is ready in about 1.8 s. Plan: `plans/2026-11-17-dragon-world-flight.md`.

## Next: the world comes alive

Everything here is drawn each frame over the baked land (live layers, spec 5.5). Nothing is re-baked and the file
size is unchanged; it is TypeScript running in the browser. Order is a proposal.

1. **Clouds.** The most important. They drift over the land in the Ink & Glyph style: soft washed masses with inked
   edges, several sizes and heights, slow wind, sometimes parting to frame a landmark. Shadows are optional (the owner
   does not need them), but if added they come cheap from the shadow bits. Clouds must never hide the flier for long.
2. **Water that moves.**
   - Waves: surf rolling in along beaches by shore distance, foam lines on rocks and cliff feet, a swell on open sea.
   - Rivers: streaks running downstream along the flow phase.
   - Glints on open water (a first version exists).
3. **Large waterfalls.** Falling water that animates, a spray cloud at the foot, a plunge pool ring. The big falls
   (tall drops on the larger rivers) get the full treatment; small ones a simpler flicker.
4. **Wind in grass and trees.** Gusts brushing across meadows (a tone shift under a scrolling gust field) and crowns
   swaying slightly.
5. **Small life.** Gulls over the harbour and cliffs, boats leaving and returning to the harbour, sheep on upland
   pasture, smoke from chimneys, windmill sails turning.
6. **Occasional fun things.** Common enough to be seen on most flights: a flock of birds in a V, a kite flying over
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

## Interactions

- Landing on a tower or landmark opens that project (needs the landmarks below).
- Flying low startles birds from trees and gulls from the harbour.
- The flier's wake on water, and its shadow on the land (the shadow exists).
- Passing the abbey rings its bell; passing the windmill turns its sails faster.
- Discoveries (rare sights, every landmark visited) remembered in localStorage, with Continue.

## Later

- **The dragon.** An original long, wingless river-dragon as a sprite stack, flight that banks and climbs, its wake.
  The stand-in kite holds its place until then.
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

From the round-9 critics (peaks first):
- Peaks: snow and rock lit from true normals so each arête shows a bright side and a cool far side; horizontal strata
  across walls instead of vertical striping; scree that does not fan like a pinwheel.
- Harbour basin needs a mouth to the sea.
- Upland palette: fresher greens; heather only on small exposed spur crests.
- Break the straight plateau rim (headward re-entrants); the trunk river that reads as a canal.
- Coves and cliff scallops repeat; sea stacks need surf at their base.

From the first-flight review:
- Over land not painted yet, the kite draws over hills that should hide it, and its shadow vanishes.
- Over lakes, the shadow falls on the lake bed and vanishes.
- The stand-in's colours do not come from the palette (moot once the dragon lands).
- Small code cleanups: the worker message types are defined twice; the codec branches on the same node kinds in
  three places.

## Open checks

- Owner: open `/world` in Safari (Chrome is measured; Safari is not).
- Housekeeping: about twenty old agent worktrees under `.claude/worktrees/` and their branches can be removed (every
  `fable-*` branch is merged).
