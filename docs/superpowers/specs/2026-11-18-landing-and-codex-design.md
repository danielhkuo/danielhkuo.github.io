# Landing and the Codex: design

Status: brief from the coordinating session (2026-11-18): "make the towers do their job: landing on a landmark opens
its project". The calls marked **[Call]** are Claude's; the owner can overturn any of them.

## Why

Each pinned project stands as a landmark, but nothing happens when you reach one. Landing is how the world becomes a
portfolio: you fly to a tower, coil down onto it, and read what was made there. The abbey holds About Me and the
terminal (The Artificer).

## Goals

- At build time, the six pinned repos are matched to sites, and the page knows which site holds which project.
- Near a landmark, a prompt offers to land. A key or a tap lands.
- The dragon slows, circles, and coils down onto the landmark's pad (dragon design, "coiling down onto a site's pad to
  land"). Taking off returns to flight.
- The Codex, an Ink & Glyph overlay, shows the landed site's project from the same GitHub data: name, description,
  language, stars, links. At the abbey it shows About Me and opens the terminal.
- A landing is logged as a discovery, like the rare sights.

## Non-goals

- Re-baking the world, or adding pads, roads or buildings. Every site in today's world already stands a full landmark.
- Fast travel, a map, or Continue. Those are later roadmap items.
- Touch steering. The flight is keyboard-only today; touch gets the land and take-off buttons only.

## Approaches

**How the dragon comes down.**

1. **Guidance onto a shrinking orbit (picked).** Each frame the head steers for the tangent of an orbit round the
   landmark. The orbit's radius shrinks with the angle swept; speed and height ease down with it. The body follows the
   head's path, as it always does, so it is left lying in a coil. Any start works: flying away, the dragon turns round
   first. The sweep is chosen so the head comes to rest on the south side, facing across the camera.
2. **A precomputed curve** from the current state to the rest pose, sampled by distance. The end is exact, but an
   arbitrary start heading makes loops that need special cases.
3. **A cut** to the landed pose. Cheapest, but it loses the coil, which the owner chose.

**Where the assignments are computed.**

1. **The `/world` server page (picked).** It fetches the pins as the home page does, reads the manifest from
   `public/world`, runs `assignSites`, and passes the Codex data to `Flight` as props. The data is about 3 KB, so it
   adds no request.
2. A static `landmarks.json` route, like `fish.json`. It keeps the HTML lighter, but the prompt would wait on a fetch.

**Where it rests [Call].** Round the landmark on its pad: a lighthouse stands out of the coil and the face is in front
of the building. On the roof would hide the pad; in front of the building would put the body in the orchard or the
churchyard trees.

## Controls

| When | Keys | Touch |
|---|---|---|
| Flying | Arrows or WASD steer, Up or Shift speeds up, Down slows, Esc leaves (unchanged) | |
| Near a landmark | Space or Enter lands | Tap the prompt |
| Coming down | Esc pulls up | |
| Landed | Space, Enter or Esc takes off; Tab moves through the Codex's links | Take off button |
| Terminal open (abbey) | Everything goes to the terminal; Esc closes it | Close button |

Arrow keys do nothing while landed, so they can scroll the Codex. Flight keys never reach the page while the terminal
or a Codex control has focus.

## States

```
flying ──Space/Enter or tap, landmark within NEAR──▶ landing ──sweep done──▶ landed
  ▲                                                     │                      │
  └──────────── Esc (pull up) ◀─────────────────────────┘                      │
  └──────────── Space/Enter/Esc or Take off ◀───────────────────────────────────┘
```

- **flying.** `stepFlight` as today. Each frame the nearest landmark within NEAR (110 cells, about 2 s of cruise) is
  offered. The site just left is *quiet*: no prompt until the flier is 1.25 × NEAR away.
- **landing.** The guidance step replaces `stepFlight`. When the sweep completes and the head has stopped, it is
  landed. A 12 s cap lands it wherever it is.
- **landed.** The head holds still where the coil's ring put it. The body settles onto the ground it lies on, lies
  flat, and breathes (the wave swings at a fifth of its flying width); the whiskers hang from the snout. The Codex
  opens and the landing is logged.
- **take-off.** Back to flying, from rest: `stepFlight` eases the speed up to cruise, so the head runs out along the
  coil's tangent and the body unwinds behind it. Until the site is left behind it climbs no more than 0.9 for each
  cell flown, or the head would lift straight up off its body. The site is quiet.

The camera eases from the flier to the landmark while landing, and back over a second after take-off. While landed
on a wide screen it sits a little east, so the landmark shows clear of the Codex panel.

## The coil

- **Anchor.** The landmark's own structure: the tallest built thing within its pad (the bell tower for the town, the
  deck for a bridge), read from the core's structures. Without structures, the site's point and a radius by type.
- **Rest radius** `R = clamp(half-diagonal of the anchor + 3, 8, 26)` cells: just clear of the walls. The body is
  about 58 cells long, so a lighthouse gets a full ring and the abbey less than half a ring.
- **Sweep.** The head turns the way it is already going round the landmark. The sweep ends at the south point and
  is between 0.9 and 1.9 turns.
