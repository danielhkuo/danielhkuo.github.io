# Sound for the world: design

2026-11-18, revised the same day after the critique (`research/2026-11-18-sound-design-critique.md`) and the
judge's rulings. Status: design, for build. Nothing here is built yet. §12 lists what each critique finding changed.

Read with: `research/2026-11-18-sound-factsheet.md` (**Facts**), `research/2026-11-18-sound-research-engine.md`
(**Engine §n**) and `research/2026-11-18-sound-research-recipes.md` (**Recipes §n**). This document states decisions
and deltas only. Where it is silent, the research notes' recommendations hold.

Words used here. **Pose**: the dragon this frame. **Hearing**: what the ear found in the land around the dragon.
**Places**: the fixed sites and anchors. **Cue**: one scheduled sound event; its `t` is the world time its sound
*starts*. **Kit**: the buffers made after unlock. **Lane**: one of the sectors of shore whose waves are being
played. **Wave emitter**: a chain that plays one wave at one fixed place. **Slot**: a pooled chain for one point
source. `t` is always the page clock in seconds, the same `t` the live layers get.

---

## 1. Architecture

### 1.1 Files

```
src/world/sound/
  control.ts        static, tiny: prefs, state machine, gesture arming, the ear's capture layer, lazy import, probe
  prefs.ts          the localStorage keys, the volume law
  types.ts          Pose, Hearing, Places, Census, Cue, Targets
  places.ts         Places from a LayerContext
  ear.ts            the bake scan and the coast scan → Hearing
  census.ts         point sources alive at t (sites, gulls, moments) with world positions
  space.ts          distance gain, air, pan, north/south cue, Doppler
  mix.ts levels.ts  Pose + Hearing + Census + prefs → Targets; every level constant, with units
  clock.ts          world time → audio time
  schedule/         waves.ts bells.ts gulls.ts chimes.ts tune.ts moments.ts   (pure events(t0, t1))
  synth/            noise.ts controls.ts envelopes.ts bubbles.ts ir.ts        (pure Float32Array generators)
  sound.worker.ts   runs synth/* off the main thread
  engine/           engine.ts graph.ts slots.ts scheduler.ts kit.ts
                    wind.ts sea.ts waves.ts river.ts falls.ts bells.ts gulls.ts clockwork.ts
                    train.ts plane.ts ferry.ts flock.ts            (later: airship.ts cart.ts dome.ts oak.ts)
  bench/            scenes.ts render.ts wav.ts repeat.ts
src/app/world/SoundToggle.tsx, sound.module.css
src/app/world-sound/page.tsx, SoundBench.tsx
public/world-sound/flight.json      a recorded flight for the bench
```

Every file outside `engine/`, `sound.worker.ts` and the React pieces is pure and has a `*.test.ts` beside it.
`engine/` is the only code that touches Web Audio. It takes a `BaseAudioContext`, so the page and the offline
render run the same code. Fable builds all of it.

Edits to existing files, all small:

- `Flight.tsx`: create the control in the effect; `layers: [...makeLayers(ctx), sound.ear]`; `sound.world(ctx)`
  once the world has loaded; in `tick`, after `view.frame`, one call
  `sound.frame(t / 1000, flight, restShare(phase))` whose result is pushed to `probe.soundMs`, and
  `probe.soundState = sound.state()`; `sound.dispose()` in the cleanup; `<SoundToggle>` first in the JSX. **The key
  handler is not touched** (§7 says how the toggle avoids needing it).
- `live/water.ts`: export `SET`, `SETS`, `STEEP` and `warpTile`.
- `live/life.ts`: export a pure `wheelersOf(ctx)`, `eachShoreGull(f, seed, fn)` and `flee`.
- `live/moments.ts` (approved): export pure `trainAt`, `planeAt`, `ferryAt`, `cartAt`, `figureOut(i)` and, with
  the later moments, `gustOf`, `swingOf`, `domeOpen`. Its own draw functions call them, so picture and sound share
  one source. No change in what is drawn; the existing tests hold all three files.
- `scripts/world-fly.mjs`: `--soundlog <file>`, and the kit's share of `soundMs` reported apart (§9.3).
- `scripts/world-sound.mjs`: writes `<scene>.stats.json` from the render's `stats`, and does not abort the run
  when one scene fails.

### 1.2 Data flow

```
view.frame ─ ear layer: keeps f.bake, f.rect, f.t, f.flier                 (returns at once when off)
tick ─ sound.frame(t, flight, rest):
  every frame   1  ear.step       bake rows and grid nodes in proportion to the time passed (a pass per 100 ms)
                2  scheduler      cues in [until, t + lookahead) → engine.play(cue, when)
                3  kit.step       at most one slice of kit work, capped in time
  at 30 Hz      4  census         the point sources alive now, with world positions      (pure)
                5  mix            Pose + Hearing + Census + prefs + memory → Targets      (pure)
                6  engine.apply   Targets → setTargetAtTime, only where a threshold is crossed
  returns the main-thread ms of all of it (0 when off)
```

Steps 4–6 run when 1/30 s has passed since their last run, whatever the display rate. Every smoothing time is
60 ms or more, so 30 Hz is enough, and a 120 Hz display does no extra work.

### 1.3 The plain objects

```ts
interface Pose { t: number; dt: number; x: number; y: number; alt: number; heading: number; speed: number;
                 bank: number; rest: number }            // rest = restShare(phase)
interface Area { e: number; dx: number; dy: number; d: number }   // energy, direction sum, mean distance
interface ShorePoint { sector: number; cell: number; kind: 0 | 1 | 2 | 3; bend: number; x: number; y: number;
                       w: number }
interface FallPoint  { x: number; y: number; h: number; run: number; w: number }
interface Startle    { key: number; x: number; y: number; t0: number }
interface Hearing {
  t: number; ready: number; lanes: number;  // share of the frame that was baked; the lane mask this pass used
  surf: [Area, Area, Area];                 // beach, shingle, rock: in the frame, beyond the lanes' reach
  far: Area;                                // coast the bake does not speak for, from the land grid
  sea: number;                              // share of the frame that is open sea
  river: Area; stream: Area; white: Area;   // wide river, stream, white water (riffles and unbound falls)
  shores: ShorePoint[];                     // ≤ 16: up to two shore cells per sector
  falls: FallPoint[];                       // ≤ 4
  startled: Startle[];                      // ≤ 6 beach gulls just lifted
}
interface Places { worldId: string; seed: number; n: number; forced: boolean; abbeys: Pt[]; towns: Pt[];
                   lighthouses: Pt[]; gulls: Wheeler[]; wonders: { type: string; x: number; y: number;
                   level: number; height: number; anchors: Record<string, [number, number]> }[] }
```

All are JSON-safe. Point positions are world-absolute and wrapped, so offsets are recomputed (with `torusDelta`)
as the dragon moves. Area sums are relative to the dragon and good for the 100 ms a pass lasts.

### 1.4 Recording and replay

- `/world?stats&soundlog` records `probe.soundLog = { v: 1, worldId, places, prefs, frames, hearings }`: one Pose
  per frame plus the index of the Hearing in force, up to 120 s, whether sound is on or off.
- `world-fly.mjs --soundlog <file>` adds `&soundlog` and writes that object.
- The bench scene `flight-replay` loads `public/world-sound/flight.json` and feeds it to the real mix and engine.
  The bench refuses a log whose `worldId` is not the shipped world's, and takes a dropped log file.

### 1.5 States

| State (`probe.soundState`) | Meaning | Context |
| --- | --- | --- |
| `off` | Not wanted. | None, or suspended and awaiting disposal. |
| `waiting` | Wanted, but no gesture has started it yet (or a rebuild needs one). | None, or made but not `running`. |
| `running` | Wanted, context `running`. | Running. |
| `suspended` | Wanted, but hidden, frozen or interrupted (internally `hidden` or `interrupted`). | Suspended. |

- `off → running`: the toggle's click. In the handler, synchronously, `control.ts` runs
  `new AudioContext({ latencyHint: "playback" })` and `resume()`, and sets `navigator.audioSession.type =
  "ambient"` where it exists. The engine module arrives by `import()` and is handed the context. Making the
  context in the static stub keeps Safari's activation rule.
- Page load with a stored "on": `waiting`. The control starts `import()` and arms capture listeners on `window`
  for `keydown`, `pointerup` and `click`.
  - They ignore modifier keys and Escape (Chromium grants no activation for those; Shift is a boost key).
  - They ignore events inside the sound UI (the toggle handles its own click, below).
  - On a qualifying event they make the context if there is none, and call `resume()`.
  - **They are removed only when `ctx.state === "running"`.** Until then every later gesture calls `resume()`
    again.
- While `waiting`, a click on the toggle **starts** sound; it does not turn it off.
- `running → off`: the mute fade (§6.7), `suspend()` after 300 ms, engine disposed after 30 s still off.
- `running ⇄ suspended`: `visibilitychange`, `pagehide`/`pageshow`, `statechange` to `interrupted`.
- `suspended → waiting`: recovery failed (§6.8). The listeners are re-armed and the hint shows again.

### 1.6 Dispose and rebuild

`engine.dispose()` stops every source, disconnects the master and closes the context. The kit survives (its
buffers are not tied to a context), so a rebuild is graph construction only, sliced like kit work.

---

## 2. The ear

Runs only while sound is on (or `?soundlog`). A pass takes 100 ms of page time whatever the frame rate: each frame
does the share of rows and nodes that the time since the last frame calls for.

### 2.1 The bake scan (what is in the frame)

- **The lattice is fixed to the land**: samples are the bake pixels with even `bx` and even `by` (bake space), about
  200 × 113 = 22,600 a pass. Nothing flickers as the camera moves a pixel.
- Each band reads its own row above from the current frame, so no neighbour test spans two camera positions.
- Each sample gets a class from `EAR[material]` and its tone:

| Class | Rule |
| --- | --- |
| haze | material 0. Counted for `ready`; otherwise ignored. |
| sea / lake | `sea`, `seaClear` / `lake` |
| river | material `river`, tone < 8 |
| stream | material `river`, tone 8–13 (a 1 px stream, shaded by the ground under it) |
| white | material `river`, tone ≥ `FALL_TONE` (14); or tone 12–13 whose left or upper sample is fall-toned; or a river or stream sample whose depth differs from a river neighbour's by ≥ 2·`STEEP` (a riffle, as water.ts draws it) |
| fall | material `river`, tone ≥ `FALL_TONE` (also white) |
| land, with a shore kind | beach: `sand`, `sandPale`, `duneGrass`. shingle: `shingle`. rock: `boulder`, `rock*`, `cliff*`, `scree*`. calm: everything else, and all `isBuilt` ground. |

- **Shore crossings.** A sample and its left or upper neighbour form a crossing when one is sea or lake, the other is
  land, and their depths agree within 96 eighths of a row (water.ts's `near`, doubled for the stride, chunk base
  added). A left–right pair straddles a shore running north–south and stands for **2.5 cells** of it (rows are 2 px,
  2.5 cells, apart); an upper–lower pair stands for **2 cells**. Kind: the land sample's; a lake shore is calm. Place:
  the water sample, world x = `wrap(bx)`, world y from `worldRowAt`.
- **Shingle follows the picture.** water.ts draws shingle with the rock animation. The ear reports shingle as its
  own kind and the shingle wave is timed to the rock clock (§4.3).
- **Weights.** `d` is the 3D distance from the dragon; `g(d) = 30 / max(d, 30)`.
  `w = length · g(d)² · edge · win`, with `edge = smoothstep(0, 24, pixels to the nearest frame edge)`.
  `win = smoothstep(50, 130, d)` **only where the crossing's sector holds a lane** (the engine hands the ear the
  lane mask each pass; it is recorded in the Hearing); elsewhere `win = 1`. So near surf is left to wave emitters
  where there are some, and stays in the bed where there are none.
- **Area sums** per kind (beach, shingle, rock): `e = Σ w`, `dx = Σ w·ux`, `dy = Σ w·uy`, `d = Σ w·d / e`, with
  `(ux, uy)` the unit vector from the dragon to the sample. Calm crossings feed no Area. A straight shore at
  distance h gives `e ≈ π·30² / h`: 3 dB per doubling, as a line source should.
- **Rivers.** Each river, stream or white sample stands for 5 cells²: `w = 5 · (25 / max(d, 25))² · edge`.
- **Open sea.** `sea` = the share of samples that are sea with no crossing within 16 pixels.
- **Shore points.** Eight 45° sectors round the dragon. Shore is cut into 32-pixel cells fixed in bake space
  (`cell = hash(bx >> 5, by >> 5)`). In each sector the two heaviest cells (by `Σ length · g² · edge`, no `win`)
  are reported, each with the crossing nearest its cell's centre: kind, place, and
  `bend = warp[((by >> 1) & 255) << 8 | ((bx >> 1) & 255)]`, the byte water.ts reads there.
- **Falls.** Fall samples are grouped by 16-pixel column; a group grows down the frame while the next fall sample
  is within 6 rows. A group gives its foot's place (world, wrapped), `run` (rows top to foot; ≥ 9 is tall, as
  `TALL_FALL`), `h` (ground height at the foot) and `w = count · (40 / max(d, 40))² · edge`. The four heaviest are
  reported; the rest stay in `white`. There is no memory of falls that left the frame: the edge window fades them.
- **Startled gulls** are not the ear's work any more; the census checks them at 30 Hz (§5.3).

### 2.2 The coast scan (what the bake does not speak for)

- Reads `ctx.land.ground` (8 cells a node) in a disc of 56 nodes (448 cells) round the dragon, about 9,850 nodes a
  pass.
- **Symmetric crossings**: every (node, east neighbour) and (node, south neighbour) pair of which exactly one is
  sea is a crossing of 8 cells, placed between them. Land to the west or north of the water counts the same.
