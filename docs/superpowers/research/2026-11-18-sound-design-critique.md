# Sound for the world: critique of the design

2026-11-18. A critic's review of `specs/2026-11-18-world-sound-design.md` (**Design §n**), checked against its three
research notes and the code at b7b68df. Nothing was built or changed. "Measured" means computed here from the shipped
code (seed 3); the scripts lived in the session scratchpad and are not committed.

**Blocking**: ships broken behaviour, or fails the design's own checks. Fix in the design before building.
**Should fix**: a defect, or a risk to the owner's bar, with a cheap fix. **Consider**: polish, or a choice to make
knowingly.

---

## Blocking

### 1. Waves start up to 1.3 s late: cues are found by their anchor, but their buffers start before it

- **Where:** §5.1, §4.3 (the buffer table), §6.4.
- **Wrong:** a beach wave's cue time is its u = 0.5 anchor, but its buffer starts 1.56 s earlier (rock and shingle:
  0.52 s). The scheduler asks only for cues in `[until, t + 0.25)`, so a wave is found at most 0.25 s before its
  anchor: 1.31 s after its buffer should have started (0.27 s for rock). A `start()` in the past starts now. Either
  the crash lands 1.3 s late, or, started with an offset, the buffer cuts in mid-swell. Any cue centred on its anchor
  (the train's 0.6 s steam swell at the turn) has the same fault. No test in §9.2 catches it.
- **Fix:** a cue's `t` is when its buffer starts (`anchor − lead / rate`). Keep `anchor` in the cue for the tests.
  Windows then tile on start times. Add a test: no wave starts after its start time, and its anchor lands on
  water.ts's u. After unlock or resume, rejoin a wave whose buffer is still sounding, as bells do
  (`start(now, offset)` under a 30 ms fade).

### 2. Lanes slide with the dragon, so the waves stop following the picture

- **Where:** §4.3 "Lanes", §5.1 (last paragraph).
- **Wrong:** one cause, three faults.
  - *Cadence.* A lane plays the waves of the point it is bound to, and that point slides along the shore with the
    dragon. Measured on the seed-3 warp tile, indexed exactly as water.ts reads it (water.ts:380, 419): a point
    sliding at cruise changes its bend by a median of 0.16 and a 90th percentile of 0.37 periods a second (max 0.61;
    at boost, p90 0.43 and max 0.77). One train's own cadence is 1/5.2 = 0.19 waves a second. So along a coast a lane
    swings between no waves at all (its anchors run away faster than time passes) and about three times the drawn
    rate. The `(k, j)` memory stops replays. It does not stop bunching or stalls.
  - *Place.* A sounding wave is panned by its lane's current point. Flying along a beach, the crash rides along
    abeam, instead of falling behind you where it broke.
  - *Cuts.* A lane that loses fades at τ 50 ms: a wave mid-crash drops 20 dB in 115 ms. Along a coast, lanes swap
    often (3 dB for 0.5 s is a low bar).
- **Fix:** make each wave its own emitter, fixed for its 4 s at the place and bend where it starts (a pooled slot,
  or a 3-node chain per sounding wave; at most 8 sound at once). A lane then decides only where and when its next
  wave breaks. It reads the bend once per cue, never starts its train again within 2.6 s, and never fades a sounding
  wave to rebind. `coast-run` should report waves per minute per lane.

### 3. Suspend freezes one-shots, resume plays them stale, and rejoin doubles them

- **Where:** §5.2 "Rejoining", §6.4 "Stall", §6.7 (mute, hide, show), §8 (actions).
- **Wrong:** `suspend()` stops the audio clock. Every source already started, and every cue already scheduled (0.25 s
  of cues, plus the wave pre-rolls), waits, then plays out after `resume()`, out of step with the picture: the end of
  a wave from a minute ago, a bell tail from the last hour. The rejoin query then starts the same strokes again. After
  a *stall* the context never stopped, so rejoin starts a second copy of rings that are still sounding: +6 dB if in
  phase, a comb if a few milliseconds off. The bench cannot see any of this, because offline "suspend() of the device
  is skipped".
- **Fix:** at the end of every mute or hide fade (master at 0), `stop()` every one-shot and clear lane memory. Keep a
  ledger of started strokes, keyed by (H, bell, k), and rejoin only strokes missing from it. In the bench, emulate the
  frozen clock: on `hide`, stop calling frames; on `show`, jump world time by the hidden span while context time
  carries on. Re-run `hide-show`, `stall` and `bells-rejoin` after phases 2 and 3, not only in phase 0.

### 4. The world-to-audio mapping trusts `getOutputTimestamp` too far

- **Where:** §6.4 "World time to audio time".
- **Wrong:**
  - Chromium returns the pair captured at the last render callback: `output_position_` is written only in
    `HandlePreRenderTasks` (third_party/blink/renderer/modules/webaudio/audio_context.cc). Just after a resume, that
    pair is from before the suspension: `contextTime` matches, but `performanceTime` is as old as the hide. So
    `when = contextTime + (cue.t − performanceTime)` lands as late as the tab was hidden. Before the first render it
    is zero or stale. Only a lower clamp exists. The first rejoin after a tab comes back can therefore schedule a
    burst of bell strokes far in the future.
  - The mapping aims at the heard time, so it subtracts the output latency. With 0.25 s of lookahead, any output
    latency above about 0.22 s (Bluetooth often comes close) maps every cue into the past. Sharp cues more than
    30 ms late are dropped; soft ones play late.
  - The two paths differ: the fallback is eased, the main path takes each frame's jitter raw.
- **Fix:** accept a timestamp only when its `performanceTime` is non-zero and within 0.1 s of `performance.now()`;
  otherwise use the offset path. Clamp `when` to `[currentTime + 0.005, currentTime + lookahead + 0.1]`. Ease the
  offset on both paths, and snap only on a jump. Set the lookahead to `0.25 + (currentTime − contextTime) + the
  largest lead`. `getOutputTimestamp` ships in Chrome 57, Firefox 70 and Safari 14.1
  ([BCD](https://github.com/mdn/browser-compat-data/blob/main/api/AudioContext.json)), so the fallback is a guard,
  not a second clock.

### 5. The coast scan, as written, hears only half the coasts

- **Where:** §2.2.
- **Wrong:** "A sea node with a land neighbour to the east or south is a crossing." That counts only coasts whose land
  lies east or south of the water. A coast with land to its west or north makes no crossing, so its far surf is
  silent. The bake scan (§2.1) is symmetric ("one is sea or lake, the other is land"); the grid scan is not. No
  listed test has a west- or north-facing coast.
- **Fix:** count every (node, east neighbour) and (node, south neighbour) pair where exactly one is sea. Test: a coast
  and its mirror image give the same energy within 0.5 dB.

---

## Should fix

### 6. The toggle takes Space after a mouse click, and a click while waiting turns sound off

- **Where:** §7 "The toggle"; §1.1 ("The key handler is not touched"); §1.5.
- **Wrong:**
  - Most browsers focus a clicked button; Safari does not
    ([MDN](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/button)). Flight's key handler leaves
    Space and Enter to any focused button (Flight.tsx:52–54, 225–227). After turning sound on with the mouse in
    Chrome, the next Space ("Land at the abbey · Space") turns sound off instead of landing.
  - With a stored "on", the page waits for a gesture. A visitor who clicks the toggle to start sound fires the
    capture `pointerup` unlock first (now running), then the toggle's own click, which turns sound off.
- **Fix:** after a pointer activation, blur the toggle (keep focus after a keyboard one). While waiting, a click on
  the toggle starts sound and does not flip it; the unlock listeners skip events inside the sound UI. Add the `M`
  shortcut the research proposed (Engine §6 rec 1), inactive while a field has focus. So the key handler, which §1.1
  leaves alone, does change.

### 7. The bake/grid handoff counts twice while haze shows

- **Where:** §2.2 (`inFrame`).
- **Wrong:** the grid's weight is `1 − ready′·edge′`, but the bake scan's weight has no `ready′`. At 20 % haze,
  `ready′ = 0`, so the grid speaks for the whole frame while the bake still speaks for the 80 % that is baked. The
  surf bed rises about 2.5 dB, then falls as chunks arrive. A haze patch inside the frame also pops in at full weight
  when it bakes, since the edge window covers only the frame's edges. The §9.2 test "total unchanged within 1 dB"
  would fail.
- **Fix:** hand over per node, not per frame. When the coast scan meets a node inside the frame, read the bake at its
  projected pixel: if baked, the bake scan speaks; if haze, the grid does. The two then sum to one wherever haze lies.

### 8. Pan from the screen centre puts the abbey's bells hard left once landed

- **Where:** §3.1 "Pan"; §6.3; §8 `landing`.
- **Wrong:** landed on a wide screen, the camera sits 64 cells east of the landmark to clear the Codex
  (Flight.tsx:57–58, 186). Panned from the screen centre, the abbey sits near pan −0.75: bells 0, 2, 4 at −1, bells
  1, 3 at −0.44. Its distance is nearly zero, so it is the loudest thing in the mix, hard left, with the rider on the
  tower. Every landing and take-off also slides the whole soundstage by up to 0.75 of pan in 0.7 s (`FOCUS_RATE`
  1.4, landing.ts:40). The bench's `landing` scene will not show it unless it models `codexShift`.
- **Fix:** pan from the dragon's place on screen. While flying that is the frame centre, so nothing else changes;
  landed, the bells sit round the rider and the camera's move is silent. Use the same origin for HRTF positions and
  the north/south cue (see 30).

### 9. Moments multiplied by `shown` lose their openings

- **Where:** §4.8 ("Everything is multiplied by the picture's shown"); §6.7 "A moment's start and end".
- **Wrong:** `shown` is a 2.5 s smoothstep (moments.ts:138–140). At the clock's doors (0.30 s) it is 0.04, which is
  −28 dB. At the first figure and the tune's first note (0.63 s) it is 0.16 (−16 dB), and the whirr's wind-up
  (0–0.6 s) is 16 dB down or more. The train's departure whistle (1.0 s) is −9 dB; the church flock's lift clatter, in its first second, is
  −20 to −9 dB. These are the moments' signature sounds.
- **Fix:** one-shots and the whole clock procession ignore `shown`. Continuous voices fade in over 0.5 s and follow
  `shown` only at the end.

### 10. The frame budget does not close

- **Where:** §9.3; §6.5 (last paragraph); §2.3.
- **Wrong:**
  - Today's p95 at 4× is 3.6 ms against 4.0 (fact sheet): 0.4 ms of headroom at 4×. The design allows a soundMs p95
    of 0.30 ms at 1×, which is about 1.2 ms at 4×. Its own other rule (no more than 0.15 ms above "off" at 4×)
    implies under 0.04 ms at 1×. They cannot both be the target.
  - "One job every 400 ms" is 1 frame in 24 at 60 Hz (4.2 %), not under 3 %. Buffer adoptions add more heavy frames
    (`copyToChannel` of `flow` alone is 2.5 MB). The 16 s kit build falls inside the 30 s fly window, so kit frames
    set the p95.
  - At 120 Hz the ear, census and mix run twice as often for nothing.
- **Fix:** make the 4× run binding: soundMs p95 ≤ 0.3 ms at 4×, frame p95 ≤ 4.0. Run census, mix and apply at 30 Hz
  (every τ is at least 60 ms); keep the scheduler every frame; drive the ear by time, not frames. Copy buffers in
  slices (`copyToChannel` takes an offset). Build an offline graph across several frames, then call `startRendering`
  once. Report the budget with and without the kit build, and measure it at the end of phase 2, not phase 8.

### 11. The unlock listeners fire on keys that cannot unlock

- **Where:** §1.5 ("Page load with a stored on"); §7 (waiting hint).
- **Wrong:** Chromium grants activation on keydown only for keys that are neither modifiers nor Escape
  (third_party/blink/renderer/core/input/keyboard_event_manager.cc: `!is_modifier && dom_key != ESCAPE`;
  [crbug 709765](https://crbug.com/709765)). Shift is a boost key (Flight.tsx:46). A visitor who boosts first makes a
  context that never starts, and the one-time listeners are gone. The same happens if any armed event fails to
  activate (a sliding touch in Safari, WebKit bug 248265, per Engine §3).
- **Fix:** ignore modifier keys and Escape. Disarm only when `ctx.state === "running"`. While waiting, call
  `resume()` again on every later gesture.

### 12. Several acceptance checks contradict the sound they judge

- **Where:** §9.1, §8, §6.6, §9.2.
- **Wrong:**
  - The ≤ 1.5 LU limit on a 100 ms momentary step, for `coast-run`, `sea-to-coast` and `landing`: a crash 10 dB over
    the bed with a 300 ms attack moves 400 ms momentary loudness 2–3 LU in one 100 ms hop. Either the waves fail the
    check, or they are flattened to pass it. `abbey-approach` is also a struck-sound scene (≤ 8 LU), so two rows
    disagree.
  - "Render time under 4 % of real time" for `busiest`: the render is stepped by a `suspend`/`resume` round trip
    every 1/60 s (1,800 of them in 30 s), and that wall time is counted too.
  - The onset list names bells, chuffs, clicks, clacks, chimes, clops, flaps, keks and pops, but not laps, booms,
    splashes, thuds, bumps, oar dips or kyows. The LPC detector will flag those as clicks.
  - `render` "throws if the limiter worked". world-sound.mjs:92 awaits `page.evaluate` with no catch, so one tripped
    scene aborts the whole run with no report.
  - §5.2 rejoins `[t − 6, t)`, and §9.2 tests that this "returns exactly the strokes still ringing", but rings last
    7.6–10 s.
- **Fix:** judge transitions on beds-only renders (one-shot buses muted) or on 3 s short-term loudness; keep the 8 LU
  rule for struck sounds. Time the audio thread on an unstepped render with its automation scheduled up front, or
  subtract a stepped empty-graph baseline. Record every one-shot's start as an onset. Return `limiterMinDb` and let
  the checker fail the scene. Rejoin from `t − 10`.

### 13. Five prerendered takes per wave kind will be learned

- **Where:** §4.3 "Why prerender".
- **Wrong:** listeners learn a repeated frozen noise within a few repetitions and keep it for weeks
  ([Agus, Thorpe & Pressnitzer 2010](https://pure.qub.ac.uk/en/publications/rapid-formation-of-robust-auditory-memories-insights-from-noise/));
  a review notes the memory survives the noise being sped up
  ([Seitz 2010](https://www.faculty.ucr.edu/~aseitz/pubs/Seitz10.pdf)). So ±3 % rate and ±1.5 dB will not hide five
  4 s buffers. Landed at a lighthouse or the town, a visitor sits by one beach for minutes, with up to eight waves
  every 5.2 s drawn from those five.
- **Fix:** decide in phase 2, with a 3-minute landed listening test, before building rock and shingle. Cheapest
  remedy: render each strength's rumble, crash and hiss as separate takes, and combine one of each by hash at play
  time. That is 3 × 4 × 4 combinations from 11 buffers per strength, in the same memory. Or keep live noise and drive
  its gains and `detune` from prerendered envelope buffers: fresh noise every wave, still no main-thread automation.

### 14. Low-pass and high-pass Q are in decibels

- **Where:** §3.1 "Air" (Q 0.707), and every low-pass and high-pass in §4.
- **Wrong:** for `lowpass` and `highpass`, Web Audio reads Q in dB
  ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/BiquadFilterNode/Q)). "Q 0.707" is a linear Q of 1.085: a
  +1.7 dB peak at every air cutoff, moving with distance. Unset Qs default to 1 dB: a +2 dB bump at wind A's moving
  110·s Hz cutoff, the surf and fall rumbles, and the 25 Hz master high-pass. The research assumes Butterworth.
- **Fix:** Q = −3.01 dB on every low-pass and high-pass. State units in `levels.ts`. Test the graph builder.

### 15. A tap on a turn key does reach the whoosh

- **Where:** §3.3 ("a 50 ms tap on a turn key never reaches it").
- **Wrong:** bank eases at 6/s (flight.ts:24, 79). After three 60 Hz frames it is 1 − 0.9³ = 0.27, past the gate's
  top at 0.25, and |d bank/dt| near 6 nearly fills the rate term. A 50 ms tap makes a whoosh a few dB under a full turn's,
  not silence; a two-frame tap still opens the gate to 0.71. The `turns` scene ("taps silent") would fail.
- **Fix:** `gate = smoothstep(0.35, 0.6, |bank|)` (100 ms of key reaches 0.47, 150 ms reaches 0.61), or gate on the
  time spent turning.

### 16. The bank cues are in the rider's frame; everything else is in the screen's

- **Where:** §3.3 (A tilt, whoosh pan).
- **Wrong:** the louder outside ear and the whoosh pan (−0.3·bank) ignore heading, but the listener faces north
  (§3.1). Flying down the screen, a right turn's outside wing is on the screen's right, and the whoosh goes left.
  Flying east or west, the outside wing is up or down the screen, and the pan is arbitrary.
- **Fix:** pan = `0.3·bank·sin(heading)` (heading 0 east, π/2 south); the same factor on the A tilt. Flying north it
  equals the design's −0.3·bank.

### 17. The surf bed's direction leaves out far surf

- **Where:** §3.2 ("Direction and spread come from the sum of the four Areas").
- **Wrong:** the four Areas are beach, shingle, rock and calm. `far` feeds body and rumble, but not direction.
  Offshore, with only far surf, `e = 0`: the bed sits centred, or is NaN. `surf-far` expects the balance "beyond
  3 dB toward the coast". Calm feeds no bed gain, yet steers it.
- **Fix:** take direction from beach, shingle, rock and far, weighted as their energies feed the bed; never calm.
  Guard `e = 0`.

### 18. Near surf in a sector without a lane is silent

- **Where:** §2.1 `bedWin`; §4.3.
- **Wrong:** `bedWin` takes every crossing under 50 cells out of the bed, but only 4 lanes exist (2 on touch). Over
  a cove, 4 of 8 sectors lose their near surf entirely.
- **Fix:** apply `bedWin` only to crossings in sectors that hold a lane.

### 19. The river classes misread the bake

- **Where:** §2.1 (class table); §4.4 (delta).
- **Wrong:** river tones 0–7 are flow phases; 8–13 are 1 px streams, 8 plus the shade of the ground under them
  (cells.ts:577, 1011). Tones 12 and 13 are white water only inside a fall column, which water.ts tests with
  `isFallPair` (water.ts:494–501). So "white = tone ≥ 12" turns every shaded stream into a riffle. Meanwhile the
  picture draws riffles on steep reaches from depth differences (water.ts:457–477). The design skips those because
  "the ear would need neighbour depths", but it already reads the neighbour for the shore test.
- **Fix:** white = tone ≥ 14, or 12–13 next to a fall-tone sample. Steep = a depth difference to the neighbour sample
  of at least 2·`STEEP` (it is two pixels away).

### 20. Fall voices drop out when their key flickers

- **Where:** §2.1 "Falls"; §4.5 "Identity".
- **Wrong:** a fall's key is a hash of its foot's place in 16-cell units. As the camera moves, the foot's computed
  world row shifts by a row; at a cell boundary the key flips. A flip rebinds the same voice (out at τ 40 ms, in at
  τ 50 ms), so a steady roar gaps for about 0.3 s. Unwrapped x (`rect.x + px`) flips the key at the world's seam
  too. The research asked for a 150 ms crossfade instead.
- **Fix:** match by distance: the nearest remembered fall within 12 cells keeps its voice, in wrapped coordinates.
  On a real handover, crossfade on a spare chain (three fall chains on desktop) over 0.5 s.

### 21. The stall dip makes the hole it means to hide

- **Where:** §6.4 "Stall"; §6.7.
- **Wrong:** on any `dt > 0.25 s` the world bus drops at τ 10 ms (−43 dB by 50 ms) and returns over 400 ms. During a
  stall the context kept running and the loops kept playing; only new cues stopped. The dip turns a hitch nobody
  would hear into a 0.4 s dropout. "Every parameter is set to its target" also steps the wind, which is not dipped.
- **Fix:** on a stall under about 2 s, drop past cues and let `setTargetAtTime` catch up from where each parameter
  is. Dip only on a jump of the dragon (more than 200 cells, as `?at`). Never `setValueAtTime` on a bus that is
  sounding.

### 22. The Codex and the sound UI overlap, and the panel can leave a key held

- **Where:** §7.
- **Wrong:** the Codex is fixed on the right at z-index 20, centred, up to `min(86vh, 46rem)` tall
  (codex.module.css:25–40). On a 768 px tall laptop, with its content at full height, its top is about 54 px down:
  under the toggle (12–56 px), the hint strip and the panel. The panel also stops `keyup`, and Flight releases a held
  key only on keyup or blur (Flight.tsx:240–245). A key held while focus moves into the panel (Shift, for boost)
  stays held.
- **Fix:** give the sound UI a z-index above the Codex, and open the panel to the left, clear of it; or close the
  panel when the Codex opens. Stop `keydown` only.

### 23. The census copies the moments' motion instead of reading it

- **Where:** §1.1 (edits); §4.8–4.12; §5.5.
- **Wrong:** the brief says to read where things are from the same data the live layers use. water.ts and life.ts
  export what the sound needs; moments.ts does not. The train's `across`, the seaplane's path, the ferry, the carts
  and the clock's 1.15 / 0.16 / 0.02 constants (moments.ts:979–984) would be restated under `src/world/sound`. A
  change to the picture (a dwell at the halt, new figure timing) would silently break the sound.
- **Fix:** export pure `trainAt`, `planeAt`, `ferryAt`, `cartAt` and `figureOut(i)` from moments.ts. Use them in both
  places, and test the schedules against them.

### 24. The ear's lattice should be fixed to the land, and its crossing lengths are swapped

- **Where:** §2.1.
- **Wrong:**
  - If the 2 × 2 lattice is laid on frame pixels, each pixel the camera moves flips which bake columns are read. A
    1 px stream on an odd column is never sampled, so while hovering a brook is silent or doubled, and while moving
    its level flickers. water.ts fixes every pattern to bake space for this reason (water.ts:8–10).
  - A sample and its left neighbour straddle a shore that runs north–south. Rows are 2 px (2.5 cells) apart, so that
    crossing stands for 2.5 cells; a vertical pair stands for 2. The design has them the other way round, so
    east–west shores weigh 25 % more than north–south ones.
  - The row above is kept from the previous band, which came from another frame: five seams per pass compare pixels
    from two camera positions.
- **Fix:** sample even `bx` and even `by`. Swap the two lengths. Read the row above from the current frame at each
  band's start. Test that a shore's energy is the same in every orientation within 0.5 dB.

---

## Consider

### 25. Sound will lead the picture

- **Where:** §6.4.
- **Wrong:** mapping to `performanceTime` places a sound at its frame's rAF time, but that frame reaches the screen
  1–3 frames later, plus the panel. Audio more than about 45 ms early is detectable; up to 125 ms late is not
  (ITU-R BT.1359, as summarised by [Wikipedia](https://en.wikipedia.org/wiki/Audio-to-video_synchronization)).
- **Fix:** add about 1.5 frames (25 ms) to `when`. Late is the safe side.

### 26. Doppler: the bench's promise, and long one-shots

- **Where:** §3.1; §8 `train-pass`; §4.9–4.10.
- **Wrong:** at cruise the train closes at 78 cells/s; 0.25 × 78 gives +101 / −96 cents, clamped. The pass falls
  about 2 semitones, not "under a semitone". The whistle (1.2 s) and horn (3 s) are one-shots whose detune is set at
  their start, so they cannot bend while sounding.
- **Fix:** pick the clamp to match the promise (about ±45 cents for under a semitone). Give each moving slot one
  ConstantSourceNode carrying the Doppler cents, connected to the `detune` of every source and filter in the slot:
  continuous bends, and still no automation on one-shots.

### 27. The bell duck reaches the start point

- **Where:** §3.4.
- **Wrong:** 1150 cells out, the abbey is at −18 dB, so `a = smoothstep(−30, −12, −18) = 0.74`, and wind and water
  dip 2.2 dB for a peal that is itself 18 dB down. "Far bells duck nothing" holds only beyond about 1,400 cells.
- **Fix:** move the edges to −16 and −6 dB, or key `a` on the bells' level over the wind.

### 28. Wingbeats and ratchet ticks do not match what is drawn

- **Where:** §4.12; §5.4.
- **Wrong:** birds flap at 7 sprite frames a second over a 4-frame cycle, so 1.75 beats a second (moments.ts:765,
  life.ts:291). The design uses 6–8 Hz for the church flock and 3–4 Hz for gulls. The ratchet ticks at 4 Hz with the
  figures' step (moments.ts:991), while the tune's quavers run at 3.59 Hz: a cross-rhythm that drifts under the
  melody.
- **Fix:** sync each bird's flap to its drawn downstroke, or speed the sprites (a visual change for the owner). Step
  the figures on the tune's quaver, or silence the ratchet while the tune plays.

### 29. The second train at −3 dB contradicts the picture

- **Where:** §4.3.
- **Wrong:** water.ts draws both trains alike (`I = max(I1, I2)`, water.ts:425–427). A big wave on train 1 would
  sound smaller than a middling one on train 0. The set already varies the waves.
- **Fix:** drop the −3 dB.

### 30. Smaller points

- **North/south cue.** `dyc` is measured from the dragon's body, which is drawn about 22 cells (alt / 0.8) above its
  ground point. So the ground under the dragon reads as "south" (cutoff × 0.79). Use world `dy` from the dragon for
  the cue and for HRTF z.
- **Echo.** The shared IR's taps (−12 to −20 dB), inside a −16 dB send, leave the whistle's and horn's echo at about
  −28 to −36 dB. The recipe's repeats, which "sell it", were at −12 and −18 dB. If the echo matters, give horn and
  whistle a private delay send.
- **Headphones rebuild.** Switching six panners does not need a new context; rebuild those six chains in the same
  one. (Moot if HRTF is deferred.)
- **Safari's StereoPanner.** "StereoPannerNode distorts left panned audio"
  ([WebKit 257447](https://bugs.webkit.org/show_bug.cgi?id=257447)) is still NEW. Test it in phase 0. Keep a fallback
  pan ready: mono → two GainNodes with cos/sin gains → merger. It is also cheaper than an automated StereoPanner.
- **Offline renders in WebKit.** The leak the research worried about
  ([WebKit 224279](https://bugs.webkit.org/show_bug.cgi?id=224279)) was fixed in 2021. Batch renders anyway, for
  main-thread cost.
- **Firefox gaps** ([BCD](https://github.com/mdn/browser-compat-data/tree/main/api)): no `cancelAndHoldAtTime`
  (fallback as designed); no `automationRate` (the k-rate request is ignored, so filters run a-rate); no
  `OfflineAudioContext.suspend` (the bench renders in Chrome and Safari only); `latencyHint` ignored. Put these in the
  build notes.
- **iOS.** iPadOS reports a Mac user agent, so test `maxTouchPoints`. Newer iPhones have no switch: say "Check that
  silent mode is off."
- **Startled gulls.** The 0.2 s window equals one ear pass at 30 fps, so slow frames miss startles. Check every frame,
  or widen the window to two passes. The census must apply `flee()` to startled wheelers as well.
- **Focus ring.** The game layer's buttons use a 2 px teal ring (codex.module.css:218–223). Match it, with a paper
  halo so it shows over dark land.
- **The recorded flight** must store its `worldId`, and the bench should refuse a stale one.

---

## Keep

Right, checked against the code, and to survive revision:

- **The wave clock is restated exactly.** Anchor `(k − β − j/2 + ua)·5.2 + 0.010`, strength `SET[(k + 4j) mod 9]`,
  and the bend indexed as water.ts reads it (water.ts:362, 380, 419–426). Shingle on the rock clock matches water.ts's
  `KIND` (water.ts:66–69). The crossing rule (depths within `NEAR`, doubled for the stride, chunk base added) is
  right.
- **The clock.** Figure i steps out at `0.626 + 5.009·i` (drawClock, moments.ts:979–984). The 1.6696 s bar fits three
  bars to each figure, and all 13 bars hold six quavers, ending on E5.
- **The moments' timing.** The train runs 288 cells in 16 s legs (18 cells/s on seed 3) and reverses at the halt
  without stopping (`across`, moments.ts:132). The seaplane's 0.34 / 0.62 phases, the oak's gust curve and the
  airship's 10.13 s swing match the drawing.
- **The lifecycle.** The context is made synchronously in the gesture, from a static stub, with the engine imported
  lazily; nothing exists while off; `ctx.state` is trusted over promises; suspend on mute and hide; pagehide and
  pageshow; the iOS recovery ladder; the ambient session (`auto` resolves to ambient for Web Audio anyway,
  [W3C draft](https://www.w3.org/TR/audio-session/)).
- **Automation.** `setTargetAtTime` everywhere. Cutoffs as `detune` on a fixed frequency, so glides are in log
  frequency (and crossing zero cents is no problem for `setTargetAtTime`). Thresholded sends, at most one call per
  parameter per frame.
- **One-shots** as slices with baked envelopes and 20 ms of silence each side, and no automation on them.
- **Control signals** prerendered and looped circularly. 3000 Hz is the floor of the spec's range (3000–768000) and is
  accepted by Chromium, WebKit and Gecko (`MinSampleRate = 3000` in
  [WebAudioUtils.h](https://github.com/mozilla-firefox/firefox/blob/main/dom/media/webaudio/WebAudioUtils.h)); never
  go lower. Stereo by buffer, with set correlation (0.922 / 0.380 gives ρ = 0.705).
- **Bells.** Ring and strike as separate buffers (superposition is the physics), rings ramped to zero, never a pitch
  change, the far wander, the hour count from `t`.
- **The area model.** Energy, direction and spread; the line-source law checks out (`e ≈ π·30²/h`). Two scans, bake
  and grid, with edge windows.
- **The master and the checks.** An idle limiter as a test, the trim measured, the loudness targets, the render
  bench, scenes and checker, and renders with a verdict after every phase.
- **Scope and access.** The seven rare sights left out of v1; reduced motion as a softened set; muted by default; the
  waiting hint; the WCAG 1.4.2 reasoning; no Media Session.

## Cut or defer

Little perceived quality for their cost, and the bar does not drop without them:

- **HRTF Headphones mode** (phase 7, §6.3). Opt-in, headphones only, and it brings a rebuild path, slot rules, a comb
  rule and an A/B. The research said to leave it out of v1. Defer.
- **The options panel.** With HRTF deferred it holds one slider, and it brings the keyboard capture, the Escape
  handling and the Codex overlap. The toggle (the first tab stop) plus `M` meets WCAG 1.4.2 (G170, G171). Put volume
  in the settings menu when that lands.
- **Rarely met moments.** The dome, airship, oak, marsh and bridge carts, and the baths' steam. Each is a voice to
  tune, met once in 3–8 minutes at one place. Ship the clock, train, seaplane, ferry and church flock.
- **Dense rhythms as one-shots.** The carts' wheel impacts (12 a second, two streams), hooves and the 4 Hz ratchet:
  prerender each as one seamless loop per moment and play a single source.
- **Fall memory** (300 cells). The edge fade already covers leaving a fall.
- **The stall dip and the eased fallback clock.** Cut both, down to the guards in findings 4 and 21.

**Must not be cut:** wind and whoosh; waves on the picture's clock (with finding 2); both ear scans; bells on the
hour; gulls; rivers and falls; the clock tune; the train; the unlock, mute and hide lifecycle with its fades; the
render harness, the checker and the frame-budget run; tests on real devices.

## Phase order

- **Phase 0** gains a one-day platform spike on real Safari (macOS and iOS) and Firefox: a left-panned StereoPanner,
  3000 Hz buffers, `getOutputTimestamp` just after a resume, `interrupted` and `currentTime` after lock and
  background, a burst of offline renders, Bluetooth latency. Phase 8 is too late to learn that the spatializer
  distorts.
- **Phase 0's scheduler** already needs leads, the stroke ledger and stop-on-suspend. Its `hide-show` and `stall`
  scenes test only the master chain until one-shots exist, so re-run them after phases 2 and 3.
- **Phase 1** takes in the `landing` scene, modelled with `codexShift`: wind, rest and the pan origin meet there.
- **Phase 2** ends with the 4× frame-budget run (the ear is the main-thread cost) and the wave-repetition decision.
- **Who builds.** `.claude/CLAUDE.md` gives test-pinned mechanics to the Cursor lane. The pure half (schedules,
  space, mix, ear, control) fits it, with Claude's tests, which leaves Fable the synthesis and the tuning by ear.