- **Orbit.** The orbit radius starts at the flier's distance, capped at 48. It eases to R by two-thirds of the
  sweep and holds R for the rest. The heading aims at the tangent, bent in or out by `atan((r − r*) / 10)`. The turn
  rate is capped at 3.2 rad/s.
- **Speed.** The lower of the speed it came in with and 2.2 rad/s × r: about 2.9 s a turn near the end. It eases to
  rest over the last 15 % of the sweep.
- **Height.** The coil's *ring* is the ground at 32 points round R, raised wherever that would bend the body
  steeper than 0.8 a cell: a cliff under the ring becomes a ramp. The head eases from where it was onto the ring (2
  over it, the body's half-height) by 70 % of the sweep, follows it round, and rests at that height: at a cliff's
  foot it lies level with the coil, not on the beach below. It never goes below the ground plus `MIN_GAP`, and never
  changes height faster than 0.8 for each cell flown.
- **The body at rest.** The body lies along the path the head flew, heights and all, so at the moment of landing its
  tail still hangs along the descent. Once landed, each point of it sinks to the same kind of envelope: the ground
  under it plus 2, raised where it would bend steeper than 0.8 a cell, ramping down from the head. Taking off, what
  lay on the ground stays there until the body is drawn off it.
- **Remembering the path.** The chain adds a point only when the head has moved half a cell; otherwise it moves its
  newest point. (Without this a resting head filled the memory with one place in five seconds at 120 Hz, and the
  coil unravelled into a straight line.)
- **Vigour.** Roll, and the throw of the mane, the whiskers and the fin, go with speed (1 at cruise, 0 at rest): a
  curve in the path rolls the body only while it is moving along it.

## The Codex [Call]

Game layer, so it is hand-drawn CSS, not Astryx.

- **The panel.** A sheet of cream paper with an inked double rule and flourished corners, set in IM Fell English.
  A rubricated ¶ line names the landmark ("¶ The lighthouse"). The title has an illuminated capital in vermilion
  and gold. It is a panel on the right on wide screens and a bottom sheet on phones. It is a labelled dialog that
  takes focus when it opens and gives it back when it closes.
- **A project.** Name, description, then a small ledger: language, stars, forks, last worked on. Links: the source on
  GitHub and the homepage when there is one.
- **The abbey.** About Me from `content.ts` (name, title, previously, school, place, what he builds), the links
  (GitHub, LinkedIn, email, résumé), an "Open the terminal" button that opens The Artificer over the scene, and
  "The register": where each project is kept, by compass point and seconds of flight.
- **A landmark with no project.** Its kind and one line, and the same register, so an empty tower still points the
  way.

## Assignments at build time

- `assignSites(manifest.sites, repo names, LANDMARK_CONFIG, previous, n)` runs in `src/app/world/page.tsx`.
- **Sticky [Call].** `src/world/sites/assignments.json` is committed and holds `{ worldId, bySite }`. It is the
  `previous` when its `worldId` is the current world's; a new world starts fresh. When the result differs from the
  file, the build prints the new file to commit. The build never writes it, so a deploy cannot change the source.
- The client checks the `worldId` it is handed against the world it loads, and offers no landings on a mismatch.
- Without world files at build, or without pins, the page still flies; it just offers no projects.

## Discovery

A landing logs `landmark:repo:<name>` for a project (keyed by repository, design 5.4, so a new world keeps it),
`landmark:abbey`, or `landmark:site:<id>` for an empty landmark. The caption reads like the rare sights:
"leaf, at the lighthouse".

## Testing

- **Pure, in `node --test`:**
  - the landmark list (abbey, projects, empty sites, the sticky file, a stale world);
  - anchors from structures;
  - the nearest landmark on the torus;
  - the state machine's transitions;
  - the guidance as properties from 72 starts. It lands within 12 s, at the south point within 3 cells, at rest
    height, never below the ground. Its heading never jumps, and its speed only falls in the final part;
  - the ring: over a gentle slope the head follows the ground; across a cliff it never steps steeper than the body
    bends, and it rests on the ring at the cliff's foot;
  - take-off: no climb steeper than 0.9 a cell;
  - the chain: a stopped or crawling head keeps its path; settling ramps from the head and bridges a drop;
  - the dragon: it keeps its coil through 30 s of rest, lies flat once stopped, and sinks onto the ground.
- **In the browser:** fly, land at the abbey and at a project tower, read the Codex, take off. Screenshot each step.
  `scripts/world-fly.mjs` measures frame time; it never lands, so it measures the same flight as before.

## Files

- `src/world/sites/`: `landmarks.ts` (build-time list), `anchor.ts`, `landing.ts` (guidance, machine, camera),
  `assignments.json`.
- `src/world/dragon/`: the breathing at rest (the wave's swing scales down).
- `src/app/world/`: `page.tsx` (build-time data), `Flight.tsx` (wiring), `Codex.tsx` and `codex.module.css`.
- `?at=<site id>` starts the flight 150 cells south of a site: a preview, like `?sights=all`.