- **Hand-over per node, not per frame.** A crossing outside the frame has weight `8 · g(d)²`. One inside the frame
  is projected to its pixel (sea level): if that bake pixel is haze the grid speaks in full; if it is baked the
  grid's weight is `8 · g(d)² · (1 − edge)`. The bake's `edge` and the grid's `1 − edge` sum to one, and a haze
  patch is covered by the grid until the moment it bakes.
- Sums go to `far`. Lakes are not in the grid; they are heard only in the frame.

### 2.3 Cost

About 3,800 bake reads and 1,650 grid reads a frame at 60 Hz. An estimate of 0.03 ms at 1× is not good enough to
plan on: the ear is measured at 4× at the end of phase 2 (§9.3). No allocation per frame; two preallocated
Hearings are swapped on publish (the log copies).

---

## 3. The mix (pure)

`mix(pose, hearing, census, prefs, memory) → { targets, memory }`. `targets` is one Float32Array with named
indices. `memory` holds the few eased values. `prefs` = `{ volume, headphones, calm, touch }`; `calm` is reduced
motion.

### 3.1 Space, per point source (`space.ts`)

**Everything is measured from the dragon.** For a source at world (sx, sy), height sh: `dx`, `dy` by `torusDelta`
from the dragon, `dz = alt − sh`, `d = hypot(dx, dy, dz)`.

Delta from Engine §1 rec 1 (pan from the frame's centre): while flying the two are the same; landed, the camera
sits up to 64 cells east of the landmark to clear the Codex, which would throw the abbey hard left with the rider
on its tower and slide the whole stage on every landing. From the dragon, the camera's move is silent.

- **Pan** `= P · dx / sqrt(dx² + dy² + 30²)`, `P = 0.85` (0.42 when calm).
- **North/south** `b = dy / sqrt(dx² + dy² + 30²)`; for `b > 0`: cutoff × `(1 − 0.35·b)`, gain × `10^(−1.5·b/20)`.
- **Distance gain** `G(d) = (ref / max(d, ref))^p · (1 − smoothstep(0.75·max, max, d))`:

| Class | ref | max | p | Used by |
| --- | --- | --- | --- | --- |
| small | 25 | 300 | 1 | gull, lap, flock, small fall, cart |
| medium | 40 | 450 | 1 | train, plane, ferry, clock, tall fall, dome, oak, airship |
| bells | 60 | 1500 | 0.7 | the abbey |
| wave | 30 | — | 1 | wave emitters, × `1 − smoothstep(80, 130, d)` |

  The bells' exponent of 0.7 (Engine §1 rec 6 has 1) gives −18 dB at the start point instead of −26 dB: faint but
  present under cruise wind. Accepted as the default.
- **Air** `fc = clamp(1500 / sqrt(d / 1000), 800, 18000)` Hz, times the south factor, times `occlusion` (an input
  fixed at 1 for now). Sent as `detune = 1200·log2(fc / 1000)` on a k-rate low-pass with `frequency = 1000`.
- **Filter Q.** For Web Audio's `lowpass` and `highpass`, Q is in decibels. **Every low-pass and high-pass in this
  design has Q = −3.01 dB** (Butterworth) unless a number is given. Band-pass and peaking Qs are linear.
  `levels.ts` states the unit beside every Q, and a test reads the built graph.
- **Reverb send** `= S · (1 + 2·smoothstep(ref, max / 2, d))`. S: bells −12 dB, gulls −16 dB, clock −20 dB, all else
  0. The whistle and the horn have their own echo (§4.9).
- **Doppler** (train, plane, ferry; later the airship): `v = −d(d)/dt` eased with τ 150 ms;
  `cents = clamp(1200·log2(343 / (343 − 0.12·v)), −45, 45)`; 0 when calm. Delta from the note's 0.25 and ±100: at
  cruise past the running train (closing at 78 cells/s) that gave a fall of two semitones; this gives under one.
  Each moving slot has one ConstantSourceNode holding the cents, connected to the `detune` of every source and
  noise filter in the slot, so a long whistle bends while it sounds and one-shots still carry no automation.

### 3.2 Beds

- **Surf bed.** `Eb, Es, Er` = beach, shingle, rock energies; `Ef` = far.
  `hiss = kH·sqrt(Eb + 0.6·Es + 0.35·Er)`, `body = kB·sqrt(Eb + Es + Er + 0.25·Ef)`,
  `rumble = kR·sqrt(0.6·Eb + 0.6·Es + Er + Ef)`, `rattle = kV·sqrt(Es)`.
  **Direction** is the sum of the beach, shingle, rock and far Areas, each weighted as it feeds `body`
  (1, 1, 1, 0.25); never calm. With `e` that sum's energy: `p = 0.85·dx / e`, `spread = 1 − hypot(dx, dy) / e`,
  `w = 0.8·spread`; when `e = 0`, `p = 0`, `w = 0.8` and every gain is 0. The two decorrelated halves pan to
  `clamp(p − w)` and `clamp(p + w)`. The hiss band's low-pass is `air(d̄)`.
- **Open sea** `= kO · smoothstep(0.3, 0.9, sea)`.
- **River bed.** `flow = kF·sqrt(E_river)`, `brook = kK·sqrt(E_stream + 0.3·E_river)`,
  `riffle = kW·sqrt(E_white)`. Pan and spread as the surf bed (same `e = 0` guard); low-pass `air(d̄)`.
- A bed whose every gain is under −60 dB for 2 s is stopped and disconnected; it restarts at gain 0 when one gain
  passes −54 dB.

### 3.3 Wind, whoosh, speed

`s = speed / 60`; when calm, `s = 1 + 0.5·(s − 1)`. `ṡ` = ds/dt eased with τ 150 ms.
`push = clamp(ṡ / 1.6, 0, 1)` (0 when calm). `side = sin(heading)` (heading 0 east, π/2 south): the bank cues are
turned into the screen's frame, because the listener faces up the screen. Flying north `side = −1`.

| Target | Formula |
| --- | --- |
| A gain, left / right ear | `kA · s^1.25 · 10^(∓1.5·bank·side / 20)` (left takes −, right takes +). No tilt when calm. |
| A cutoff | `clamp(110·s, 40, 260)` Hz |
| B gain, centre | `kB · s`; `clamp(650·s, 250, 1300)` Hz (gust moves it ±15 % in the graph) |
| C gain, low-pass | `kC · max(0, s − 0.6) · (1 + 0.6·push)`; `3000 + 2500·s` Hz |
| D gain i, centre i | `kD · max(0, s − 0.8)` (the squall signal gates it in the graph); `f_i · s · (1 + 0.03·|bank| + 0.05·push)` |
| E gain | `kE · (1 + 0.8·rest)` |
| Whoosh gain | `kW · gate · (1 − rest) · (0.7·min(1, r / 4) + 0.3·|bank|·s)`, `r = |d bank/dt|` eased τ 60 ms, `gate = smoothstep(0.35, 0.6, |bank|)`; 0 when calm |
| Whoosh centre, pan | `500 + 900·|bank|^0.7·s` Hz; `0.3·bank·side` |
| World bus | `10^(−2·clamp((s − 1) / 0.8, 0, 1) / 20) · 10^(−6·rest / 20)` |

- Flying north, a right turn (bank > 0) puts the whoosh and the louder ear on the left, the outside wing.
- The gate's edges are set by the flight model: bank eases at 6/s, so a 50 ms tap reaches 0.27 (gate 0), 100 ms of
  key reaches 0.47 (gate 0.1), 150 ms reaches 0.61 (open). Taps are silent; turns bloom.
- A's exponent is 1.25, not 1.5: brake to boost spans 14 dB on A and 11 dB on B.
- Landing needs no special case: speed falls to 0, so A–D fall away; E, the ground breeze, rises with `rest`; the
  coil's hard bank is silenced by `(1 − rest)` and by `s`; the world drops 6 dB under the Codex.

### 3.4 Ducking, volume, reduced motion

- **Bell duck** (scheduled, not reactive). `bellDuck(t)` (§5.2) is 1 from 150 ms before the hour's first stroke to
  2.5 s after its last. `a = smoothstep(−16 dB, −6 dB, abbey gain)`. Wind and water buses take
  `10^(−3·a·duck / 20)`, `duck` eased at τ 0.13 s down and 0.8 s back. At the start point (abbey at −18 dB)
  nothing ducks; the duck is full within about 120 cells of the tower.
- **Volume** `master = v²`, default `v = 0.7`.
- **Reduced motion**: the `calm` rows above (speed range halved, no swell, no tilt, no whoosh, pan halved, pan τ
  doubled, no Doppler), and sharp one-shots are capped: startle keks and flock clatter −6 dB, bell strike layer
  −4 dB, rock boom −3 dB.

### 3.5 Smoothing and thresholds

| Target | τ | Sent when it moved by |
| --- | --- | --- |
| Slot and wave-emitter gain | 60 ms | 0.5 dB, or on crossing −60 dB |
| Pan | 60 ms (120 ms calm) | 0.02 |
| Bed gains, bed pans | 250 ms | 0.5 dB / 0.02 |
| Cutoffs (as detune) | 100 ms | 50 cents |
| Doppler, wind centres | 150 ms | 4 cents |
| Wind layer gains | 300 ms up, 250 ms down (A), 300 ms (others) | 0.3 dB |
| Whoosh gain | 70 ms up, 220 ms down | 0.5 dB |
| World and duck gains | 130 ms down, 800 ms up | 0.2 dB |

At most one call per parameter per mix. Nothing is sent while suspended. **No `setValueAtTime` is ever made on a
node that is sounding**; values are set outright only under a master at 0.

### 3.6 Levels

`levels.ts` holds every `k`, calibrated in the build against these solo targets (bench scene, volume 1,
integrated LUFS ±1.5 unless marked) and then pinned by the checker:

| Scene | Target |
| --- | --- |
| Wind at brake / cruise / boost | −34 / −27 / −21 |
| Whoosh, full turn at cruise | momentary peak 8 LU under cruise wind |
| Beach at 25 cells, the big wave | momentary peak −20; the lull at least 12 LU lower |
| Rock boom / shingle at 25 cells | momentary peak −19 / −21 |
| Far surf at 250 cells / open sea | −38 / −46 |
| River at 20 cells / small fall at 20 / tall fall at 30 | −33 / −28 / −22 |
| Abbey peal at the tower (60 cells) | −21, momentary max −18 |
| Gull call at 40 cells | momentary peak −30 |
| Clock tune at 60 cells | −27 |
| Train chuff / whistle at 60 | −26 / −21 |
| Ferry horn at 80; seaplane approach at 60 | −20; −24 |
| Flock lift (later: airship, dome, cart −36; oak gust −30) | −30 |
| Inland at brake | −34 ±2 (calm country is the wind alone: the same figure as wind at brake) |
| Three-minute flight | −22 ±2, momentary never above −12 |

The busiest scene decides the master trim: its true peak must stay under −4.5 dBTP.

---

## 4. The voices

Common rules.

- Every persistent voice starts at gain 0.
- A **one-shot** is a slice of a prerendered buffer with its attack and release baked in and at least 20 ms of
  digital silence either side, played with `start(when, offset, duration)` through a static gain. No automation
  is made on a one-shot. One-shots vary ±3 % in rate and ±1.5 dB by hash and never repeat a variant twice running.
- **Every pan is a gain pair**: mono → two GainNodes (`cos`, `sin` of the pan angle) → ChannelMerger. Chosen over
  StereoPannerNode for v1 because it is one code path in every browser, an automated StereoPanner costs five times
  as much (Engine §5), and WebKit's bug 257447 (StereoPanner distorting when panned left) is still open and cannot
  be tested on this machine. Measured here, Firefox 160's StereoPanner is correct, so it stays the documented
  fallback behind one function in `graph.ts`.
- A **chain** is gain → low-pass (k-rate) → gain pair → merger, with a send gain: 6 nodes.

### 4.1 Wind (Recipes §1)

Persistent. Layers A–E as the recipe, with these changes:

1. **Control signals are prerendered.** `synth/controls.ts` writes band-limited random signals into buffers at
   3000 Hz (the lowest rate every engine accepts; confirmed in Firefox 160 here), played at `playbackRate = 0.1`.
   Each loops seamlessly. Lengths as played: gust 61 s, flutter 13 s (two channels, 8–14 Hz), whistle set 47 s
   (six channels: gust and thresholded squall per whistle, already delayed 0.3, 0.9, 1.7 s), drift 97 s (two
   channels, 0.07 and 0.11 Hz). No sub-hertz biquads, the same in every browser, testable in Node.
2. **Stereo by buffer.** Noise buffers are stereo with a set correlation: ρ = 0 for A, ρ = 0.7 for B, C and E
   (`0.922·n1 + 0.380·n2` and the mirror).
3. Whistles share one source: three band-passes (Q 30, 38, 45), three gains, three fixed pans. Absent on touch.

Graph: A = brown ρ0 → low-pass → peaking (250 Hz, +4 dB, Q 1.2) → splitter → per ear [flutter gain] → [level gain]
→ merger. B = pink ρ0.7 → band-pass Q 0.7 → high-shelf (−6 dB, 5 kHz) → gain. C = white ρ0.7 → high-pass 2.5 kHz →
low-pass → gain. E = pink ρ0.7 → band-pass 400 Hz Q 0.5 → low-pass 1.5 kHz → gain [× 0.4 + 0.6·gust]. About 55
nodes. Wind is at the listener: no distance, no world-bus effects.

### 4.2 Turn whoosh (Recipes §2)

Persistent: pink (mono) → band-pass Q 1.1 → gain → gain pair, into the wind bus. Driven by §3.3. No "whump".

### 4.3 Surf (Recipes §3)

**Lanes decide where and when; each wave is its own emitter.**

- A **lane** is one of the four heaviest sectors (two on touch). A sector takes a lane when its weight has beaten
  the weakest lane's by 3 dB for 0.5 s. Changing lanes cuts nothing: a lane only chooses future waves.
- Each frame the scheduler asks `waveCues` for the lane's shore cells (up to two). A cue is played when: its
  `(cell, k, train)` is not in the wave ledger; the lane has not started a wave of that train in the last 2.6 s;
  the lane has fewer than two waves sounding; and a wave emitter is free. The bend is read once, when the cue is
  taken.
- The wave then belongs to a **wave emitter fixed at that place** for its 4 s. Its gain, air and pan follow the
  dragon's motion relative to that fixed place: fly along a beach and the crash falls behind where it broke. A
  sounding wave is never faded to make room. 8 emitters on desktop, 4 on touch.
- After unlock or a return from hidden, a wave whose envelope would still be sounding is rejoined in progress
  (`start(now, offset)` under a 30 ms fade of the emitter's gain).

**A wave is fresh noise shaped by a prerendered envelope.** This replaces the first draft's frozen wave buffers
(listeners learn a repeated noise within a few hearings; five takes per kind would be learned at a landing).

- *Fresh noise.* The kit holds one Gaussian white loop `A` (two independent channels, 262,144 samples) and four
  **sign loops** `S1…S4` (mono, values ±1, lengths 355,343, 418,027, 291,869 and 331,999 samples; each coprime
  with the others and with A's length). All play at rate 1 from the context's start. An emitter's noise is one
  channel of A times one sign loop (the sign loop drives a GainNode's `gain`, whose own value is 0). A Gaussian
  sample with a random sign is still Gaussian white noise. Two streams that share a factor are uncorrelated
  (`E[a·s1 · a·s2] = E[a²]·E[s1·s2] = 0`), so the 8 pairings give 8 independent streams from 5 shared sources. A
  pairing lines up again only after the product of its two lengths, which is 18 days or more at 48 kHz. So no wave ever
  reuses a stretch of noise.
- *Envelope buffers* (`synth/envelopes.ts`, 3000 Hz, one per kind and strength): the recipe's gains and filter
  glides as functions of `u`, written as channels. One AudioBufferSourceNode → ChannelSplitter → the gains' `gain`
  and the filters' `detune`. Every gain's own value is 0, so an emitter is silent before, after and without an
  envelope. Starting a wave is one `start(when)`; nothing is automated from the main thread.

Emitter graph (20 nodes; gains sit before filters, so an idle emitter passes silence and costs almost nothing):

```
A_i × S_j ─┬─ gain[low]  → low-pass (detune: envelope)                     rumble / boom
           ├─ gain[mid]  → band-pass Q 0.8 (detune: envelope)              crash / body
           └─ gain[high] → high-pass (detune: envelope) → low-pass 9 kHz   hiss / spray
velvet × (A_i × S_j) → gain[grain] ─┐
plunge bed → gain[slosh] ───────────┴→ band-pass Q 1.5 (detune: envelope)  shingle rattle / rock slosh
all → sum → chain
```

| Kind | Envelope runs | Starts at | Anchor (the picture's event) | What the channels do |
| --- | --- | --- | --- | --- |
| Beach | u 0.2 → 0.97, 4.0 s | anchor − 1.56 s | u = 0.5, foam on the sand | Recipes §3 beach: rumble from u 0.2 (t² rise), crash centre 500 Hz → `fB` by u 0.5, hiss high-pass 1.2 → 3 → 4.5 kHz, decays as given |
| Rock | u 0.3 → 1.0, 3.64 s | anchor − 0.52 s | u = 0.4, the burst | boom (low-pass 110 Hz, 40 ms attack), spray, slosh on the `plunge` bed from u 0.55 |
| Shingle | u 0.3 → 1.0, 3.64 s | anchor − 0.52 s | u = 0.4 | crash at u 0.4, hiss to u 0.52, rattle from u 0.52, peak 0.70, gone by 0.95, band-pass 5 → 2.6 kHz |

- Strengths 1, 2, 3 are three envelope buffers per kind (the recipe's `fL`, `fB` and levels). Strength 0 (the
  lull) plays one calm lap at −20 dB.
- Both trains play at the same level, as water.ts draws them (`max(I1, I2)`).
- The hiss sizzle (±2 dB, 6–10 Hz) comes from the live flutter signal, not the envelope, so it never repeats.
- Each wave's emitter gain varies ±1.5 dB by hash of `(cell, k, train)`.
- Deltas from the recipe, to tune by spectrogram: the bands filter white noise, not pink and brown (the filters
  set the colour); the 52 Hz sine in the strength-3 boom is dropped; the velvet buffer's impulse positions repeat
  every 4.1 s, but their amplitudes are the fresh noise's; the `plunge` slosh (−12 dB) is the one frozen part,
  read at a hashed offset and rate.

**Surf bed: the surf you cannot resolve.** Persistent: brown ρ0 → low-pass 180 Hz → gain (rumble); pink ρ0 →
band-pass 600 Hz Q 0.6 → gain (body); white ρ0 → high-pass 2.5 kHz → low-pass (air) → gain (hiss); velvet ρ0 →
band-pass 3.6 kHz Q 1.5 → gain (rattle); sum → splitter → two gain pairs. Gains from §3.2. The sum wanders ±1.5 dB
on the two drift signals: bends within earshot average out, so a far shore wanders and does not pulse.

**Calm shores.** A lane whose cell is calm plays lap one-shots (4 prerendered variants) from the lap schedule,
each through a pooled slot at the cell. There is no calm bed.

**Open sea.** Persistent: pink ρ0 → band-pass 700 Hz Q 0.4 → gain × (0.5 + 0.5·drift). No clock.

### 4.4 Rivers (Recipes §4)

Bubble beds `brook`, `flow`, `plunge` as the recipe, made in the worker. River bed, persistent: two reads each of
`brook` and `flow` (seeded offsets, rates 0.94–1.06) feed halves A and B; pink ρ0 → band-pass 1.8 kHz Q 0.6 is the
riffle; each half → low-pass (air) → gain pair. The riffle follows `white`, which now includes steep reaches as the
picture draws them.

### 4.5 Falls (Recipes §4)

Each fall voice, persistent while bound: body (pink → band-pass), hiss (white → high-pass 4 kHz → gain breathing
±2 dB on a drift channel), plunge (`plunge` → low-pass 1.2 kHz), rumble (brown → low-pass 140 Hz → gain); then a
chain. Three chains on desktop for two sounding falls (two for one on touch).

- Tallness `T = clamp((run − 6) / 12, 0, 1)`. Rumble gain ∝ T. Body centre `1600 − 700·T` Hz. A small fall adds a
  `brook` read. Distance: class small for T = 0, medium for T = 1, blended.
- **Identity is by distance.** A reported fall within 12 cells (wrapped) of a voice's place *is* that voice's
  fall; the voice's place follows it at τ 250 ms. No keys, so nothing flickers at a cell edge or the world's seam.
- **Hand-over is a crossfade.** A new fall takes the spare chain when it beats the weaker sounding fall by 6 dB
  for 0.5 s: equal-power crossfade over 0.5 s (uncorrelated signals), then the old chain becomes the spare.
- A fall that leaves the frame fades with the edge window; falls without a voice are heard in the riffle.

### 4.6 Bells (Recipes §5)

**Buffers.** Five bells; tenor nominal 660 Hz, the others × 1.122, 1.189, 1.335, 1.498, each ±12 cents by seed.
Strike notes E4, F♯4, G4, A4, B4: an E-minor pentachord, the key of the clock's tune. Partials, levels, decays,
doublets and old-style offsets as the recipe's table. Changes:

1. Each bell is **two ring takes** (different doublet shares) and **one strike** (the 6 ms noise burst and the
   three 0.25 s partials). A stroke plays a ring and a strike with separate gains: the swinging mouth (strike
   ±2 dB by turns), the hour hammer (strike +5 dB) and reduced motion (strike −4 dB) from the same buffers.
2. Offline at 32 kHz mono (nothing in a bell is above 9 kHz).
3. Ring lengths 10, 9.4, 9.0, 8.2, 7.6 s (tenor to treble). **The last 1.5 s of every ring is ramped to zero in
   the render**, so no buffer ends on a live hum. About 11 MB.
4. At most 3 rings of one bell sound at once (2 on touch). A fourth stroke fades the oldest at τ 0.25 s.

**Chain.** The abbey holds two slots: bells 0, 2, 4 and bells 1, 3, their pans offset ∓0.3 · `near`,
`near = 1 − smoothstep(60, 200, d)`. Landed at the abbey they sit either side of the rider (§3.1).

**Far-away wander.** One drift channel moves each slot's gain (±4 dB · far), the other its cutoff (±300 cents ·
far), `far = smoothstep(150, 900, d)`: level and brightness come and go on unrelated beats, with two depth gains.

Bells never change pitch: no Doppler, no rate jitter. The peal and the hour are schedules (§5.2).

### 4.7 Gulls (Recipes §6)

**A prerendered note library** instead of a live voice per call. Six bird voices (base pitch 620–820 Hz and
formant shift by seed), each with 3 kyows (one with the break), 2 squeals, 2 keks, 1 mew: 48 notes, rendered with
the recipe's source–filter graph offline. About 4.6 MB. `setValueCurveAtTime` is used there only, on fresh nodes.
Gull notes are tonal, short and varied per bird, so frozen takes are safe here in a way wave noise is not.

A wheeler maps to a voice by `h mod 6` and a personal rate of 0.94–1.06. A call is a run of notes (§5.3), each a
one-shot into the caller's slot, which follows the bird as it wheels (with `flee` applied while it is startled). At
most 2 callers at once (1 on touch). Send −16 dB. Class small.

### 4.8 Clock automata (Recipes §7)

Chime notes are prerendered (32 kHz): the recipe's clamped-bar voice, 11 pitches, each ±6 cents by seed. Clacks
and door thuds are strike-voice one-shots. The whirr is a small persistent graph (white → band-pass 2.6 kHz Q 3 →
gain modulated by a 55 Hz sawtooth), alive from 0 to 35 s. One slot at the town, class medium, send −20 dB.

**The procession ignores the picture's `shown` fade.** `shown` is a 2.5 s smoothstep: applied to sound it would
put the doors 28 dB down and the tune's first note 16 dB down. Every cue plays at full level; only the whirr's own
envelope shapes it.

**The ratchet never fights the tune.** The figures step at 4 Hz and are left as drawn. The tune's quavers run at
3.59 Hz, so a 4 Hz tick under it would drift. The ratchet is one prerendered seamless 2 s loop (eight ticks),
played only where no chime sounds: from 0.30 to 0.60 s, and from 0.6 s after the last count stroke until 33.5 s.

**The tune** (original, by hand). E Dorian, 6/8, thirteen bars. One bar is 1.6696 s (a quaver 0.2783 s, about 72
dotted crotchets a minute): chosen so that **three bars are exactly the 5.009 s between one figure stepping out
and the next** (`figureOut(i)`). Each figure enters on the first beat of a phrase; the fifth enters on the last
note. Durations in quavers:

| Bar | Melody | Low chime (beat 1) |
| --- | --- | --- |
| 1 | E6 2, D6 1, B5 2, C♯6 1 | E4 |
| 2 | D6 2, B5 1, A5 3 | E4 |
| 3 | G5 2, A5 1, B5 3 | B4 |
| 4 | B5 2, A5 1, G5 2, E5 1 | E4 |
| 5 | C♯6 3, B5 2, A5 1 | E4 |
| 6 | F♯5 2, G5 1, A5 3 | B4 |
| 7 | E6 2, F♯6 1, E6 2, D6 1 | E4 |
| 8 | C♯6 2, B5 1, A5 2, B5 1 | E4 |
| 9 | G5 2, A5 1, F♯5 3 | B4 |
| 10 | B5 2, C♯6 1, D6 2, B5 1 | E4 |
| 11 | A5 2, G5 1, F♯5 2, G5 1 | E4 |
| 12 | F♯5 3, G5 2, F♯5 1 | B4 |
| 13 | E5 6 (let ring) | E4 + B4 |

Compass E5–F♯6 (a ninth); mostly steps and thirds; one leap of a sixth (E5 to C♯6, bars 4–5); it ends on the low
tonic. Each note ±12 ms and ±1.5 dB by hash.

*How it was checked.* I reduced it to scale degrees and to its contour (Parsons code
`*DDUUDDDUURDDDUDDDUUUUDDDDDUDUDUUUDDDDUDUDD`) and compared the opening of each phrase, from memory, with the
chime and Dorian tunes it could be taken for: the Westminster and Whittington quarters, Carol of the Bells,
Greensleeves, Scarborough Fair, Drunken Sailor, Morrison's Jig, Swallowtail Jig, Drowsy Maggie, The Butterfly, the
Skye Boat Song, Sumer is icumen in, Frère Jacques. None shares its first seven notes or its phrase shapes: those
open on rising thirds or fifths, pedal figures or repeated notes; this opens on a falling 8–7–5–6–7–5–4. This is a
check from memory, not a database search (open question 1).

### 4.9 Train (Recipes §7)

Position is `trainAt(at, lasts)` from moments.ts: constant speed `v` (18 cells/s on seed 3), reversing at the halt
without stopping. Changes from the recipe:

- **Chuffs follow distance.** A wheel turn is 12 cells: chuff k of a leg falls where the engine has run `3·k`
  cells (6 a second here). Four prerendered chuffs (decay 37 ms); beat levels 0, −2.5, −1, −3.5 dB, the third 4 %
  late; the first four after each start +4 dB; the last 2 s into the halt fall to −8 dB.
- No standing hiss (it never stands). A 0.6 s steam swell marks the turn; its cue starts 0.3 s before the turn.
- Whistle (prerendered, 740 + 988 Hz with breath): long (1.2 s) 1.0 s after leaving the shore; two shorts 2.2 and
  1.7 s before the halt; long again 0.8 s after it.
- **Echo.** A private send, not the shared reverb (whose taps would leave the echo near −30 dB): whistle → delay
  0.7 s → low-pass 900 Hz → −14 dB. The ferry's horn uses the same unit with two repeats (0.9 s at −12 dB through
  900 Hz, 1.7 s at −18 dB through 600 Hz). 7 nodes on the moments bus.
- Wheels and the water sheet as the recipe (pairs every `14 / v` s; spray gain ∝ v).
- Two slots: engine and carriage, 8 cells behind. Doppler on both through their cents source.
- The one-shots ignore `shown`. The continuous parts (spray, hiss) fade in over 0.5 s and follow `shown` only
  through the appearance's last 2.5 s.

### 4.10 Seaplane and ferry (Recipes §7)

**Seaplane** (`planeAt`). Persistent while audible: the recipe's half-order PeriodicWave engine and prop wash,
one slot, Doppler. With `p = at / lasts`: rpm 1900 → 1400 over p 0–0.34; touchdown splashes at p = 0.34 and 0.5 s
later; 850 rpm with the `flow` bed through the taxi; at p = 0.62 the rpm falls 800 → 300 over 2.5 s and three last
pops come 0.35, 0.8 and 1.5 s after. In over 0.5 s, out with `shown`.

**Ferry** (`ferryAt`). The engine thump is one prerendered seamless loop (5.5 beats a second, every fourth
+2 dB), its gain following the ferry's speed; bow wash (`flow` + pink band) ∝ speed. Horn (prerendered, 290 +
366 Hz): one short blast (1 s) 2 s before the quay, one long (3 s; the recipe's 4.5 s is too long for a 51 s
crossing) 2.5 s after leaving. Echo as §4.9. One slot, Doppler.

### 4.11 Church flock and startled gulls (Recipes §7)

Three prerendered flap buffers. A flock is one slot at its centre.

- **Flaps are the drawn downstrokes.** Birds are drawn at 7 sprite frames a second over a 4-frame cycle: 1.75
  beats a second each. A bird's flap sounds when its frame index turns to the down-wing frame (church bird `b`:
  `(floor(at·7) + b) & 3`; startled gull: `floor(t·7 + (g & 3)) & 3`). Five church birds give 8.75 flaps a second
  between them, staggered as drawn. The recipe's 3–10 Hz rates are dropped; the sprites are not changed.
- Drowned church: the first three beats of each bird +6 dB (the lift's clatter); level falls 12 dB as they finish
  rising (`p` = 0.18). Ripples: a lap every 1.2–2 s. One-shots ignore `shown`.
- Startled beach gulls: up to 4 birds, 1–3 kek runs in the first second, flaps fading over the 4.4 s aloft.

### 4.12 Later moments (designed, built after the five above)

Airship, marsh and bridge carts, the dome, the oak and the baths' steam are met rarely. They are built in their
own phase once the clock, train, seaplane, ferry and church flock are judged done.

- **Airship** (`swingOf`). Two PeriodicWave oscillators at 52.0 and 52.6 Hz → low-pass 600 Hz. A flap and a creak
  at each end of the swing (every 10.13 s of `t`). One slot, class medium, Doppler.
- **Carts** (`cartAt`). **One prerendered seamless loop per cart kind** (hooves at four a 1.1 s stride, wheel
  impacts at 12 a second in two streams, a loose-board rattle; 8.8 s, eight strides): stone for the bridge (with
  the parapet slap baked in), hollow for the causeway (resonances halved, decays × 1.5). One source per cart, not
  hundreds of one-shots. Marsh: one slot. Bridge: two slots, and an oar dip every 1.6 s for the boat.
- **Dome** (`domeOpen`). Motor and gear tone, a rail-bump loop, three shutter squeals at `p` = 0.24, 0.31, 0.40,
  the clunk at `p` = 0.5.
- **Oak** (`gustOf`). Leaf and bough layers as the recipe; their gain is the picture's gust curve. Two creaks.
- **Baths.** Steam and the `brook` bed at −20 dB whenever the baths are within 200 cells.

### 4.13 Not in v1

Town bed, windmill, whale, balloon, heron, tall ship, V-flocks, the land-ship and the floating garden.

---

## 5. Schedules (pure)

Shape: `(…, t0: number, t1: number, out: Cue[]) => void` appends every cue with `t0 ≤ cue.t < t1`, in time order.
**`cue.t` is when the sound starts.** A cue that leads up to a picture event also carries `anchor`, the event's
time, for the tests. No state. All randomness is `hash2` / `mix32` of seed, place and index.

### 5.1 Waves and laps (`schedule/waves.ts`)

`waveCues(point: { cell, kind, bend }, t0, t1, out)`. With `β = bend / 256`, train `j` ∈ {0, 1}, integer `k`:

- `anchor = (k − β − j/2 + ua) · 5.2 + 0.010`, `ua` = 0.5 for beach, 0.4 for rock and shingle (the 10 ms centres
  water.ts's 20 ms clock steps);
- `t = anchor − lead`, `lead` = 1.56 s for beach, 0.52 s for rock and shingle;
- strength `SET[(k + 4·j) mod 9]`;
- cue `{ t, anchor, cell, train: j, k, strength }`.

This is water.ts's `ph = wave + bend`, `ph2 = ph + 128`, set index `(ph2 >> 8) + 4`, restated. Windows tile on
start times, so a wave is always found before its envelope must start.

`lapCues(seed, cell, bend, t0, t1, out)`: half-second slots; a slot holds a lap with probability 0.5 (0.85 within
0.25 s of u = 0), at a hashed moment, with a hashed variant and rate (±20 %).

### 5.2 Bells (`schedule/bells.ts`)

Hour index `H = floor(t / 240)`, top `T = 240·H`. `hourNumber(H) = ((H + 11) mod 12) + 1`: the page opens at
twelve (the sky is midday). One function, ready for the time-of-day work to replace.

`bellCues(seed, t0, t1, out)`:

- **Peal.** Bell `i` (0 the treble … 4 the tenor) has period `P_i` = 1.05, 1.22, 1.41, 1.62, 1.90 s × (1 ± 3 % by
  seed). It enters at `T + 8 + 1.5·i` and rings 22 s. Stroke `k` at `T + 8 + 1.5·i + k·P_i + jitter`, jitter
  ±25 ms by `hash(H, i, k)`. Ring take alternates; strike ±2 dB by turns; the first two strokes are −6 and −3 dB,
  the last two −3 and −6 dB. The peal runs from `T + 8` to `T + 36`.
- **The hour.** Stroke `j` of `hourNumber(H)` at `T + 40 + 2.4·j` on the tenor, hammer version (bell index 5).
- Cue `{ t, H, bell, k, take, ringDb, strikeDb }`.

`bellDuck(t)`: 1 from `T + 7.85` to 2.5 s after the hour's last stroke, else 0.

**The stroke ledger and rejoining.** The engine keeps a ledger of strokes it has started, keyed `(H, bell, k)`,
each with its sources; an entry leaves when its ring ends or is stopped. Every scheduler pass that follows an
unlock, a stall or a return from hidden asks `bellCues` for `[t − 10, t + lookahead)` (the longest ring is 10 s)
and starts only strokes **missing from the ledger**. A missing stroke already past starts in progress: its ring at
`start(now, t − cue.t)` under a 30 ms fade-in, its strike not at all.

- After a hide or a mute everything was stopped and the ledger is empty (§6.7), so every ring that should be
  sounding comes back, once.
- After a stall the context kept running and the ledger still holds the rings that are sounding, so none is
  doubled; only strokes that fell inside the stall are added.

### 5.3 Gulls (`schedule/gulls.ts`)

`gullCues(seed, colonies, t0, t1, out)`. Colonies are the town (9 birds) and each lighthouse (5), from
`wheelersOf`. Time is cut into 4 s slots. `hash(colony, slot)` decides: a call starts (probability 0.25 town,
0.12 lighthouse), when in the slot (0–3 s), which bird, which call (55 % yelp, 20 % kek run, 15 % mew, 10 % long
call). With probability 0.35 a second bird answers 0.6–2 s later. Cue `{ t, colony, bird, call, index }`.

`callNotes(seed, bird, index, call) → { dt, note, rate, db }[]`: as Recipes §6 (long call: 1–3 squeals then 7–11
kyows about 0.29 s apart, 3.4 a second, a tenth either way by the performance and slowing by a tenth at most, each
1–2 % lower and 0.7 dB quieter; kek run: 3–6 at 0.16 s). The kyow's length (0.15–0.2 s), pitch (peaking near
750 Hz for a typical bird) and tempo are read off the published sonogram of a herring gull's long call at
https://fssbirding.org.uk/herringgullsonogram.htm (Irvine harbour, 7 March 2010). Only
colonies within 350 cells are asked.

**Startles.** At 30 Hz the census runs `eachShoreGull` for lattice cells within 64 cells of the dragon and
`startledFor` on the wheelers in earshot. A bird with `0 ≤ tau < 0.3` whose key is not in the startle ledger (kept
5 s) gets `startleCues(seed, key, t − tau, …)`: 1–3 kek runs in the first second and its flaps (§4.11).

### 5.4 The clock (`schedule/chimes.ts`, `tune.ts`)

`clockCues(seed, forced, t0, t1, out)`, with `at = clockWindow(t, forced)`. Seconds into the procession:

| at | Cue |
| --- | --- |
| 0.00 | whirr winds up (0.6 s) |
| 0.30 | doors open: two clacks 60 ms apart and a thud; the ratchet loop until 0.60 |
| `figureOut(i)` = 0.626 + 5.009·i | figure i steps out: a clack. i = 0 is bar 1, beat 1 |
| 0.626 + bar and beat | the tune's notes (`tune.ts`), 13 bars, the last at 20.66 s with the fifth figure |
| 23.2 + 0.9·j | hour count on E4, `hourNumber(H)` strokes |
| last count stroke + 0.6 → 33.5 | the ratchet loop |
| 33.5 → 35.0 | whirr runs down (55 → 20 Hz) |
| 34.6 | doors close |

### 5.5 Moments (`schedule/moments.ts`)

`appearance(seed, kind, t, forced) → { start, lasts } | null` uses `momentWindow` and `momentSpan` (an appearance
beginning inside `[t0, t1)` is found by asking at `t1`). `forced` is the page's `?sights=all`. Positions and
phases come from the functions moments.ts exports, never restated here.

| Function | Cues |
| --- | --- |
| `trainCues(seed, anchors, n, forced, t0, t1, out)` | chuffs by distance run along `trainAt`, wheel-click pairs, whistles, the steam swell |
| `planeCues(seed, forced, t0, t1, out)` | two splashes, three last pops |
| `ferryCues(seed, forced, t0, t1, out)` | two horn blasts; the engine loop's start and stop |
| `flockCues(seed, forced, t0, t1, out)` | each bird's flaps on its drawn downstroke, ripples |
| later: `cartCues`, `domeCues`, `oakCues`, `airshipCues` | loop starts and stops, oar dips; squeals and clunk; creaks; flap and creak at each swing end |

Continuous parts (rpm, wash, gust level) are not cues: the census gives the engine `at` and `lasts`, and each
voice's pure `shape(at, lasts)` gives its targets.

---

## 6. Engine

### 6.1 Graph

```
wind bus ─────────────────────────────────────┐
water bus (surf bed, waves, sea, river, falls)┐│
life bus  (gulls, flocks)                     ├┤→ world bus → world low-pass (20 kHz now; mist later) ┐
moments bus (clock, wonders, echo unit)       ││                                                      ├→ sum
bells bus                                     ┘│                                                      │
reverb: send bus → ConvolverNode → return ─────┘ (into the world bus)          wind bus ──────────────┘
sum → high-pass 25 Hz → volume → compressor → trim → soft clip → mute gain → destination
```

- Compressor as a safety limiter only: threshold −3 dB, knee 0, ratio 20, attack 3 ms, release 250 ms; trim
  −1.7 dB (its fixed make-up); WaveShaper linear to 0.7 then `0.7 + 0.3·tanh((|x| − 0.7) / 0.3)`, no oversampling.
  Phase 0 measures the chain's gain with a −20 dBFS tone and fixes the trim.
- The mix never makes the limiter work. The engine reads `compressor.reduction` ten times a second and keeps the
  minimum as `limiterMinDb`.
- **Reverb IR** (`synth/ir.ts`): 2.5 s stereo, seeded noise, T60 2.2 s, independent left and right, a one-pole
  low-pass sliding from 6 kHz to 1.2 kHz, four early taps between 150 and 600 ms, unit energy,
  `normalize = false`. Never swapped.

### 6.2 Pools and budgets

| | Desktop | Touch |
| --- | --- | --- |
| Pooled slots (point sources) | 12 | 6 |
| Lanes / wave emitters | 4 / 8 | 2 / 4 |
| Fall chains (sounding falls) | 3 (2) | 2 (1) |
| Live one-shot sources, cap | 40 | 20 |
| Rings per bell | 3 | 2 |
| Gull callers | 2 | 1 |

I count differently from Engine §5 rec 2 ("24 voices, 120 nodes"), and say so plainly. At the busiest moment
(boosting along a shingle cove by the town at the top of the hour, a river mouth and a fall near, two gulls
calling) there are about:

- **spatialised chains**: 12 slots + 8 wave emitters + 3 falls + 4 bed halves = 27, of which about 20 sounding;
- **sounding sources**: about 25 persistent (wind, beds, falls, the five shared wave-noise loops) and up to 40
  one-shots;
- **nodes**: about 400 (master and buses 16, wind 55, sea 24, wave emitters 165, river 22, falls 45, slots 72,
  bells' one-shots 36, clock 14, gulls 6). Idle emitters and slots pass silence, which the engines skip;
- **HRTF panners**: 0. (6 if the optional Headphones phase lands.)

Node count is not the cost. By Engine §5's table this is about 4 % of one core on the test machine. The gate is
measured, not estimated: the `busiest` scene, rendered **unstepped** (§8), must take under 5 % of real time. The
touch profile is about half.

**Stealing.** Applies to pooled slots only, never to wave emitters. Priority is class weight plus gain in dB. When
the pool is full a newcomer 6 dB louder than the quietest slot takes it: `gain.setTargetAtTime(0, now, 0.015)`,
sources `stop(now + 0.12)`, rebind at `now + 0.12`. Cues are found at least 250 ms ahead, so the steal is done
before the newcomer sounds. When the one-shot cap is reached, low classes (laps, flaps, wheel clicks) are dropped
unplayed; nothing sounding is cut.

**Culling.** An emitter under −60 dB fades over 300 ms, its sources stop and its slot is freed; it returns above
−54 dB.

### 6.3 Headphones (HRTF): the last, optional phase

Planned, not cut: the owner prizes 3D. Built only after everything else is judged done; until then there is no
Headphones switch in the UI.

- `world.sound.headphones = "on"` swaps six chains (the fall chains and the first pooled slots) to HRTF
  `PannerNode`s **in the same context**, behind a 150 ms fade of those chains. Beds, waves and wind stay stereo.
- Listener at the origin, facing north. A source goes to `(dx, y, dy)` measured from the dragon (as §3.1), scaled
  to a horizontal radius of at least 12 cells. Below the dragon `y = 0`; a source above it (a wheeling gull) is
  raised by `clamp(atan2(−dz, r), 0, 40°)`.
- `distanceModel = "inverse"`, `rolloffFactor = 0`: distance and air stay ours. The north/south cue is off on
  these chains.
- **Headroom.** Measured here, an HRTF panner passes a unit sine at a 1.54 peak on the near ear (+3.7 dB). HRTF
  chains take a −4 dB trim, and the `orbit-hrtf` render must meet the same peak rule as every scene.
- A point source takes an HRTF chain when it starts and keeps it until it ends (the HRTF path is 5 ms late).

### 6.4 Scheduler and the one clock

- Each frame it asks every live schedule for `[until, t + lookahead)` and sets `until`. Cues are start-timed, so
  no sound needs more lead than the lookahead.
- **World time to audio time** (`clock.ts`) is one eased offset `o`, with `when = cue.t + o + 0.025`. The 25 ms is
  about a frame and a half: a frame reaches the screen later than its rAF time, and sound that is a little late
  is not noticed where sound that is early is.
  - Each frame gives a sample of `o`. If `getOutputTimestamp()` exists and its `performanceTime` is non-zero and
    within 0.1 s of `performance.now()`, the sample is `contextTime − performanceTime / 1000` (this aims at the
    moment of hearing). Otherwise (just after a resume, before the first render, or an engine without the method)
    it is `currentTime − outputLatency − performance.now() / 1000`.
  - `o` moves 2 % of the way to each sample, and snaps when a sample is more than 0.12 s away. Both paths are
    eased the same way: there is no second clock.
  - `when` is clamped to `[currentTime + 0.005, currentTime + lookahead + 0.1]`.
  - `lookahead = 0.25 + clamp(currentTime − contextTime, 0, 0.25)`: it grows with the output latency (Bluetooth),
    so cues are still found before they must start.
  - Offline: `o` is exact, with no 25 ms.
- **Stall** (`dt > 0.25 s`). `until = t`; cues whose start has passed are dropped, except bells and waves, which
  rejoin through their ledgers. Nothing is dipped and nothing is set outright: every `setTargetAtTime` simply
  catches up from where its parameter is. The loops never stopped, so a hitch is not turned into a dropout.
- **A jump of the dragon** (more than 200 cells in one frame, as `?at` or a future fast travel): the world bus
  takes `setTargetAtTime(0, now, 0.03)`, the mix runs, and 150 ms later it returns at τ 0.13 s.
- A sharp cue that would start more than 30 ms late is dropped; a soft one starts at once.

### 6.5 Unlock and the kit

In the gesture: context and master chain only, silent. Then `kit.step`, once a frame, does **one slice of at most
0.15 ms**:

1. The worker (`sound.worker.ts`) makes the arithmetic buffers and posts them as transferables: noises, sign
   loops, control and envelope signals, IR, warp tile, velvet, bubble beds. The main thread adopts them with
   `copyToChannel` in slices of 65,536 samples (it takes an offset).
2. As soon as noises and controls are in (about 0.3 s): wind, surf bed and open sea start; the first-enable fade
   begins. Waves need only the envelopes, so surf is whole within a second.
3. Offline renders (laps, gull library, bells, chimes and clockwork, then chuffs, whistle, horn, splashes, flaps,
   loops). An offline graph is **built across several slices**, then `startRendering()` is called once; the
   render itself runs off the main thread. Bells jump the queue when the hour is under 40 s away. A wonder's kit
   is rendered when it is within 600 cells.
4. A voice whose buffers are not ready is silent and comes in at τ 0.5 s when they are.

Everything is ready about 20 s after unlock. Total float memory: about 43 MB on desktop (noise and sign loops 17,
bubble beds 6, bells 11, gulls 4.6, the rest 4), about 28 MB on touch.

### 6.6 Onsets and stats for the checker

In the offline render the engine notes the audio time of **every one-shot it starts** (bells, chuffs, clicks,
clacks, chimes, flaps, keks and kyows, laps, splashes, thuds, pops) and the anchor of every rock and shingle wave
(the boom). That list is `onsets`. `render` also returns `stats`: `{ limiterMinDb, wavesPerMinute (per lane),
repeatMax, audioThreadShare }`, each where the scene asks for it.

### 6.7 Every fade

| Event | Fade |
| --- | --- |
| First enable | mute gain 0 → 1 along a straight line in decibels from −36 dB, 1.5 s (as built; first drafted as `setTargetAtTime` τ 0.5 s, which starts too steeply: §6.9) |
| Mute | τ 0.04 s to 0; at +250 ms **every one-shot and wave envelope is stopped and all ledgers are cleared**; `suspend()` at +300 ms |
| Unmute (engine alive) | `resume()`; on `running`, once any fade-out has reached 0: parameters set to their targets (master is at 0); `until = t`; bells and waves rejoin; a straight line in decibels from −26 dB to 1 over 0.9 s (as built; first drafted as τ 0.15 s) |
| Tab hidden / `pagehide` | in the handler, on the audio clock: hold (cancel + set the value the fade has reached, in every browser: §6.9), linear ramp to 0 over 200 ms, `stop(now + 0.21)` on every one-shot and envelope, already started or still waiting; ledgers cleared; `setTimeout(suspend, 250)` |
| Tab shown / `pageshow` | as unmute |
| Stall | none (§6.4) |
| Dragon jump | world bus τ 0.03 s down, τ 0.13 s back |
| Slot steal, any forced stop | τ 0.015 s, `stop` at +120 ms |
| Distance cull | 300 ms |
| Bed stop / restart | under −60 dB for 2 s / from gain 0 at τ 0.25 s |
| Fall hand-over | 0.5 s equal-power crossfade onto the spare chain |
| Late kit voice coming in | τ 0.5 s |
| A moment's continuous voices | in over 0.5 s; out with the picture's `shown` over its last 2.5 s. One-shots and the clock ignore `shown` |
| Bell ring cap | oldest ring τ 0.25 s |
| Bell or wave rejoin | 30 ms fade-in (`setTargetAtTime` τ 10 ms on the fresh gain: no corner at its end) |
| Interrupted (`statechange`) | the device is already silent and its clock frozen: mute gain set to 0, everything stopped, ledgers cleared; `running` returns as an unmute |
| Landing, take-off | no timed fade: `rest` and speed ease in the game |

Because nothing that was started before a suspension survives it, nothing stale can play on return.

### 6.8 Visibility and recovery

On becoming visible with sound wanted: `resume()`. After 500 ms, if the state is not `running` or `currentTime`
has not advanced 0.1 s: `suspend()` then `resume()`. After another 500 ms still stuck: dispose, state `waiting`,
re-arm the gesture listeners and show the hint. `pagehide` with `persisted = false` disposes. `statechange` to
`interrupted` is treated as hidden. `resume()`'s promise is never trusted; `ctx.state` is.

### 6.9 Browser notes for the build

- **Firefox** (160, measured here under Puppeteer): no `OfflineAudioContext.suspend` (so the bench has an
  unstepped mode, §8); no `cancelAndHoldAtTime` (fallback as above); 3000 Hz buffers accepted;
  `getOutputTimestamp` present; a context starts `suspended` without a gesture. From the compatibility data: no
  `automationRate` (k-rate requests are ignored, so filters run a-rate and cost more) and `latencyHint` ignored.
- **Safari**: cannot be driven on this machine without a settings change. It is on the owner's checklist (§10).
- **iPadOS** reports a Mac user agent: detect it with `maxTouchPoints`.

**The phase 0 spike** (`node scripts/world-sound-spike.mjs`; headless Chrome 148 and headless Firefox 160 on this
Mac, 2026-11-19). What it found, and what the build does about it:

| Question | Chrome 148 | Firefox 160 | In the build |
| --- | --- | --- | --- |
| `OfflineAudioContext.suspend` | yes | **no** | The bench steps in Chrome and renders ahead in Firefox (`mode: "ahead"`); every engine method takes its audio time. |
| `cancelAndHoldAtTime` | yes, **but a ramp after it starts from a stale value once the earlier `setTargetAtTime` has settled** (the gain fell to 0 at once: 1.00 → 0.00 where 0.75 was due) | **no** | Neither is used. The engine keeps the mute gain's fade as numbers and takes it over with `cancelScheduledValues` + `setValueAtTime(the value the fade has reached)`: one path, right in both, and at any future time. |
| Gain pair against `StereoPannerNode` | equal to 0.00 dB at seven pans | equal to 0.00 dB | Gain pairs everywhere; StereoPanner stays the documented fallback. |
| 3000 Hz, six-channel buffer at `playbackRate` 0.1 | accepted; an exact straight line | accepted; within 0.002 of the line, steps 2.5× the ideal (its resampler), smooth | Control signals as designed. |
| `automationRate = "k-rate"` on `detune` | settable | settable (reads back `k-rate`; the compatibility data says it is ignored) | Set on every filter's `detune` and `frequency`. |
| `new AudioBuffer({…})` with no context | yes | yes | The kit is not tied to a context. |
| Limiter (threshold −3, knee 0, ratio 20) on a −20 dBFS tone | +1.71 dB | +1.71 dB | Trim −1.7 dB. The `calibration` scene comes out at −20.00 dBFS. |
| Limiter delay (an impulse) | 6.0 ms | 6.0 ms | `LIMITER_DELAY_S`; onsets are noted at the time they are heard. |
| `compressor.reduction` | **reads −12.3 dB 0.1 s after a context starts and settles toward 0 with τ ≈ 0.33 s** (−6.8 at 0.3 s, −1.1 at 0.9 s) while nothing is reduced: its meter, not the audio | not readable mid-render (no stepping); −0.8 dB right after a 1 s render, the same meter | `limiterMinDb` is read only after 3 s of context time, and is null in ahead renders. The true-peak check (≤ −4.5 dBTP, under the −3 dB threshold) is the proof that the limiter stayed idle. |
| 24 offline renders started at once (2 s each, 32 kHz) | all done in 7 ms | all done in 16 ms | Batched prerenders are safe. |
| A context made with no gesture | `running` (with the autoplay flag) | `suspended`; `resume()` then runs it | `ctx.state` is what is trusted. |
| `getOutputTimestamp()` just after a start or a resume | `performanceTime` **0** for the first 50 ms or more, then fresh | fresh at once | The guard (non-zero, within 0.1 s) refuses the zero; the fallback is used until it turns fresh. |
| What the timestamp says the latency is | 80 ms (`baseLatency` 21 + `outputLatency` 56) | **0**: it is `(currentTime − outputLatency, now − outputLatency)`, a pair on the line through `(currentTime, now)` | With the 25 ms lead, Firefox's sound comes about 47 ms after its frame time where Chrome's comes 25 ms after. Both inside what is taken for in step; not corrected. |
| `outputLatency` | 0 until running, then 0.056 s | 0 until running, then 0.022 s | Read with each clock sample. |

Two things the build found beyond the spike:

- **Chrome's 4× CPU throttle measures short work badly.** It pauses the main thread in slices, so a span of a few
  tens of microseconds either misses a pause or holds a whole one. With the clock read every frame, `soundMs` p95
  at 4× was 0.4 ms though its mean was 0.04 ms. The clock is now sampled ten times a second (eased as the frames
  it stands for would have); p95 is 0.1 ms.
- **A fade-in by `setTargetAtTime` starts too steeply in decibels** (+8.4 LU in its first 100 ms from silence,
  against the 4 LU limit of §9.1). Fade-ins of the whole mix are straight lines in decibels instead (§6.7).

---

## 7. UI

**The toggle.** `<button type="button" role="switch" aria-checked aria-describedby>`, accessible name "Sound"
(constant). Fixed top right (0.75 rem in), 44 × 44 CSS px, first in the DOM so it is the first tab stop. Cream
paper (`#f0e8d2` at 0.85), one-pixel ink line (`#2e2a24`). Focus ring: the game layer's 2 px teal ring (as
`codex.module.css`), with a 2 px paper halo so it shows over dark land. **z-index 30, above the Codex (20).**

- **After a pointer activation the toggle blurs itself**; after a keyboard one it keeps focus. Flight's key handler
  leaves Space and Enter to a focused button, so without the blur a mouse click on the toggle would make the next
  Space switch sound off instead of landing. With it, Flight's handler needs no change.
- While `waiting`, activating the toggle starts sound (§1.5).
- **No keyboard shortcut** is registered (M is the map's).

The icon is a 13 × 7 pixel speaker, an inline SVG of rects at 3 CSS px a pixel, `aria-hidden`:

```
off                 on                  waiting (dots light in turn, 1 a second;
....#........       ....#.....#..        all lit and still under reduced motion)
...##..#...#.       ...##..#...#.       ....#........
#####...#.#..       #####...#...#       ...##........
#####....#...       #####...#...#       #####........
#####...#.#..       #####...#...#       #####.#.#.#..
...##..#...#.       ...##..#...#.       #####........
....#........       ....#.....#..       ...##........
                                        ....#........
```

**Waiting hint.** While `waiting`, a paper strip to the toggle's left (in the top margin, clear of the Codex) reads
"Sound starts with your next key press" ("…your next tap" for coarse pointers). It is the switch's
`aria-describedby` target and a polite live region.

**Options.** While sound is on, a second 44 × 44 button to the toggle's left (a pixel slider glyph, name "Sound
options", `aria-expanded`, `aria-controls`) opens a small paper panel that **opens leftward along the top edge**,
never down into the Codex's column. It holds **Volume** (`<input type="range" min="0" max="100">`, an ink line and
a square thumb, saved to `world.sound.volume`). A **Headphones** switch joins it only when the HRTF phase lands.

- The panel stops `keydown` from reaching `window` (so arrow keys move the slider and not the dragon, and Escape
  closes the panel, with focus back on its button, instead of leaving the page). It does **not** stop `keyup`, so
  a key held while focus moved in is still released in Flight.
- The unlock listeners ignore events inside the toggle, the hint and the panel.
- When the settings menu arrives, the panel's contents move there.

**Screen readers.** The switch announces its state. Sound never starts without a request, a stop control is the
first tab stop, and volume is independent of the system's (WCAG 1.4.2, G170 and G171).

**iOS.** The first time sound runs in a session on an iPhone or iPad (`maxTouchPoints`, not the user agent), the
hint strip shows for 6 s: "No sound? Check that silent mode is off." No storage key.

**Reduced motion** is read with `matchMedia("(prefers-reduced-motion: reduce)")` and followed live.

---

## 8. The bench (`/world-sound`)

A page in the Ink & Glyph style (`robots: noindex`). One row per scene: name, what to listen for, play and stop.
Above the list: volume, reduced motion, and a mute box per bus. Live playing runs the scene's timeline through
the real engine at the display rate.

With `?render` the page sets `window.__sound` as the contract says. `render(name, { sampleRate, mode? })` returns
`{ wav, onsets, stats }` and has two modes:

- **Stepped** (the default where `OfflineAudioContext.suspend` exists, so Chrome): `suspend(k / 60)` →
  `engine.frame(scene.at(k / 60))` → `resume()`. This is the page's own path. (Measured here: stepping costs
  little; 4 s rendered in about 100 ms at 15 Hz.)
- **Unstepped** (`mode: "ahead"`): the whole timeline is run first, with every `setTargetAtTime` and every
  `start` scheduled at its future time, then one `startRendering()`. The engine's `apply` and `play` take an
  explicit time for this. It is how Firefox renders, and how the audio thread is timed (render wall time over
  duration, with no round trips in it). A test holds the two modes to within 0.3 LU on the same scene.

A scene is pure: `{ name, seconds, about, places, prefs, at(t) → { pose, hearing }, actions?, beds? }`. Scenes
that move drive the real `stepFlight` (and `advance`, with the Codex's camera shift, for landing) with scripted
keys. Scenes marked `beds` are also rendered as `<name>-beds`, with waves and every one-shot muted, to judge the
smoothness of the continuous layers alone.

**Actions emulate the frozen clock.** `mute`/`unmute`: the real fades and stops, with the device's `suspend()`
skipped. `hide` at `a`, `show` at `b`: the hide handler runs at `a`; no frames are sent while hidden; the offline
context renders on (silent); at `b` world time jumps forward by `b − a` while context time carries on, exactly as
a real resume looks to the engine. `stall`: no frames for the gap, then one frame with the large `dt`.

| Scene | s | Timeline | What to hear |
| --- | --- | --- | --- |
| `wind-cruise` | 20 | level cruise over meadows | buffet in each ear on its own, rush, gusts that never repeat; no whistle |
| `wind-speeds` | 30 | brake 6, cruise 6, boost 8, cruise 4, brake 6 | pitch and weight rise together; the swell at boost; air "letting go" at brake |
| `turns` | 32 | heading north: left 2 s, level 3, right 4, a fast reversal, four 50 ms taps; then the same heading south | a bloom on the outside wing as seen on screen, both ways; taps silent |
| `surf-beach` | 48 | still, 25 cells off a beach; the whole nine-wave set | build, crash, hiss changing colour, backwash; the big ones; the lull |
| `surf-shingle`, `surf-rock` | 30 | the same at shingle, at a cliff | stones dragging, falling in pitch; boom, spray pattering, gurgle |
| `surf-calm`, `open-sea` | 20 | at a quay; far offshore | sparse laps; a faint wide wash |
| `surf-far` | 30 | 250 cells off a long coast to the west | a low wandering rumble on the left |
| `surf-repeat` | 600 | landed by one beach, only the waves' hiss path | the repetition check (§9.1); the WAV is the first 60 s |
| `coast-run` (beds) | 45 | cruise 40 cells off: beach, shingle, cliff, 15 s each | one shore changing character; each crash left behind where it broke; `wavesPerMinute` per lane |
| `sea-to-coast` (beds) | 40 | from 600 cells out, straight in, across the beach, inland | far rumble first; waves resolve; they pass under and fall behind, duller |
| `cove` | 30 | still, in a cove with shore on six sectors | surf all round, none missing where no lane is |
| `river`, `fall-small`, `fall-tall` | 20 | still, near each | bubbles, not hiss; a loud brook; body and rumble |
| `river-to-fall` (beds) | 40 | up a river to a tall fall and past, the camera sliding | the purl, then the fall rising with no gap, then left behind |
| `bell-stroke` | 12 | one tenor stroke at 60 cells | clang to dark hum; warble; the tail ends in silence |
| `bells-near` | 75 | at the tower through hour 5 | bells entering in turn, drifting; a pause; five strokes |
| `abbey-approach` | 90 | from 1400 cells, 4 s before the hour, to the tower | faint, wandering, mostly hum; clearing on arrival; wind and water yield 3 dB only when near |
| `bells-rejoin` | 40 | unlock mid-peal; a 0.6 s stall at 10 s; hide at 20, show at 24 | tails present at once; nothing doubled after the stall; nothing stale after the hide; the count right |
| `gulls-harbour` | 60 | still, 80 cells south of the town | calls in clusters with silences; answers; birds moving |
| `gull-calls` | 20 | one bird's four calls at 30 cells, then at 200 | harmonics, rasp at the peak only; far, a thin "kyow" |
| `gulls-lowpass` | 30 | a boosted low pass over the harbour beach | keks and flaps on the drawn wingbeats, under the wind |
| `clock` | 40 | at the town, hour 3 | doors and tune at full level from the first note; a figure on each phrase; three strokes; ratchet only in the gaps |
| `train`, `seaplane`, `ferry`, `church-flock` | span + 4 | still, 60 cells off, the moment from start to end | each story in step with its picture; openings not faded |
| `train-pass` | 20 | a cruise pass by the running train | the whistle bending while it sounds; the whole fall under a semitone |
| `landing` (beds) | 30 | approach the abbey, land (camera shifted for the Codex), rest 6 s, take off | wind draining to a breeze; the stage does not slide as the camera moves; bells either side of the rider |
| `toggle` | 16 | by a beach: on at 0, off at 6, on at 9, off at 13 | a slow first rise; clean stops; nothing old on return |
| `hide-show`, `stall` | 16, 12 | by a beach at the hour: hide at 5, show at 9; a 0.6 s gap at 5 | no click, no stale tail, no hole after the stall |
| `reduced-motion` (beds) | 62 | `wind-speeds` then `turns`, calm | half the rise; no whoosh; nothing leaps |
| `quiet-inland` | 20 | brake over meadows | nearly nothing |
| `busiest` | 30 | the busiest moment of §6.2 | everything at once, clear, limiter idle |
| `flight-replay` | 30 | the recorded world-fly route | the game as flown |
| `long-flight` | 180 | a scripted tour: town, coast, river, abbey on the hour | the whole mix, for integrated loudness |
| later: `airship`, `marsh-cart`, `bridge-carts`, `dome`, `oak`, `baths`; `orbit-stereo`, `orbit-hrtf` | | with their phases | |

---

## 9. Acceptance

The judge cannot listen; numbers and spectrograms are his ears. Every promise below is a number the scripts print.

### 9.1 Renders (`node scripts/world-sound.mjs`, 48 kHz, volume 1)

Every scene:

- `clipped` = 0; true peak ≤ −4.5 dBTP; |DC| < 0.001 on each channel.
- `clicks` = 0 outside the onsets.
- `stats.limiterMinDb ≥ −0.5` (the checker fails the scene; the run goes on).
- Correlation ≥ −0.05 (mono-safe).

By kind of scene:

| Check | Scenes | Threshold |
| --- | --- | --- |
| Integrated loudness | every solo scene | the table of §3.6, ±1.5 LU (or as marked) |
| Whole mix | `long-flight`, `flight-replay` | −22 ±2 LUFS; momentary max ≤ −12; LRA 6–14 LU |
| Smooth continuous layers: largest 100 ms momentary step | the `-beds` renders of `coast-run`, `sea-to-coast`, `river-to-fall`, `landing` | rise and fall ≤ 1.5 LU |
| | `wind-speeds`, `turns`, `reduced-motion-beds` | ≤ 2.5 LU (≤ 1.5 calm) |
| Struck sounds and waves | every full render | rise ≤ 8 LU (≤ 6 LU when calm) |
| Fade-ins | `toggle`, `hide-show` | rise ≤ 4 LU. Falls are judged by clicks = 0 (a clean stop empties the meter's window by itself) |
| No hole after a stall | `stall` | momentary loudness in the 1 s after the gap within 2 LU of the 1 s before it |
| Nothing stale, nothing doubled | `hide-show`, `bells-rejoin` | after `show`: no onset in the first 250 ms that is not in the schedule for the new world time; after the stall: momentary loudness of the peal within 1 LU of `bells-near` at the same point of the hour |
| **Waves never repeat** | `surf-repeat` | `stats.repeatMax` < 0.3 (see below) |
| Waves keep the picture's pace | `coast-run` | `stats.wavesPerMinute` per lane between 14 and 30 (a still lane plays 23), and no two starts of one train in a lane closer than 2.6 s |
| Taps | `turns` | momentary loudness during the taps within 0.5 LU of level flight |
| Whoosh side | `turns` | balance toward the outside wing in each turn, heading north and south |
| Doppler | `train-pass` | the whistle's 988 Hz partial moves by less than 100 cents in all |
| Openings | `clock`, `train`, `church-flock` | the first cue's level within 1 dB of the same cue mid-moment |
| Correlation of beds | `wind-cruise` | 0.2–0.6 |
| | `open-sea`, `cove` | −0.05–0.3 |
| | `surf-far` | ≥ 0.6, balance beyond 3 dB to the left |
| Balance | `wind-cruise`, `open-sea`, `cove`, `bells-near`, `clock` | within ±1 dB |
| The lull | `surf-beach` | momentary minimum at least 12 LU under the big wave's peak |
| Audio thread | `busiest`, unstepped | `stats.audioThreadShare` < 5 % on this machine |
| Two engines | `wind-cruise`, `surf-beach`, `bells-near`, unstepped in Firefox 160 | loudness within 1 LU of Chrome's, clicks = 0 |

**The repetition check** (`bench/repeat.ts`, pure, run in the page by the `surf-repeat` scene). The scene renders
ten minutes at one beach with only the waves' hiss path sounding (about 230 waves). Each wave's 4 s is cut out at
its start time and divided by its own 20 ms RMS envelope, which leaves the noise without its shape. For every pair
of waves the normalised cross-correlation is taken over lags of ±2 s, and its largest magnitude kept.
`repeatMax` is the largest over all pairs. Independent noise gives about 0.03; a shared stretch gives near 1.
Pass: `repeatMax < 0.3`. The same function's test feeds it one frozen wave twice and must get more than 0.9, so
the check is known to be able to fail. `world-sound.mjs` prints `repeatMax` and the pair count.

### 9.2 Unit tests

- `space`: gain curves at ref, at max and at the fade's start; bells −18 dB at 1150 cells; air cutoffs at 25, 100,
  500, 1000 m; pan is 0 under the dragon, monotonic, never over 0.85, and does not depend on the camera; the
  ground under the dragon reads `b = 0`; Doppler is under ±45 cents at any speed and 0 when calm.
- `mix`: wind targets at brake, cruise and boost; the swell only while speed rises; the gate is 0 for a 50 ms tap
  and open for a 150 ms turn, stepped through the real `stepFlight`; whoosh pan and A tilt go to the outside wing
  heading north, south, east and west; landing brings world −6 dB and E up; the duck is 0 at 1150 cells and full
  at the tower; direction comes from far surf alone when that is all there is, and `e = 0` gives finite targets;
  determinism; a still scene sends nothing.
- `ear`, on fixture frames: a beach to the east gives `dx > 0`, spread near 0; a cove gives spread near 1; a
  straight shore's energy halves when its distance doubles; **a shore gives the same energy within 0.5 dB running
  north–south, east–west and on both diagonals**; a 1 px stream gives the same energy with the camera at even and
  odd pixels; a shaded stream is not white; a steep reach is; shingle is its own kind; a lake is calm; a tall
  fall is tall; `win` applies only in lane sectors; a pass is the same whatever the frame rate that sliced it.
- Coast scan: **a coast and its mirror image (land to the west, to the north) give the same energy within
  0.5 dB**; with 0 %, 20 % and 100 % haze, and with one haze patch, bake plus grid total the same within 1 dB.
- `schedule/waves`: for 1,000 hashed bends and both trains, a cue's `anchor` lands where water.ts's own phase
  arithmetic (imported `SET`) reads u = 0.5 (0.4 for rock) and the same strength; `t = anchor − lead`; any window
  of 0.25 s that contains `t` returns the cue (it is found before it must start); windows tile; no cue twice.
- Lanes (pure part of `engine/waves.ts`, fed a recorded slide along a coast): no train in a lane starts twice
  within 2.6 s; no sounding wave is stopped by a lane change; a wave's place does not move after it starts.
- `synth/noise`: the five wave-noise loop lengths are pairwise coprime; no pairing realigns within 18 days at
  48 kHz; the product of a Gaussian loop and a sign loop has a flat spectrum and kurtosis near 3; two streams
  sharing a factor correlate under 0.02.
- `schedule/bells`: the stroke count is the hour number for H = 0…23; the peal fits `[T + 8, T + 36]`; jitter
  within ±25 ms; windows tile; `[t − 10, t)` mid-peal returns every stroke whose ring is still sounding. Ledger
  (pure): after a stall no key is started twice; after a clear every ringing stroke is started once.
- `schedule/gulls`: call rates near 0.25 and 0.12 a slot over 10,000 slots; no bird calls over itself; long calls
  have 7–12 kyows with slowing gaps; the same seed gives the same morning.
- `schedule/chimes`: figure i's clack is at `figureOut(i)` (imported) and on beat 1 of bars 1, 4, 7, 10, 13; every
  bar sums to six quavers; the last note is E5; the count matches `hourNumber`; no ratchet cue overlaps a chime.
- `schedule/moments`: chuff k falls where `trainAt` has run `3·k` cells; flaps fall on the drawn down-wing frame;
  whistles sit inside the appearance; cues exist only while `momentWindow ≥ 0`.
- `live/moments.test.ts` (existing) still passes with the draw functions calling the new exports.
- `clock`: a stale or zero timestamp is refused; the eased offset ignores ±40 ms jitter and snaps on a 0.3 s jump;
  `when` never leaves its clamp; the lookahead grows with latency and stops at 0.5 s.
- `control`: Shift, Control and Escape do not disarm the listeners; a context that is not `running` keeps them
  armed; a click on the toggle while waiting ends `running`, not `off`; events inside the sound UI are ignored by
  the unlock listeners; missing or unreadable storage is off; while off, `frame` returns 0 and no context exists.
- `graph` (with a recording stand-in for the context): every low-pass and high-pass has Q −3.01 dB unless listed;
  every pan is a gain pair; no node gets `setValueAtTime` after its first connection.
- `bench`: every scene is deterministic; stepped and unstepped agree within 0.3 LU; `repeat` reports > 0.9 for a
  frozen wave and < 0.1 for independent noise; `wav` writes a correct 32-bit float header.

### 9.3 The frame budget (binding at 4×)

`npm run build`, then five pairs, interleaved, same port:

```
node scripts/world-fly.mjs --port 4371 --seconds 30            (off)
node scripts/world-fly.mjs --port 4371 --seconds 30 --sound    (on)
```

Pass when, **in the 4× throttled run**:

- `soundMs` p95 ≤ 0.30 ms, reported twice: all frames, and frames with the kit's share taken out
  (`probe.soundKit`, a second array beside `soundMs`); both must pass;
- frame p95 ≤ 4.0 ms;
- the median frame p95 with sound on is not measurably above the median with it off: inside the off runs' own
  spread;
- `soundState` is `running`; with sound off, `soundMs` is all zeros and no `AudioContext` exists.

This is first run at the **end of phase 2**, when the ear, the mix and the waves exist, not at the end. If the
ear does not fit, its stride goes to 4 px in `by` (halving the reads) before anything else is cut.

---

## 10. Build order

Fable builds every phase. Each ends with renders, numbers and a verdict before the next starts.

0. **Skeleton and platform spike.** `control`, prefs, states, the toggle, the bench page with both render modes,
   the master chain, the worker and noise buffers, the scheduler with start-timed cues, ledgers and
   stop-on-suspend, the probe fields, `?soundlog`. Scenes: a calibration tone, `toggle`, `hide-show`, `stall`.
   Spike, on this Mac only: headless Chrome and headless Firefox 160 through Puppeteer (gain-pair pan against
   StereoPanner, 3000 Hz buffers, `getOutputTimestamp` just after a resume, a burst of offline renders, the
   unstepped render). No Safari here.
1. **Wind and whoosh**: control signals; layers A, B, D, then C and E, driven by a recorded flight. Scenes:
   `wind-*`, `turns`, `reduced-motion`, and `landing` (with the Codex's camera shift: wind, rest and the pan origin
   meet there).
2. **Surf**: one beach wave on the clock; fresh noise and envelopes; lanes and fixed emitters; shingle, rock,
   laps; both ear scans; surf bed and open sea. Scenes: `surf-*`, `cove`, `coast-run`, `sea-to-coast`. Ends with
   **`surf-repeat`**, a re-run of `hide-show` and `stall`, and **the 4× frame-budget run**.
3. **Bells**: one stroke against the partial table; the distance chain and wander; the peal, the hour, the
   ledger, the duck. Scenes: `bell-stroke`, `bells-near`, `abbey-approach`, `bells-rejoin`; `hide-show` and
   `stall` again.
4. **Rivers and falls**: the bubble beds, the river bed, fall voices and the crossfade. Scenes: `river*`, `fall-*`.
5. **Gulls**: one kyow and one long call against a published sonogram; the library, colonies, startles, flaps.
6. **The five main moments**: the clock (the tune goes to the owner as its own render first), train, seaplane,
   ferry, church flock; the moments.ts exports.
7. **The whole**: `busiest`, `long-flight`, the recorded flight, the frame budget again, the Firefox renders.
8. **Later moments**: airship, carts, dome, oak, baths.
9. **Headphones (HRTF)**, optional: only after 0–8 are judged done.

After each phase the `[U]` numbers in the recipes note that were tuned are written back there.

**The owner's device checklist** (not a gate for the build; it cannot be run here): desktop Safari and iPhone or
iPad Safari (first enable, a sliding touch, lock and unlock, background and return, silent mode, a left-panned
sound for WebKit 257447); Bluetooth headphones (does the bell meet the figures?); a mid-range phone for the touch
profile's load.

---

## 11. Open questions for the owner

1. **The tune.** It is yours to like or not; it comes as its own render in phase 6. My originality check was from
   memory, so I recommend running its contour through a melody index before release.
2. **Falls are heard only once they are in the frame**, because nothing outside it says where falls are (accepted
   for v1). Recommended later: tall falls listed in the manifest at world-build time, so they are heard a few
   seconds before they are seen.
3. **Headphones: birds above.** If the optional HRTF phase is built, I lift gulls above the listener and keep
   everything else level. If the A/B shows the lift distracts, the fallback is the flat plane.

Accepted as defaults, so no longer questions: the first hour strikes twelve; bells carry with exponent 0.7; about
43 MB of buffers on desktop; the reduced-motion set of §3.4; volume in a small panel until the settings menu.

---

## 12. Changes after critique

All 30 findings were accepted; none was rejected. Two were accepted in a different form than proposed (6 and 13),
by the judge's ruling.

| # | Finding | What changed |
| --- | --- | --- |
| 1 | Waves found by anchor start late | A cue's `t` is its sound's start; `anchor` is kept for tests (§5, §5.1). Waves rejoin in progress (§4.3). Test added. |
| 2 | Lanes slid with the dragon | Each wave has its own emitter, fixed where it starts; lanes only choose the next wave, with the 2.6 s rule; no sounding wave is faded (§4.3). `wavesPerMinute` reported and bounded (§9.1). |
| 3 | Suspend left stale and doubled sounds | Every one-shot and envelope is stopped at the end of mute and hide fades; ledgers keyed `(H, bell, k)` and `(cell, k, train)`; the bench emulates the frozen clock; `hide-show`, `stall`, `bells-rejoin` re-run after phases 2 and 3 (§5.2, §6.7, §8, §10). |
| 4 | `getOutputTimestamp` trusted too far | Timestamp guarded (non-zero, fresh within 0.1 s); `when` clamped on both sides; one eased offset fed by either source; lookahead grows with latency (§6.4). |
| 5 | Coast scan heard half the coasts | Symmetric pair rule; mirror test (§2.2, §9.2). |
| 6 | Toggle took Space; a waiting click turned sound off | The toggle blurs after a pointer activation; a waiting click starts sound; unlock listeners skip the sound UI. **No M shortcut** (ruling), and Flight's key handler stays untouched (§1.5, §7). |
| 7 | Double counting under haze | Hand-over per node by the bake pixel at its place (§2.2). |
| 8 | Pan from the screen centre | Pan, north/south and HRTF positions are all from the dragon (§3.1); `landing` models the Codex shift. |
| 9 | `shown` muted the openings | One-shots and the whole clock ignore `shown`; continuous voices fade in over 0.5 s and follow it only at the end (§4.8–4.11, §6.7). |
| 10 | Budget did not close | Binding at 4×: `soundMs` p95 ≤ 0.3 ms and frame p95 ≤ 4.0 ms, no measurable rise; census, mix and apply at 30 Hz; scheduler every frame; ear by time; kit work in 0.15 ms slices, buffers copied in pieces, graphs built across frames; reported with and without the kit; first run at the end of phase 2 (§1.2, §6.5, §9.3). |
| 11 | Unlock listeners fired on dead keys | Modifiers and Escape ignored; disarmed only when `running`; `resume()` on every later gesture (§1.5). |
| 12 | Checks contradicted the sound | Step limits judged on `-beds` renders; 8 LU kept for struck sounds; audio thread timed unstepped; every one-shot is an onset; `limiterMinDb` returned and failed by the checker; rejoin from `t − 10` (§6.6, §8, §9.1). |
| 13 | Frozen wave takes would be learned | Waves are fresh noise (a Gaussian loop times coprime sign loops) shaped by prerendered envelope buffers; the `surf-repeat` scene and `repeatMax < 0.3` make it a number (§4.3, §9.1). |
| 14 | Low-pass Q is in dB | Q = −3.01 dB on every low-pass and high-pass; units in `levels.ts`; graph test (§3.1). |
| 15 | Taps reached the whoosh | Gate `smoothstep(0.35, 0.6, |bank|)`; tested through `stepFlight` (§3.3). |
| 16 | Bank cues ignored heading | `side = sin(heading)` on the whoosh pan and the A tilt (§3.3). |
| 17 | Bed direction left out far surf | Direction from beach, shingle, rock and far, weighted; never calm; `e = 0` guarded (§3.2). |
| 18 | Near surf silent without a lane | `win` only in sectors that hold a lane (§2.1). |
| 19 | River classes misread the bake | Stream is tone 8–13; white is tone ≥ 14, 12–13 beside a fall, or a steep reach by depth (§2.1). |
| 20 | Fall keys flickered | Identity by distance (12 cells, wrapped); a spare chain and a 0.5 s crossfade (§4.5). |
| 21 | Stall dip made a hole | Cut. Past cues dropped, parameters catch up; a dip only on a jump of the dragon; no `setValueAtTime` on a sounding node (§6.4). |
| 22 | UI under the Codex; a key left held | z-index 30; hint and panel along the top edge, clear of the Codex; `keydown` only is stopped. The panel stays, with volume; Headphones joins it only with HRTF (§7). |
| 23 | Census copied the moments' motion | `trainAt`, `planeAt`, `ferryAt`, `cartAt`, `figureOut` (later `gustOf`, `swingOf`, `domeOpen`) exported from moments.ts and used by its own draws (§1.1, §5.5). |
| 24 | Lattice not fixed; lengths swapped | Even `bx`, even `by`; 2.5 cells for a left–right pair, 2 for an upper–lower; the row above read from the current frame; orientation test (§2.1). |
| 25 | Sound led the picture | +25 ms on `when` (§6.4). |
| 26 | Doppler too deep; long one-shots could not bend | Scale 0.12, clamp ±45 cents; one ConstantSource per moving slot feeding every `detune` (§3.1). |
| 27 | Duck reached the start point | Edges at −16 and −6 dB (§3.4). |
| 28 | Flaps and ratchet off the picture | Flaps on the drawn down-wing frame (1.75 a second a bird); figures unchanged; the ratchet plays only where no chime sounds (§4.8, §4.11, §5.4). |
| 29 | Second train at −3 dB | Dropped (§4.3). |
| 30 | Smaller points | North/south from world `dy`; a private echo for whistle and horn; HRTF swaps chains in the same context; gain-pair panning chosen for v1 with StereoPanner as the fallback; batched offline builds; Firefox gaps in §6.9; iPad by `maxTouchPoints` and "silent mode" wording; startles checked at 30 Hz with a 0.3 s window, `flee` applied to wheelers; the teal focus ring with a paper halo; the recorded flight stores its `worldId`. |

After the build's first phases (2026-11-19), by the judge's ruling: §3.6's "inland at brake −40 ±3" contradicted
"wind at brake −34" (inland, the wind is all there is). It is now −34 ±2.

**As built, phase 2 (surf), where it differs from the text above** (each with its reason; the numbers are in
`src/world/sound/levels.ts` and the recipes note):

- **Crossings are read off squares of four samples** (§2.1, §2.2), not off left–right and upper–lower pairs: a straight
  side counts its length, a corner cut off counts half the square's diagonal. Pairs count a diagonal shore by its
  staircase (+41 %); squares hold every direction within 0.5 dB, in the bake scan and in the coast scan alike.
- **Shore cells are kept per sector** (§2.1): a 32-pixel cell that straddles two sectors is reported in each, with a
  point of its own. With one point a cell, a beach 25 cells off had no point in the sector it was nearest in.
- **The shingle's grain is a rough gain, not impulses** (§4.3): noise multiplied by a smooth random signal that moves
  up to 90 times a second. Single-sample "velvet" impulses are clicks by construction and the checker counts them;
  short bumps were tried and still counted.
- **The rock's spray has no separate patter** (the grain and slosh share one band-pass, as §4.3 draws it; a rock wave
  uses it for the slosh).
- **The bed's two halves pan apart by an eased spread**, hard left and right when the surf is all round (§3.2 had
  0.8 · spread, which leaves the halves correlated at 0.31 at best, over the 0.3 the cove is held to; and a coast on
  one side must stay together to hold the 0.6 that far surf is held to).
- **Laps come from one cell in each of the two heaviest calm lanes** (§4.3): with every lane's cells lapping, a quay
  made seven laps a second.
- **An emitter is taken only when it is free now**, not merely by the time the new wave starts, and emitters are taken
  in turn (so every stream of noise is used).
- **The whoosh rises in a straight line in decibels** (18 dB a second from a fifth of its fullest), from the roll rate
  smoothed twice (§3.3 had the rate term at τ 60 ms and a 70 ms rise): a swell with no step.
- **A second high-pass (75 Hz) on the wind bus** (§4.1): under 8 % of the wind's power lies below 60 Hz at boost.

**As built, the audio thread (after phase 2), where it differs from the text above.** The surf scenes took about 6 %
of real time in an unstepped render; these changes bring a scene with no surf near to under 1 % and a surf scene to
about 2.5 % as the page schedules it (3.2–4.0 % in the unstepped render, which cannot take an emitter out of the
graph between waves: every wave of the scene is connected before the render starts). None changes the sound.

- **No loop is played off its rate** (§4.1, §4.3): a buffer played at any rate but 1 is resampled sample by sample.
  The wind's and the beds' noise loops run at exactly 1 (their lengths are unequal and they start at seeded places, so
  they never keep step anyway); a wave's gains are a buffer at the context's rate, and its filter glides are ramps
  written on the emitter when the wave starts, not buffer channels.
- **The control signals are played once** (`engine/hub.ts`: the gust, the flutter, the drifts) and every voice taps
  them. The whistles' squalls are played only while the whistles exist.
- **The wind's fixed filters are in its buffers** (`synth/filters.ts`: the Web Audio biquads as arithmetic, run round
  each loop): the buffet's high-pass and bump, the rush's shelf, the hiss's high-pass, the breeze's band and low-pass.
  The audio thread runs only the one filter of each layer that moves. Costs 4 MB.
- **The whistles and the whoosh are voices of their own**, built when they can be heard (above cruise; in a turn)
  and let go two seconds after.
- **A wave emitter is in the graph only while a wave of its own is sounding**; a fall's chain likewise; a source
  that has ended is disconnected at once. An idle emitter left connected is visited every quantum, node by node,
  to find that it is silent: eight of them took 0.85 % of real time.
- **The hiss's 9 kHz low-pass is one filter after all the emitters**, and the shingle's grain path is opened only
  for shingle waves.

**As built, phase 3 (bells), where it differs from the text above:**

- **Bell buffers are at the context's rate, not 32 kHz** (§4.6): a ring played off its rate costs the audio thread
  for every ring sounding, and a peal has fifteen. About 18 MB at 48 kHz in place of 11.
- **Bells are rendered by plain arithmetic in the worker** (decaying sinusoids), not by offline contexts.
- **Each bell's hum and prime sit within ±20 cents of the table's old-style offsets** (hum +40, prime −30 cents of
  their octaves), by seed, so no two bells are sour in the same way. The other partials are the table's.
- **A stroke's levels** are in `K_BELL`; the peal at the tower measures −21 LUFS, its momentary loudness −18 at most.
- **The abbey is told to the mix as a census source** (§1.3), the nearest of the world's abbeys; its bells are
  taken to hang as high as the dragon flies (the places carry no height).
- **A stroke out of earshot is not started** (the abbey's gain is nothing beyond 1500 cells), and **a ring joined
  after a gap that would be over its bell's cap is not played** (the three newest of each bell are).
- **A cue source may join late** (`engine/scheduler.ts`): the bells' buffers arrive after the wind's, and the rings
  then sounding are joined in progress, once. Bells do not jump the kit's queue (§6.5): jobs run noise, controls,
  surf, river, bells.
- **The reverb's early taps are single samples**, 12 times the tail's level round them at most; the right ear hears
  each up to 1.4 ms after the left. Measured through the convolver and the master chain: T60 2.21 and 2.20 s.

**As built, phase 4 (rivers and falls), where it differs from the text above:**

- **A FallPoint carries `edge`** (§1.3): how far inside the frame's edge its foot is (0 … 1). The voice's level is
  its gain by distance times that, so a fall fades in and out with the frame, as §4.5 asks.
- **Fall voices are followed outside the mix's targets** (`engine/falls.ts`: a pure tracker and the chains), as wave
  emitters are: thirty times a second, each chain's gain, air and pan.
- **A stream feeds the purl a little** (15 % of its energy) as well as the brook (§3.2): a brook's bubbles alone
  leave digital silence between them.
- **A brook's and a river's bubbles come up over 6 and 3 ms** (the recipe's 0.5 ms is kept for the plunge and the
  laps): heard alone, a bubble that starts in half a millisecond is a tick, and the checker counts it.
- **A lattice sample that is land takes river water from the pixel east of it or below it** (falling water first),
  when the frame is gathered to its lattice (`gatherRows`; the ear handed a whole frame gathers it the same way). A
  stream one pixel wide is heard alike on an even column and on an odd one (within 1 dB), and a thin fall is found.
  The page reads two more pixels for each land sample.
- **A tall fall carries**: its distance law is `(40 / d)^0.5` (the medium class has exponent 1), so it stands within
  6 dB of cruise wind from 150 cells in; a fall's voice starts at the level the frame's edge gives it, not from
  nothing. A small fall's brook share is 0.4 (0.8 gave steps of 3 LU on a still fall; now 1.4).
- **The river bed's reads run at fixed seeded rates** in 0.94–1.06 (they do not drift): the four reads cost about
  0.1 % while a river is heard.

**As built, phase 5 (gulls), where it differs from the text above:**

- **Notes are rendered by plain arithmetic in the worker** (§4.7): twenty harmonics of the moving pitch, each weighed by
  the three formants where it falls, not an oscillator graph offline. **Each harmonic starts at its own phase**: all
  in step they make one sharp pulse a period, which the click check counts by the dozen (and is harsher than a gull).
- **A bird's voice is `hash(colony, bird) mod 6`** in the schedule (§5.3), not its wheeler's `h mod 6`: the schedule
  must know a call's length (so no bird calls over itself) without the wheelers. Its personal rate is from `h`.
- **Long calls have one to three squeals and seven to eleven kyows** (eight to fourteen notes, as published for
  herring gulls); the squeals are the loudest and highest notes (to 1.45 B), as the published descriptions have them.
- **`live/life.ts` exports** `wheelersOf` (the layer builds its wheelers with it), `wheelerAt`, `flee`, `fled`,
  `ALOFT`, and `eachShoreGull` (the beach lattice's own arithmetic, beside the layer's loop, which is untouched).
- **The census runs fifteen times a second** in the runtime (§5.3 has thirty): a bird is reported for its first
  0.3 s aloft, so each is seen four times. A Startle carries the bird's hash `g` (its wingbeat's phase).
- **A startled beach gull's keks and wingbeats play from where it rested** (a pooled chain set once), not following
  its flight; a caller's slot does follow its bird.

**As built, phase 6 (the clock, the train, the seaplane; the ferry and the flock follow), where it differs:**

- **`live/moments.ts` exports** `figureP`, `figureOut`, `trainAt`, `planeAt`, `ferryAt`, `flockAt` (and `shown`): the
  layer draws from them and the schedules time themselves by them. The live tests pass unchanged.
- **Everything struck is rendered by arithmetic at the context's rate** (§4.8 had 32 kHz and offline graphs): chimes,
  clacks, thud, the ratchet's loop, chuffs, wheel clicks, whistles, the steam swell, splashes, pops.
- **The ratchet's ticks are registered as onsets**, as one-shots are (a loop of ticks over a quiet whirr is a row of
  sharp starts to the checker).
- **The train is one slot**, not two: the carriage's wheel clicks are delayed by its 8 cells and played from the
  engine's place. Its whistle's echo returns through the same slot.
- **The seaplane's wave leans on its overtones**: the blade pass (harmonic 4 of the half-order, near 50 Hz) is 9 dB
  under the firing line, where the recipe has it strongest; as written the engine lost 8 LU on small speakers.
- **The reverb is built with the bells' buffers whether or not the world has an abbey** (the clock sends to it).
- **A moment is asked for cues, and followed, only within 480 cells.**
- **The ferry's engine and wash follow the picture's `shown` over its last 2.5 s** (they are continuous); its horn
  does not. Its echo is the private two-repeat unit of §4.9, returned through the ferry's own slot. The ferry moves
  at one pace (`ferryAt`), so its engine's level is steady.
- **The baths' steam and pools are built with the ferry** (§4.12 had them later): white through a 5 kHz band riding
  a drift, and the `brook` bed, whenever the dragon is within 200 cells; let go beyond 230.
- **The flock is one slot at the middle of the flock**; its wingbeats are the gulls' flap buffers, its ripples the
  surf's laps. A beat is 12 dB down once the birds have risen, eased over the rise's last third.
- **The seaplane's wave was moved up again** (by ruling): the firing's second and third harmonics lead, and the prop
  wash is 7.6 dB up, so it loses 3.5 LU on small speakers. **The clock's door thud is 3.5 dB down.**

Phase 5, after the sonogram (by ruling): a kyow is 0.15–0.2 s long (0.95 B → 1.21 B → 0.89 B, B = 620 Hz ±10 %),
kyows come about 3.4 a second; a startled bird's keks are levelled alike round 2.8 kHz, fall as the square root of
the small class's law, and three birds at most are voiced at once (each n^−¼ of a lone bird's level). By ruling, the
keks' bar under boost wind is a median of 6 dB or more over the wind in 2–4 kHz with nine in ten at 3 dB or more
(measured: 7.9 dB, 94 %; the wind's own level there swings 10 dB with the gusts); the true-peak margin is kept.

Also by ruling: the fall memory, the stall dip and the second (fallback) clock are cut; HRTF is the last, optional
phase; the rarely met moments have their own later phase with their dense rhythms as loops; the platform spike
runs on this Mac only (Chrome and Firefox), with Safari, iOS and Bluetooth on the owner's checklist; Fable builds
everything.

## 13. After the merge with `world/bigmap` (2026-11-19, built by Opus while Fable was at its usage limit)

- **Where the sound lives now.** `useSound` (src/app/world) makes the control; `useFlight` hands it to `session.ts`,
  whose frame loop puts the ear last in the live layers and calls `sound.frame(t, flight, rest, air)` after the picture,
  with the probe's fields. Reduced motion is the options' `motion: "reduced"` or the system's.
- **The air.** `sound.frame` takes the page's `Air` (sky/air.ts): `mist`, `night` and `rain`, each 0–1, into the
  Pose (absent: clear daylight). Recorded flights carry them as three more columns; older logs read as clear.
- **Mist** muffles the world bus, not the wind at the ears: its low-pass falls from 20 kHz to 3.5 kHz in log frequency
  (`T.WORLD_HZ`, τ 0.2 s) and the world bus by 2 dB, at full mist. Measured (`mist-muffle` against `coast-run`, the
  same flight, 20–30 s): 3.5–8 kHz −4.3 dB, above 8 kHz −5.0 dB, all −0.8 dB under cruise wind; the clear stretches
  match to 0.0 dB.
- **Night**: the gull colonies keep a seeded share of their calls, 1 − 0.85·night (15 % at full night; a smaller share
  keeps a subset of a larger one's, `nightKeeps`). Startled gulls still call. `gulls-night` (the harbour, full night,
  60 s) happened to keep none.
- **Options.** The options panel has a Sound section in its own plates: sound on/off (the same switch as the corner
  speaker, and a gesture that unlocks audio) and volume in five steps, mute 0, soft 0.3, half 0.5, loud 0.7 (the
  default), full 1; mute gives a master gain of exactly 0. Marked as sound UI, so the unlock listeners leave it alone.
- **e2e.** The sound hint is a `role="status"` live region without an `aria-live` attribute, so the flight guide stays
  the page's one `p[aria-live]` (the suite's locator).
- **The frame budget on the merged tree** (`world-fly --arms off,on --pairs 5 --rates 4,1 --warm 8`, load 2–10): at 4×,
  frame p95 3.20 ms with sound against 3.10 without (+0.10, bar +0.15; off runs 2.6–3.6), `soundMs` mean 49 µs (bar
  100), p95 0.4; at 1×, frame p95 2.50 against 2.60 (−0.10), `soundMs` p95 0.1 ms, mean 40 µs. The 1× mean is over the
  25 µs set in phase 2 (it was 14 then): the merged world's gulls along the coast and the census at 15 Hz. To profile
  in the Fable round; the brief's 0.3 ms is met.
- **Waiting for Fable** (after its limit): the rain bed (spec §6.1's world-bus place is ready; `pose.rain` is in) and the
  re-pin of every level against the whole mix (phase 7's `busiest` and `long-flight`).
