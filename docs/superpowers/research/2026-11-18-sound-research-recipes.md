# Sound for the world: how each sound is made

Research note, 2026-11-18. Companion to `2026-11-18-sound-factsheet.md`. This note covers how each sound is built so
that it reads as real; spatialization, transitions, platform quirks and the mix are the other researcher's note.

**How to read the evidence marks.** `[S]` = I read the source this session and it says this. `[D]` = derived by
arithmetic from an `[S]` fact. `[U]` = from memory of the literature or from listening experience, not re-verified this
session; treat the numbers as starting points to tune by ear and by spectrogram (`ffmpeg showspectrumpic`).

**Three rules that apply to every recipe.**

1. Realism lives in the control signals, not the generators. Filtered noise sounds cheap when its filter and gain sit
   still. Every continuous sound below has at least two slow, unrelated random modulators.
2. Real sound sources are many small events (bubbles, pebbles, leaves, exhaust pulses). Where the ear can resolve the
   grain, synthesize grain (sparse impulses, bubble chirps), not Gaussian noise.
3. Quiet and silence are part of the sound. The lull wave of the set, the gap between gull calls and the pause before
   the hour strikes do more for belief than any filter.

---

## 1. Wind on a flying dragon

### What it is

Two different things reach a rider's ears.

- **Ear buffet (pseudo-sound).** Turbulent pressure fluctuations made at the head and pinna. It is not a travelling
  sound wave, so it is uncorrelated between the two ears, and it is dominated by low frequencies. Measurements under
  motorcycle helmets put the peak energy at 250–500 Hz with a resonance near 250 Hz, and level rises linearly with
  log speed [S] (https://canadianaudiologist.ca/motorcycle-noise-part-ii/). At cyclists' ears, wind noise went from
  84.9 dB at 10 mph to 120.3 dB at 60 mph, loudest at the downwind ear [S]
  (https://noisyplanet.nidcd.nih.gov/have-you-heard/wind-noise-can-contribute-to-noise-Induced-hearing-loss-in-cyclists).
  That is about 45 dB per decade of speed [D], so amplitude goes roughly as speed^2.25.
- **Aeolian tones and rush.** Air shedding vortices off edges (horns, harness, wing struts) whistles at
  f = St·U/d with Strouhal number St ≈ 0.2 [S] (https://en.wikipedia.org/wiki/Aeolian_sound; Selfridge et al., JAES
  2018, https://napier-repository.worktribe.com/output/2871069/creating-real-time-aeroacoustic-sound-effects-using-physically-informed-models).
  Pitch is proportional to speed: 1.8× speed is 10 semitones up [D].
- **Landscape wind** is the far, slow layer: wind in trees and over ground, heard as a broad mid band that gusts.

Farnell's wind model (Designing Sound, Practical 18) is the reference for the control side. Its patch values [S]
(https://mitp-content-server.mit.edu/books/content/sectbyfn/books_pres_0/8375/designing_sound.zip/practical18.html):
a wind-speed LFO at 0.1 Hz; a **gust** signal = noise low-passed twice at 0.5 Hz, scaled ×50; a **squall** signal =
noise low-passed twice at 3 Hz, with everything below 0.4 cut off (`max~ 0.4`, `-~ 0.4`) so squalls appear only when the
wind is already high; a general band `bp~ 800 1`; whistles as `vcf~` with Q 60 whose centre is 600 + 400·(wind
signal) and 1000 + 1000·(wind signal); narrow "doorway" bands at 200 and 400 Hz with Q 40; each layer reading the wind
signal through a different delay (0–3 s) so layers respond one after another, as a gust front crossing a scene does.

### Recipe

Let `s = speed / 60` (0.5 brake, 1 cruise, 1.8 boost), and `g(t)` a gust signal 0–1.

**Control signals (the important part).** Build three control sources, each an `AudioBufferSourceNode` looping a short
buffer of seeded smooth random values played very slowly, then smoothed by a low-pass biquad:

- `gust`: about 0.3 Hz bandwidth (buffer of 1024 random values, played at ~1 value/s, biquad lowpass 0.5 Hz).
- `squall`: about 3 Hz bandwidth, then threshold with a `WaveShaperNode` whose curve is 0 below 0.4 and linear above
  (Farnell's `max~ 0.4`).
- `flutter`: 8–14 Hz bandwidth for the ear buffet, two independent channels.

Use loop lengths that are mutually prime in seconds (for example 1021, 1031 and 67 values) so the combination does not
repeat within a session. Reading the buffer at a very low `playbackRate` relies on the browser's interpolation; verify
in the prototype that it is smooth, otherwise drive a `ConstantSourceNode` with `setValueCurveAtTime` segments from the
main thread every 2 s. Connecting these nodes to `AudioParam`s costs nothing on the main thread.

**Layers** (all from the shared noise buffers; see Shared building blocks):

| Layer | Source → filters | Mapping |
|---|---|---|
| A. Ear buffet L, R | two independent brown-noise channels → lowpass 12 dB/oct at `110·s` Hz → peaking +4 dB at 250 Hz, Q 1.2 | gain ∝ `s^1.5`; each ear's gain × (0.6 + 0.4·`flutter` of that ear) |
| B. Rush | pink noise → bandpass centre `650·s` Hz, Q 0.7 → highshelf −6 dB at 5 kHz | gain ∝ `s`; centre also moved ±15 % by `gust` |
| C. Hiss | white noise → highpass 2.5 kHz → lowpass `3000 + 2500·s` | gain ∝ `(s − 0.6)` clamped at 0: silent when braking, present in boost |
| D. Whistles ×3 | pink noise → bandpass Q 25–45, centres `f_i·s·(1 + 0.12·gust_i)` with `f_i` = 520, 910, 1480 Hz | gain = `squall_i` × `(s − 0.8)` clamped: only in gusts at speed |
| E. Landscape | pink noise → bandpass 400 Hz Q 0.5 → lowpass 1.5 kHz | gain × (0.4 + 0.6·`gust` delayed 1–2 s); independent of `s`; falls with height above ground |

Physically the level range from brake to boost is about 25 dB [D]. Compress that to about 10–12 dB (the exponents in
the table) and let the spectrum carry the rest: the centre frequencies moving with `s` are what the ear reads as speed.
Each whistle reads its own delayed copy of the gust and squall signals (a `DelayNode` of 0.3, 0.9 and 1.7 s on the
control path), as in Farnell's patch.

Boost onset: on top of the eased speed, add a 0.4 s swell on layer C (+4 dB, then back) and let the whistle centres
overshoot by 5 % and settle. Braking: layer A drops fastest (time constant 0.25 s), which is heard as the air "letting
go".

**As built (phase 1, 2026-11-19; tuned by spectrogram and loudness, not by ear).** Values are in
`src/world/sound/levels.ts`.

- The rush (B) carries the loudness and the buffet (A) the weight: solo at cruise B reads −28.5 LUFS and A −34. A
  first balance with A on top read as a wall of noise under 250 Hz, ate the headroom (true peak −6.7 dBTP at boost)
  and climbed 19 LU from brake to boost. With B on top the three speeds read −34.6 / −27.3 / −20.5 LUFS.
- A has a 45 Hz high-pass under it (the "below 60 Hz" trap): weight without sub-bass.
- A's exponent is 1.25, B's 1 (the design's §3.3), not 1.5 and 1.
- The gust also breathes on B's level (gain × 0.75 + 0.5·gust, about −2.5 … +2 dB) as well as moving its centre
  ±15 %: with the centre alone a level cruise read as steady noise. Cruise now wanders over about 3 LU (momentary −28.9 … −25.6),
  and its loudness curve's best match with itself at lags of 3–12 s is r = 0.13: nothing periodic.
- Control signals are sums of random-phase partials at whole multiples of each loop's frequency (61, 13, 47, 97 s),
  so they are band-limited and seamless by construction. The squall is the part of each whistle's wind above 0.7,
  eased at both ends: it sounds 8–35 % of the time, in runs of 0.4–4 s.
- Whistle level `kD` 0.6 (narrow bands carry little power): at boost their peaks sit about 12 dB under B; at cruise
  they are 14 dB lower again, which is inaudible.
- The wind's speed is slew-limited to one e-fold a second (8.7 dB/s on B), counted from 12 % of cruise: without it
  take-off and touchdown moved the level 2.7 LU per 100 ms.

### Distance and stereo

Wind is at the listener, so no distance model. Stereo: A is fully decorrelated left to right (a mono buffet is the single
most common reason synthetic wind sounds like a hairdryer). B and C use two noise reads offset by more than 1 s,
mixed about 70 % correlated. Whistles sit at fixed pans (−0.5, 0.3, 0.7). When banking, raise A on the outside ear by
1–2 dB and lower it on the inside ear (the downwind ear is louder [S]); see sound 2.

### Traps

- One noise source through one filter with one LFO. The fix is five layers and three unrelated modulators.
- A sine LFO for gusts. Periodicity is audible within 20 s. Use filtered random signals only.
- Whistles that are on all the time, or too loud. They should surface for 1–3 s in gusts and sit 12 dB under layer B.
- Too much energy above 4 kHz (reads as hiss or rain) or below 60 Hz (laptop speakers distort; headphones fatigue).
- Level that tracks speed instantly. Ease the mapping (time constant ~0.3 s) after the game's own easing.

### Cost

About 25 nodes, all persistent, no one-shots. Main thread: one batch of `setTargetAtTime` calls at 10–20 Hz.

---

## 2. The turn whoosh

### What it is

In a banked turn the wing loading rises and air spills round the wingtips and membrane edges: a broadband swell
centred higher than the cruise rush, lasting as long as the bank changes, with the outside wing (moving faster) a
little louder. It is a change in the wind, not a separate effect. A sampled "swoosh" one-shot on every turn is what
makes games sound like games.

### Recipe

No one-shots. One extra continuous layer plus modulation of the wind:

- Input: `bank` (−1…1, eased at 6/s by the game) and its rate `|d bank/dt|` smoothed with a 60 ms time constant.
- Layer W: pink noise → bandpass, Q 1.1, centre `500 + 900·|bank|^0.7·s` Hz → gain
  `0.7·rate_term + 0.3·|bank|·s`, where `rate_term = min(1, |d bank/dt| / 4)`. The rate term gives the soft swell as
  the bank eases in over ~0.2 s; the hold term keeps a faint pressure through a long turn.
- Envelope shaping: apply the gain with `setTargetAtTime` time constants of 70 ms rising and 220 ms falling, so the
  whoosh blooms quickly and trails off. Peak level about 8 dB under the cruise wind.
- At the same time, tilt layer A of the wind: outside ear +1.5 dB, inside ear −1.5 dB at full bank, and shift the
  whistle centres by +3 % (outside wing faster).
- Optional wing-membrane detail for hard reversals (bank sign change within 0.4 s): one short low "whump", a brown
  noise burst through lowpass 180 Hz, attack 25 ms, decay 180 ms, −14 dB. At most one per 0.8 s.

**As built (phase 1).** As above, with the design's gate `smoothstep(0.35, 0.6, |bank|)` in place of the dead
zone and no "whump". `kW` 0.5: alone, a full turn at cruise peaks at −34.9 LUFS momentary, 8 LU under the cruise wind;
the taps are digital silence; the balance is 3.0 dB toward the outside wing as seen on screen, heading north and south.

### Stereo, traps, cost

Pan layer W toward the outside of the turn by 0.3 at full bank. Traps: a filter sweep with high Q sounds like a
synth sweep (keep Q near 1); a whoosh on every small correction is tiring (apply a dead zone of |bank| < 0.08). Cost:
4 nodes persistent.

---

## 3. Sea surf

### What it is

- **Breaking waves radiate from bubbles.** Lab spectra peak at a few kHz for weak spilling breakers and move down to a
  few hundred Hz for plunging breakers, with a high-frequency slope near 5–6 dB/octave; spilling noise is single
  bubbles ringing, plunging adds collective oscillation of bubble clouds [S]
  (https://airsea.ucsd.edu/wp-content/uploads/sites/10/2019/06/1994_LOEWEN_MELVILLE-JOURNAL_OF_THE_ACOUSTICAL_SOCIETY_OF_AMERICA_vol_95.pdf
  and the 1991 companion paper). A bubble of radius r rings near f ≈ 3.26/r Hz (r in metres): 1 mm → 3.3 kHz, 5 mm →
  650 Hz [D] from f ≈ 6.52/d(mm) kHz [S] (https://research.cs.cornell.edu/Sound/bubbles/bubbles.pdf). Plunging breakers
  also make very low energy (≲ 20 Hz and up) correlated with the break [S, search abstract]. So: bigger wave = lower
  and longer, not just louder.
- **Sandy beach.** A wave has four audible parts [U]: the approach (a low growing rumble as the crest steepens), the
  break (a soft-edged crash that travels along the beach, so it lasts 0.5–1.5 s, never an instant), the run-up (a long
  bright hiss as a thin foamy sheet climbs the sand; the hiss rises in pitch as the sheet thins), and the backwash (a
  quieter, finer fizz as foam bursts and water sinks into sand).
- **Shingle.** The run-up is similar but the backwash drags stones: a dense rattle of pebble collisions. Sediment
  collision noise has its centroid between about 2 and 15 kHz, finer material higher [S, measured offshore on 1.7 cm
  shingle] (https://journals.flvc.org/jcr/article/download/81164/78316/93242). On a beach the roar is loudest in the
  middle of the backwash and falls in pitch as larger stones start to move [U].
- **Rock and cliffs.** A swell meets a wall: a low boom (water slamming, air trapped in gullies), then spray thrown up
  that hisses and patters back for 1–2 s, then gurgling slosh as gullies drain [U].
- **Calm shores.** Irregular small slaps and "gloops" against stone or bank, 0.5–2 a second, each a tiny splash plus
  one or two bubble tones [U].
- **Open sea.** No breaking: a faint broad wash with whitecap hiss coming and going over 5–10 s [U].

### The clock (read from `src/world/live/water.ts`)

For a shore spot with bend `b` (0–1): phase `p = t/5.2 + b`; `u = frac(p)`; set strength `SET[floor(p) mod 9]`. The
second train uses `p + 0.5` and set index `+4`. What the picture does at each `u`, and so what the sound must do:

| Shore | u (seconds into the wave) | Picture | Sound |
|---|---|---|---|
| Beach | 0–0.5 (0–2.6 s) | crest comes in; foam line fills in as it nears | approach rumble from u≈0.2; break crash building from u≈0.35 |
| Beach | 0.5–0.62 (2.6–3.2 s) | full foam on the sand | crash peak at u=0.5, run-up hiss peak |
| Beach | 0.62–1 (3.2–5.2 s) | foam drains, thinning | backwash fizz (or shingle rattle), fading to nothing by u≈0.95 |
| Rock | 0–0.4 (0–2.1 s) | dark swell line closes in | low swell surge, nearly silent |
| Rock | 0.4–0.52 (2.1–2.7 s) | white water bursts up | boom at u=0.4, spray rising to u=0.52 |
| Rock | 0.52–1 (2.7–5.2 s) | falls back | spray patter, then slosh and gurgle |
| Calm | all | a glint laps | sparse laps, denser near u=0 |

Strength 0 is a lull (the water only laps): play only a calm-style lap, 20 dB down. Strengths 1, 2, 3 scale the wave
(`a` = 0.5, 0.78, 1 in the code).

### Recipe

**Voices.** Keep 4 to 6 persistent "shore voices". Each frame (or at 10 Hz) the mix code picks the nearest shore
patches by direction sector and gives each voice a kind, a bend `b`, a distance and a pan. Each voice is a small fixed
graph whose gains and filter frequencies follow envelopes scheduled from the clock above, converted to audio time. Since
both trains break at each spot, each voice runs two envelope sets half a period apart (the second 3 dB down so the pair
does not sound mechanical).

**Beach voice** (7 nodes): three noise reads into three band paths, summed.

- *Rumble*: brown noise → lowpass `fL`. Gain rises from u=0.2 to a peak at u=0.5 (attack shaped as t²), decays with
  time constant 0.5 s. `fL` = 260, 200, 150 Hz for strength 1, 2, 3; peak gain −8, −4, 0 dB.
- *Crash/body*: pink noise → bandpass Q 0.8, centre gliding from 500 Hz at u=0.35 to `fB` at u=0.5 (`fB` = 1100,
  850, 650 Hz for strength 1–3: bigger waves plunge, and plunging is lower). Attack 250–400 ms, decay time constant
  0.6 s.
- *Hiss*: white noise → highpass gliding 1.2 kHz → 3 kHz across the run-up (u=0.5–0.62) and on to 4.5 kHz through
  the backwash; lowpass fixed at 9 kHz. Gain peaks at u=0.55, then decays with time constant 0.9·(0.6 + 0.4·a) s.
  Multiply the hiss by a `flutter`-type random signal (±2 dB at 6–10 Hz) so the foam sizzles.

**Shingle voice**: as the beach voice with the hiss decay halved, plus a *rattle* path: a sparse-impulse ("velvet")
noise buffer of about 1500 impulses a second with random signs and amplitudes → bandpass Q 1.5 → gain. Envelope:
silent until u=0.62, rising to a peak at u=0.78, gone by u=0.97. Over the same span glide the bandpass centre 5 kHz →
2.6 kHz and the source's `playbackRate` 1.25 → 0.75 (slower, sparser, lower: bigger stones rolling last). The velvet
buffer is what makes it stones and not hiss.

**Rock voice**: *boom* = brown noise → lowpass 110 Hz (strength 3: add a sine at 52 Hz, decay 0.35 s), attack 40 ms at
u=0.4, decay time constant 0.45 s. *Spray* = white noise → highpass 2.8 kHz, attack over u=0.4–0.5, decay time
constant 0.7 s, multiplied by a crackle signal (sparse-impulse buffer low-passed at 40 Hz) from u=0.55 so the tail
breaks up into falling drops. *Slosh* = the prerendered bubble bed (sound 4) → bandpass 300–800 Hz wandering, from
u=0.55 to 0.95 at −12 dB.

**Calm voice**: a seeded scheduler fires lap one-shots (3–4 prerendered variants: one bubble chirp of 300–900 Hz
rising 15 % over 40 ms, plus a 70 ms noise tick through bandpass 1.5 kHz Q 2) at a mean of 1 a second, denser for
0.5 s around u=0, each with ±20 % playback-rate spread.

**Open sea**: one stereo pink noise → bandpass 700 Hz Q 0.4 → gain (0.5 + 0.5·slow random at 0.1 Hz). −30 dB under a
near beach. No clock: the swell is drawn bending everywhere, and a pulsing open sea would sound like a machine.

**As built (phase 2, 2026-11-19; tuned by loudness and spectrogram, not by ear).** Values are in
`src/world/sound/levels.ts`; the shapes are in `src/world/sound/synth/envelopes.ts`.

- A wave is fresh noise (a Gaussian loop times a sign loop) shaped by a prerendered envelope, one per kind and
  strength; nothing about a wave is a frozen take but the rock's slosh. Ten minutes at one beach: the largest
  cross-correlation between any two of 204 waves is 0.06 (a copied wave reads 1.00).
- Beach: rumble low-pass 260 / 200 / 150 Hz by strength; crash 500 Hz → 1100 / 850 / 650 Hz over u 0.35–0.5, in over
  0.38 s; hiss high-pass 1.2 → 3 → 4.5 kHz, peak at u 0.55. Part levels (low, mid, high) 3.2, 1.6, 0.9; strengths
  −8 / −4 / 0 dB. Twenty-five cells off, the big wave peaks at −19.6 LUFS momentary and the lull is 14 LU under it.
- Rock: boom low-pass 110 Hz, 40 ms in, τ 0.45 s (level 11.5: a first try at 5 was hidden under the bed's rumble);
  spray high-pass 2.8 kHz; slosh from u 0.55 at 0.5, its band wandering 300–800 Hz. No 52 Hz sine. Peak −19.7.
- Shingle: on the rock's clock; rattle from u 0.52, fullest at 0.70, 5 → 2.6 kHz. **The grain is not impulses.**
  Single-sample velvet (1500 a second) is clicks by construction, and bumps of 2.5 ms still counted as clicks; the
  grain is noise times a smooth random gain (0.3–1, up to 90 Hz). Rougher than hiss, less stony than the recipe.
  Peak −20.5.
- After the verdict on phase 2: the beach's hiss and body settle onto a floor between breaks (11 % and 4 % of their
  peaks, the fizz of foam on wet sand) and fade over the envelope's last 0.9 s; the rock's boom is at 16 with almost no
  swell before it (0.04), and the bed's rumble came down to 0.008 (body 0.07) so the boom stands clear. One lane at a
  cliff: the 20–200 Hz band goes from −55 to −24 dBFS in 40 ms and falls about 20 dB a second (τ 0.43 s). At a long
  cliff four lanes' booms overlap, so the band reads as a plateau with peaks 5–8 dB over it.
- Each wave has its own two noise sources (the Gaussian loop and its sign loop), started where loops running since the
  context began would be and stopped with the wave: the streams are the same, and an idle emitter's input is silence.
- The foam's sizzle is the live flutter (0.8 + 0.45 · flutter) on the hiss.
- Surf bed: `kBody` 0.066 and `kRumble` 0.014 put far surf (250 cells) at about −38.5 LUFS; with the rumble on top, as first
  tried, it sat under every wave as a wall below 200 Hz. Open sea `kO` 0.05: −46.1 LUFS.
- Laps: about two a second at a quay (one cell in each of the two heaviest calm lanes).

### Distance and stereo

A near beach (within ~30 cells) is individual waves, each a moving event: start the break 0.3 pan units to one side and
let it travel to the other over the crash. With distance the bends inside earshot average out, so crossfade each
voice toward a "far surf" version: envelope depth reduced (at 150 cells the waves modulate the level by only ±3 dB),
hiss path removed first (lowpass the voice at 2 kHz by 120 cells, 800 Hz by 250), rumble kept. Air absorption at 20 °C,
70 % humidity is about 2.8 dB/km at 500 Hz, 5 at 1 kHz, 9 at 2 kHz, 23 at 4 kHz and 77 at 8 kHz [U, ISO 9613-2 Table
2 from memory; a 1 kHz figure of about 5 dB/km is confirmed by https://dougjam.github.io/demos/atmospheric-absorption/],
so distant surf really is a low rumble with a soft top.

### Traps

- Every wave the same. The set strengths, and the lull above all, must be audible.
- A hard-edged crash. Breaks spread along the shore; attack no shorter than 200 ms.
- Symmetric swell-and-fade envelopes (the "breathing pink noise" ocean). Real waves are asymmetric: a build, a peak,
  then a long tail that changes colour.
- All voices in phase. Each voice must use its own bend; never a global wave envelope.
- White noise for shingle. It needs grain.

### Cost

6 voices × 7–9 nodes ≈ 50 nodes persistent. Per wave per voice about 12 scheduled parameter events. Lap one-shots:
1–2 a second near calm water.

---

## 4. Rivers and waterfalls

### What it is

Running water is bubbles. Each entrained bubble rings as a damped sinusoid at the Minnaert frequency (f ≈ 3.26/r),
and van den Doel's model, the standard real-time recipe, plays each as `a·sin(2πft)·e^(−dt)` with damping
`d ≈ 0.043f + 0.0014f^1.5` and, for bubbles rising to the surface, a pitch that rises during the ring,
`f(t) = f0(1 + ξ·d·t)` with ξ ≈ 0.1 [U for the constants; the approach is confirmed as the base method by
https://gamma.cs.unc.edu/SoundingLiquids/soundingliquids.pdf; paper: van den Doel, ACM TAP 2(4), 2005]. Farnell's
running-water practical does the same thing with random sine sweeps, controlled by two parameters, depth and speed of
flow [S] (https://mitp-content-server.mit.edu/books/content/sectbyfn/books_pres_0/8375/designing_sound.zip/practical13.html).
A babbling brook is mostly discrete bubbles of 1–5 mm (600 Hz–3 kHz) at tens to hundreds a second; a smooth deep river
is nearly silent except where it meets stones.

Waterfalls: measured water features are mainly mid and high frequency; low-frequency content cannot easily be raised
by adding flow, except in waterfalls, which are also the loudest type [S, abstract]
(https://researchportal.hw.ac.uk/en/publications/acoustic-design-of-water-features-for-the-built-environment/; Galbrun
and Ali, JASA 2013, https://core.ac.uk/download/29087069.pdf). A taller fall hits harder, entrains bigger bubble
clouds, and so adds energy below 250 Hz [U]. A fall onto water sounds full and soft; onto rock, brighter and harsher.

### Recipe

**Bubble beds, prerendered at start-up.** Write samples directly into `Float32Array`s (plain arithmetic, no nodes):
for each of N bubbles pick, from the seeded rng, a start time, a radius from a power-law distribution (many small, few
large; exponent about −1.5 on r between 0.6 and 6 mm), an amplitude ∝ r^1.5, and add the damped rising sinusoid above,
wrapping modulo the buffer length so the loop is seamless. Make three beds:

- `brook`: 9.7 s, 60 bubbles/s, radii 0.8–5 mm (discrete, playful).
- `flow`: 13.3 s, 400 bubbles/s, radii 0.6–3 mm (a continuous purl).
- `plunge`: 7.9 s, 1500 bubbles/s, radii 1–8 mm (dense, low).

About 31 s of mono audio in all (6 MB at 48 kHz). Rendering is under 100 ms of arithmetic; do it in slices during idle
time or in a Worker so no frame is lost.

**River voice** (2 voices, each ~6 nodes): `brook` and `flow` beds, each looping with `playbackRate` 0.94–1.06
drifting on a slow random signal (this also moves bubble pitch, which is right: flow changes bubble size), mixed by
reach type: easy reach = `flow` −6 dB + `brook`; steep reach = `flow` + pink noise through bandpass 1.8 kHz Q 0.6.
Add a second read of each bed at a different offset and rate, panned opposite, to make the river wide.

**Waterfall voice** (2 voices, each ~9 nodes):

- *Body*: pink noise → bandpass 900 Hz, Q 0.5.
- *Hiss*: white noise → highpass 4 kHz, −8 dB; gain breathes ±2 dB on a random signal of about 0.5 Hz (the factsheet's
  spray "breathes about every 2 s, each on its own beat").
- *Plunge*: `plunge` bed → lowpass 1.2 kHz.
- *Rumble* (tall falls only, 9 px or more): brown noise → lowpass 140 Hz, gain ∝ (height − 6)/12 clamped to 1, with a
  slow ±3 dB random wander at 0.3 Hz.
- Small falls: no rumble, body centre up at 1.6 kHz, more `brook` bed: a small fall is a loud brook, not a quiet big
  fall.

**As built (phase 4, 2026-11-19; tuned by loudness and spectrogram, not by ear).** Values are in
`src/world/sound/levels.ts` (`K_RIVER`, `RIVER`, `FALL`) and `synth/bubbles.ts`. The three beds are as above, except
that a brook's and a purl's bubbles come up over 6 and 3 ms. The river bed is two reads of each bed at fixed rates in
0.94–1.06, each half with its own pan; the riffle is pink through the 1.8 kHz band. A fall's parts by weight: body
0.7 (band at 1600 Hz small … 900 Hz tall), hiss 0.2 breathing ±23 % on a drift, plunge 0.6, rumble 1.8 × tallness,
brook 0.8 × smallness. With more plunge or rumble a still fall's momentary loudness wandered by a decibel a tenth
of a second; these hold it to 0.8. Measured: a river 20 cells off −32.9 LUFS, a small fall at 20 −28.7, a tall
fall at 30 −22.8 (its power under 140 Hz 4.8 dB over the rest; a small fall's 28 dB under).

### Distance and stereo

Close (under 25 cells): bubbles and hiss detail, wide stereo. By 80 cells the bubble beds are gone and the hiss is
low-passed to 3 kHz; by 200 cells a tall fall is only its rumble and a soft body band at 400–800 Hz. Falls are the one
water sound that should be audible before they are seen.

### Traps

- Band-passed noise alone for a river: it reads as static or rain. The bubble tones are the river.
- Bubbles with constant pitch (sounds like a synth arpeggio). The rise and the heavy damping are essential.
- A loop the ear can learn. Use three beds with lengths in no simple ratio, drifting rates, and offsets chosen by seed.
- Rumble on small falls.

### Cost

About 30 nodes for two rivers and two falls. No one-shots. An AudioWorklet that spawns bubbles live would be truly
better here (density and size could follow the flow continuously, and rain could reuse it later); the prerendered beds
are the cheap version and probably enough.

---

## 5. Church bells

### What it is

A cast bell sounds a set of inharmonic partials, each a ring of bronze vibrating in a different pattern. For a
true-harmonic bell, relative to the **nominal** (1.0): **hum** 0.25, **prime** 0.5, **tierce** 0.5945 (a minor third
over the prime), **quint** 0.749, nominal 1; measured ratios 1 : 2 : 2.378 : 2.997 : 4 for a 214 kg church bell [S]
(Perrin, Charnley and DePont 1983, https://www.hibberts.co.uk/wp-content/uploads/2022/01/perrin_charnley_depont_1982.pdf).
Above the nominal: **superquint** about a fifth up (≈1.5), **octave nominal** about an octave up (≈2.0–2.1), then
partials near an eleventh (≈2.67), a thirteenth (≈3.3) and a double octave (≈4.0–4.2) [S for the intervals]
(https://www.hibberts.co.uk/the-upper-partials-of-bells/). Across 8,071 bells the upper partials move together: sharpen
the octave nominal and the rest stretch in proportion [S, same page].

- **Strike note.** The pitch we name is not a partial: it is a virtual pitch about an octave below the nominal, made
  by the ear from the nominal, superquint and octave nominal (close to 2 : 3 : 4) [S]
  (https://www.hibberts.co.uk/virtual-pitch-and-stretch-tuning/). Get those three right or the bell has no note.
- **Old bells are not true-harmonic.** In old-style bells the hum is often a tone or more sharp and the prime a tone
  or more flat of their octaves [S] (https://www.hibberts.co.uk/?p=939). That sourness is the sound of an old abbey.
- **Doublets.** No bell is perfectly round, so each partial is two modes a little apart, which beat ("warble"). A
  528 kg bell of 1626 has its nominal split at 831.7 and 832.3 Hz, a beat every 1.7 s [S]
  (https://www.hibberts.co.uk/?p=1547); splits of a few Hz also occur [S, search summary of Rossing-school reviews].
  Where the clapper strikes sets how strongly each half sounds.
- **Decay.** High partials die first and the hum is the last tone standing; hum, prime and tierce ring for many
  seconds [S, qualitative, from search summaries of the Hibberts pages; the exact page was not pinned]. Working numbers for a 400–600 kg bell, time to fall
  60 dB [U]: hum 25–35 s, prime 12–18 s, tierce 10–14 s, quint 5–8 s, nominal 6–9 s, superquint 3–4 s, octave nominal
  2–3 s, higher partials 0.3–1.2 s. As a rule of thumb, T60 falls roughly as 1/f.
- **Sizes for scale** [S, https://www.hibberts.co.uk/?p=1547]: 528 kg, 0.99 m → nominal 832 Hz; 398 kg, 0.89 m →
  952 Hz; 220 kg, 0.64 m → 1645 Hz.
- **The strike itself**: a few milliseconds of clapper impact, bright and noisy, and a burst of very high partials
  that are gone in a quarter of a second [U].

**How bells are rung.** English change ringing: bells sound one at a time in rows; "rounds" is the descending scale,
treble to tenor; successive bells about 0.2–0.3 s apart; a pause of one beat after every second row (the handstroke
gap); from row to row a bell moves at most one place [U]. Continental swinging bells (the fit for a Gothic abbey on a
European coast): each bell swings at its own period (a larger bell slower, roughly 1–2 s between strokes), so the bells
drift against each other in an ever-shifting pattern, and each stroke's loudness and brightness varies as the mouth
swings toward and away from the listener [U]. Tolling: one bell, slow and even; the hour is struck by a hammer on the
largest bell, every 2–3 s.

### Recipe

**Prerender each bell stroke once** with `OfflineAudioContext` (mono, 32 kHz is enough, 10 s): for each of the 10 partials below,
two `OscillatorNode`s (the doublet) into one `GainNode` whose gain is set at t=0 and decays by
`setTargetAtTime(0, 0, T60/6.91)`. Plus the strike: 6 ms of white noise through a bandpass at 3 × nominal, Q 1.5, and
three extra short partials at 5.3, 6.6 and 8.1 × nominal with T60 of 0.25 s.

| Partial | Ratio (abbey, old-style) | Start level | T60 (tenor) | Doublet split |
|---|---|---|---|---|
| Hum | 0.25 × 2^(+40/1200) | −14 dB | 30 s | 0.3–0.8 Hz |
| Prime | 0.5 × 2^(−30/1200) | −8 dB | 15 s | 0.5–1.5 Hz |
| Tierce | 0.5945 | −5 dB | 12 s | 0.5–1.5 Hz |
| Quint | 0.749 | −16 dB | 6 s | none |
| Nominal | 1 | 0 dB | 8 s | 0.6–2 Hz |
| Superquint | 1.49 | −4 dB | 3.5 s | 1–3 Hz |
| Octave nominal | 2.04 | −6 dB | 2.5 s | 1–3 Hz |
| I-7 | 2.72 | −10 dB | 1.2 s | none |
| I-8 | 3.42 | −14 dB | 0.8 s | none |
| I-9 | 4.15 | −18 dB | 0.5 s | none |

Levels are a starting point [U]. Per bell, the hum and prime offsets (±60 cents), every split, and the level share of
each doublet half (0.2–0.8) come from `hash2(bellIndex, partialIndex, seed)`, so each bell is an individual and the same
every visit. Scale all T60s by (tenor nominal / this nominal) for smaller bells. Render **two strokes per bell**
(different doublet shares and strike brightness, for the two sides of a swinging bell) : 5 bells × 2 × 10 s at 32 kHz
is 12.8 MB of floats; drop to 7 s for the three smallest to save a third.

**The abbey's ring**: five bells with strike notes on a minor pentachord, tenor nominal about 660 Hz (about a tonne, scaling the 528 kg / 832 Hz bell by mass ∝ 1/f³ [D]; strike note near E4), the others at nominals of ×1.122, ×1.189, ×1.335 and ×1.498 (D–E–F–G–A shape:
whole, half, whole, whole), each then detuned by a seeded ±12 cents, because no old ring is in tune.

**The peal on the hour** (the hour is 240 s, so keep it short): swinging-bell model. Bell i has period `P_i` between
strokes (tenor 1.9 s down to 1.05 s for the smallest, plus seeded ±3 %), enters in turn from the smallest every 1.5 s,
rings for about 22 s, and leaves in turn. Stroke k of bell i falls at `start_i + k·P_i + jitter` with jitter ±25 ms
from `hash2`. Alternate the two stroke buffers; scale level by ±2 dB alternately (mouth toward and away). Then 2.5 s of
ringing-down silence, then **the hour**: `n` strokes on the tenor 2.4 s apart with the hammer version (5 dB more
strike, played through a lowpass at 5 kHz), where `n` is the world hour number 1–12. Each stroke is a new
`AudioBufferSourceNode`; overlapping strokes of the same bell simply add, which is physically correct. Never change a
bell's `playbackRate`: a bell has one pitch.

**Live alternative** (no prerender): 5 bells × 20 oscillators per stroke with strokes overlapping for 10 s is several
hundred live oscillators at the peak of the peal. Prerendering is the right choice.

**As built (phase 3, 2026-11-19; checked by spectrum and decay, not by ear).** `synth/bells.ts`, `schedule/bells.ts`,
`engine/bells.ts`; levels in `K_BELL`. Five bells at the context's rate, each two ring takes (the doublets' shares
swapped) and one strike; every mode starts at its own phase; a ring's last 1.5 s is eased to nothing. Each bell's hum
and prime are within ±20 cents of the table's offsets. Measured on one stroke of the tenor, dry: every partial within
2 cents of its design, every T60 within 4 % (a doublet's read over whole beats), six doublets beating
at their designed periods (0.39 s to 2.1 s). The reverb's response measures T60 2.2 s with taps at 150, 270, 410 and
600 ms.

### Distance and stereo

The start is 1150 cells from the abbey, so the bells are mostly heard far off, and that is where they are most
beautiful. With distance: lowpass sliding from 8 kHz (at the tower) to 1.2 kHz (far), which leaves hum, prime, tierce
and a softened nominal; the strike noise vanishes first; add reverb share (the other note's convolver) from 10 % to
60 %; and add **slow level wander** of ±4 dB at 0.1–0.5 Hz, slightly different above and below 700 Hz (two bands, two
random signals). Wind bending the sound path is why distant bells come and go, and it is the strongest "far away"
cue there is. Near the tower, spread the five bells across ±0.3 pan.

### Traps

- Harmonic partials (it becomes a chime or a synth "bell"). Use the ratios above, including the minor-third tierce.
- No doublets: the tail is dead. Too much split on every partial: it wobbles like a detuned synth.
- Equal decay for all partials. The colour must change from bright clang to dark hum over the ring.
- Perfectly even ringing. Human and swinging bells drift; ±25 ms is needed.
- Re-triggering by cutting the previous stroke. Let them overlap.
- Any recognisable chime tune (Westminster quarters and the like). Rounds, swinging and tolling are patterns, not
  melodies, and are safe.

### Cost

Prerender: 10 offline renders of ~25 nodes each at start-up (do them one at a time after the first interaction; each
takes tens of milliseconds). Playing: one buffer source and gain per stroke, peak about 25 alive during the peal, plus
a shared 4-node distance chain.

---

## 6. Gulls

### What it is

The herring gull's repertoire [S for names and structure] (https://en.wikipedia.org/wiki/European_herring_gull;
https://earbirding.com/blog/?p=4538; Birds of North America account,
https://www.researchgate.net/publication/240792763_Herring_Gull_Larus_argentatus):

- **Long call**: head down for a few slow, drawn-out squeals, then head thrown up for a terminal series of similar
  loud notes. Related populations have 8–14 notes [S, https://bioacoustics.info/article/intraspecific-variation-long-call-herring-gull-larus-argentatus-eastern-baltic-and].
  The final notes vary little within a bird in fundamental, duration and harmonic balance, and the call identifies the
  individual [S].
- **Mew**: one long wailing note. **Alarm / "kek-kek"** (the laughing "ha-ha-ha"): short barks in a run. **Yelp /
  "kee-ow"**: a single two-part cry.
- Herring gull calls have a strong, orderly harmonic structure [S, https://www.bioacoustics.info/article/acoustic-signalling-great-black-headed-gull-larus-ichthyaetus-pallas].

Working numbers read from published sonograms [U; check against https://fssbirding.org.uk/herringgullsonogram.htm
before tuning]: fundamental 500–1000 Hz; a dozen or more harmonics visible to 6–8 kHz; the strongest energy not at the
fundamental but in harmonics 2–5 (about 1.5–4 kHz); terminal notes 0.25–0.4 s long at 3–4 a second, each rising
quickly and then falling ("kyow"); squeals 0.6–1.2 s rising slowly by a third to a fifth; keks 80–120 ms at 5–7 a
second around 450–600 Hz. The voice breaks: abrupt jumps of pitch, and stretches of rough, subharmonic or chaotic
sound at the loudest moments, as in many animal calls [S for the phenomena in general,
https://www.ece.uvic.ca/~bctill/papers/numacoust/Fitch_etal_2002.pdf].

### Recipe

A **gull voice** is a source–filter model: 9 nodes, built per call or kept in a pool of three.

- *Source*: `OscillatorNode` with a custom `PeriodicWave`, 20 harmonics, amplitudes ∝ 1/n^0.8 with harmonic 1 cut by
  6 dB (a pulse-like, bright source). Frequency follows a contour written with `setValueCurveAtTime`.
- *Rasp*: a second oscillator at exactly half the source frequency (same contour ×0.5) multiplies the source
  (connect it to a `GainNode.gain` whose base value is 1 − depth). Depth 0 in quiet parts, 0.3–0.6 at the loudest
  third of each note. This gives the subharmonic growl. Add pitch jitter: low-passed noise (120 Hz) into `detune`,
  ±25 cents, rising to ±70 cents during rasp.
- *Tract*: three parallel bandpasses at about 1.7 kHz (Q 4), 2.9 kHz (Q 5) and 4.6 kHz (Q 6), levels 0, −3, −10 dB,
  plus 10 % dry. Shift all three by a seeded ±8 % per bird (bird size). Open the beak: glide the first formant up 15 %
  over each note's attack.
- *Breath*: white noise → bandpass 3 kHz Q 1, −22 dB, following the note envelope.
- *Envelope*: attack 20–30 ms, sustain with a slow swell, release 60–90 ms; never a flat sustain.

**Note shapes** (f0 as multiples of the bird's base pitch `B`, 620–820 Hz by seed):

- *Kyow* (terminal note): 0.9B → 1.35B in 60 ms → hold 80 ms → fall to 0.8B over 150 ms. At the peak, with seeded
  probability 0.4, a "break": jump to 1.9B for 40 ms and back.
- *Squeal*: 0.8B → 1.25B over 0.9 s, rasp depth rising throughout.
- *Kek*: 0.75B flat with a 10 % fall, 100 ms.
- *Mew*: 0.85B → 1.1B → 0.8B over 1.3 s, pure (no rasp), formants 10 % lower.

**Calls**: long call = 2–3 squeals (gaps 0.25 s), then 7–12 kyows starting at 0.33 s spacing and slowing to 0.45 s,
each 1–2 % lower in pitch and 0.7 dB quieter than the last. Kek run = 3–6 keks at 0.16 s spacing. Yelp = one kyow.

**Variety without repetition**: every number above comes from a hash of (bird id, call index): base pitch, formant
shift, note count, spacing, break positions, rasp depth. The same bird keeps its `B` and formants (birds are
individuals); only the performance varies. Scheduling: per colony (town: 9 birds; each lighthouse: 5), a slot scheme
like `rareSlot`: time is cut into 4 s slots; a hash of (colony, slot) decides whether a call starts (probability 0.25
by the town, 0.12 at a lighthouse), which bird, and which call (55 % yelp, 20 % kek run, 15 % mew, 10 % long call).
One call can trigger an answer: a second bird's yelp or long call 0.6–2 s later with probability 0.35, which is how
real colonies sound. Gulls lifted off a beach by the flier give 1–3 kek runs in the first second.

### Distance and stereo

A gull at 60 cells: lowpass 5 kHz, and the rasp detail softens. At 200 cells only the 1.5–3 kHz formant band
survives: a thin "kyow" with no growl, which is exactly the classic far-gull sound; add 30–40 % reverb share. Pan from
the bird's actual position (they wheel), and let the pan move during a long call. A slight pitch drift of ±1 % over a
call (Doppler from wheeling flight) helps.

### Traps

- A pure tone with vibrato: a toy whistle. The harmonics and the formants are the gull.
- Every call identical. Hash everything; keep each bird's identity.
- Calls too often. A harbour at peace has several seconds between calls; clusters and silences, not a metronome.
- Constant rasp (sounds like distortion). Only at the loud peak.
- Too loud. Gulls sit well under the wind and sea, except one near pass now and then.

### Cost

9–11 nodes per call, created per call and released at its end; at most 3 calls at once. About one call every 10–15 s
near the harbour.

---

## 7. The wonders' moments

All moments already have a 2.5 s fade at each end (`shown`); multiply every moment's bus by it.

### Train (railway)

*Real.* A two-cylinder engine gives four exhaust beats per driving-wheel turn, evenly spaced at 90° [S]
(https://www.trains.com/?p=194527). Beat rate = 4v/(πD). Beats are never quite even: valve setting makes one of the four louder or late [U].
On jointed track each axle clicks at each joint, heard as paired clicks per bogie [U]. A whistle is one or more tubes
sounding a chord (a chime whistle), and overblows to a higher mode at too much pressure [S]
(https://giangrandi.ch/mechanics/steamwhistle/steamwhistle.shtml).

*Recipe.* Take speed from the moment's position function (difference per second), `v` in cells/s.

- **Chuff**: rate `r = 1.2 + 0.45·v` Hz, capped at 9. Each chuff is a one-shot from one of 4 prerendered buffers
  (white noise → bandpass 420 Hz Q 1.2 plus bandpass 1100 Hz Q 0.9 at −6 dB → soft-clip `WaveShaperNode`; attack
  8 ms; decay time constant `0.22/r` s, so slow chuffs are long and hollow). Beat levels in each group of four: 0,
  −2.5, −1, −3.5 dB, and the third beat 4 % late. Pulling away from `shore` and `halt`: first four beats +4 dB with
  more low band. Schedule from accumulated wheel phase (integrate `r`), not from a timer, so the rhythm follows speed
  smoothly.
- **Hiss**: continuous white noise → highpass 3 kHz at −24 dB, rising while stopped at the halt (steam at rest).
- **Wheels**: clicks in pairs (the two axles of a bogie, `1.6/v` s apart), pairs repeating every `14/v` s per
  vehicle, engine then carriage (a rail length of 14 cells is a choice, not a measurement). Click = strike voice: 3 ms noise burst → bandpasses at 900 and
  2300 Hz, decays 40 and 25 ms.
- **Water**: the rails are under shallow water, so add what no ordinary train has: a steady sheet of spray, pink
  noise → bandpass 2.2 kHz Q 0.7, gain ∝ `v`, with the bubble `flow` bed at −10 dB. This is the moment's signature.
- **Whistle**: two tones a fourth apart (about 740 and 988 Hz), each a sine plus 2nd and 3rd harmonics at −10 and
  −18 dB, plus breath: white noise → bandpass at each tone, Q 6, −10 dB. Onset: pitch rises 60 cents over 150 ms as
  steam fills; release: falls 40 cents over 200 ms. One long (1.2 s) on leaving the shore, short-short (0.3 s each)
  nearing the halt. Give it the scene's echo (a single lowpassed repeat at 0.7 s, −14 dB).

### Seaplane (cove-hotel)

*Real.* Propeller tone sits at the blade-pass frequency, blades × rpm / 60, with harmonics; broadband comes from blade
turbulence [S] (https://engineeringtoolbox.com/fan-blade-pass-frequency-d_1137.html). A nine-cylinder four-stroke
radial at 2300 rpm (the Wasp Junior's rating [S], https://en.wikipedia.org/wiki/Pratt_%26_Whitney_R-985_Wasp_Junior)
fires 172 times a second and a direct-drive two-blade propeller passes 77 times a second [D]. The radial's character
is that these two series (ratio 9 : 4) and the uneven cylinders share a common period of two crank turns, heard as a
rough, loping burble at idle [U].

*Recipe.* One `OscillatorNode` with a `PeriodicWave` whose **fundamental is the half-order** `h = rpm/120`. Put energy
at harmonic 4 (blade pass), 8, 12, 16 (its overtones, each −5 dB), 9 (firing, −3 dB), 18, 27 (−8, −14 dB), and small
seeded amounts at 1, 2, 3, 5, 7, 13 (−18 to −26 dB: the unevenness). A second oscillator detuned +0.4 % at −12 dB adds
slow roughness. Sum into a soft-clip and a lowpass at `1200 + rpm` Hz. Add prop wash: pink noise → bandpass 500 Hz
Q 0.6, amplitude-modulated 50 % at the blade-pass rate (connect a sine at `4h` to its gain).

`at` (share of the appearance): approach, rpm 1900 easing to 1400 by touchdown at 34 %; pitch offset for Doppler from
the plane's velocity toward the flier (the other note's formula). Touchdown: two splashes 0.5 s apart (floats skip):
each a pink noise burst → lowpass sweeping 3 kHz → 600 Hz over 0.5 s, attack 30 ms, then a 1.5 s hiss of settling
spray. Taxi (34–62 %): rpm 800–900 with the wash layer wandering, plus the `flow` bubble bed for water on the floats.
At the jetty: rpm falls 800 → 300 over 2.5 s, the firing pulses separating into audible pops, three last pops at
widening gaps, then only lapping.

### Clock automata (town)

*Real.* A music-box tooth or small chime bar is a clamped bar: partials at 1 : 6.27 : 17.55 times the fundamental [D
from the clamped-free beam roots 1.875, 4.694, 7.855, https://en.wikipedia.org/wiki/Euler%E2%80%93Bernoulli_beam_theory],
the upper two faint and short-lived [U]. A real mechanism adds the governor fan's whirr, the ratchet, and wood on wood.

*Recipe.* **Chime voice**: sine at f (T60 1.8 s at 800 Hz, scaling as 1/f) + sine at 6.27f (−16 dB, T60 0.25 s) +
sine at 17.55f above 12 kHz omitted + a 2 ms click through bandpass 4 kHz. For a small carillon colour instead, use
the bell table at nominals of 1.5–4 kHz with T60s divided by 6. Notes are scheduled, not live, so 4 nodes per note.

**The tune must be composed, not generated, and must be ours.** Brief for whoever writes it: 14–18 s; 6/8 at about
84 dotted crotchets a minute; D Dorian or A Mixolydian on a compass of a ninth; two four-bar phrases, the second
answering the first and ending on the tonic an octave down; stepwise motion with one leap of a sixth; a drone fifth on
the first beat of each bar played by a lower chime. Check it against known chime and folk tunes before shipping.
Seeded human touch: each note ±12 ms and ±1.5 dB.

**Mechanism**: *whirr* during the whole 36 s: white noise → bandpass 2.6 kHz Q 3, amplitude-modulated by a sawtooth
at 55 Hz (fan blades), −26 dB; it winds up over 0.6 s before the first figure moves and runs down in pitch (55 → 20 Hz)
over 1.5 s at the end. *Ratchet*: clicks at 9 Hz in bursts as figures advance. *Wooden clack* for each figure's step
and each door: strike voice, 4 ms noise burst → bandpasses at 520, 1240 and 2100 Hz with decays 70, 45, 25 ms; vary
the three frequencies ±10 % by hash per figure. Doors: two clacks 60 ms apart and a low thud (lowpass 200 Hz burst).
Order: whirr, doors, figures file out to the tune, hour count on a deeper chime if wanted, doors.

The abbey strikes the same hour. Start the town tune at the top of the hour and the abbey peal a few seconds later so
they do not mask each other (they are 1150 cells apart, so in practice only one is ever near).

### Ferry (baths)

A vessel under 75 m must sound a whistle with fundamental 250–700 Hz [S]
(https://cultofsea.com/colregs/annexes/annex-iii-technical-details-of-sound-signal-appliances). Horn: sawtooth at
290 Hz and a second at 366 Hz (−4 dB), each through lowpass 1.8 kHz and a soft-clip; attack 120 ms with pitch rising
25 cents; hold; release 250 ms. One prolonged blast (4.5 s) leaving, one short (1 s) arriving. The echo sells it: two
repeats at 0.9 s and 1.7 s, lowpassed at 900 and 600 Hz, −12 and −18 dB. Engine: a slow thump at 5–6 Hz: sine 62 Hz
with a 30 ms attack, 90 ms decay per beat, plus a brown-noise puff through lowpass 300 Hz on each beat; every fourth
beat +2 dB. Bow wash: `flow` bed + pink bandpass 1.2 kHz, ∝ speed. Baths steam (always when in view): very quiet white
noise → bandpass 5 kHz Q 0.5 with slow random swells, and the `brook` bed at −20 dB for the pools.

### Airship (airship-mast)

Slow large propellers: blade-pass 45–60 Hz. Two engines: two `PeriodicWave` oscillators (harmonics 1–8 falling
6 dB each) at 52.0 and 52.6 Hz, so the pair beats every 1.7 s; that slow throb is the airship sound [U]. Lowpass
600 Hz. Add fabric: on each swing of the hull at the mast, a soft low flap (brown burst, lowpass 150 Hz, 0.3 s) and a
mooring creak (see windmill creak). Very quiet: it is tied up and idling.

### Carts (marsh causeway, bridge-town)

Iron tyres on cobbles: impacts at `v / stone pitch`, about 10–18 a second, irregular. Each impact = strike voice
exciting the cart: bandpasses at 240, 610, 1500 Hz, decays 60, 40, 20 ms, level and timing jittered ±40 %; the two
wheels run as two streams panned slightly apart. Every 0.7–1.5 s a loose-board rattle (three fast clacks). Horse at a
walk: four even hoofbeats per stride of about 1.1 s [U]; clop = 3 ms burst → bandpasses 950 and 1700 Hz, decay 35 ms,
with every beat's pitch varied ±6 %. On the marsh causeway (timber or packed earth): move every resonance down by
half and lengthen decays 1.5×, so it sounds hollow and soft; on the stone bridge add a short slap-back (20 ms delay,
−8 dB) from the parapets. The boat under the bridge: a few oar dips, each a lap one-shot and a small `brook` swirl.

### Observatory dome

Motor: sawtooth at 100 Hz with harmonics to 800 Hz (lowpass 900 Hz) at −20 dB, plus a gear tone gliding 180 → 420 Hz
over a 1.5 s spin-up and back down at the end. Dome on its rail: brown noise → lowpass 160 Hz with a bump every 0.8 s
(wheel over a joint: a 30 ms low thud). Shutters opening: stick-slip squeal, a narrow band (white noise → bandpass
Q 30) whose centre wanders 1.6–2.4 kHz on a 3 Hz random signal, in two or three 0.4–0.9 s phrases, −18 dB; then a
final metal clunk (strike voice at 320, 870, 2300 Hz, decays 300, 150, 60 ms).

### Great oak in a gust

Leaf rustle is thousands of tiny contacts, energy mostly 2–10 kHz. Recipe (after Farnell's leaf layer, which multiplies
noise by thresholded noise): white noise × sparse-impulse noise low-passed at 60 Hz → highpass 2.2 kHz → peaking +5 dB
at 5.5 kHz Q 0.8. Gain follows the moment's gust envelope with attack 0.8 s; under it, a bough layer: pink noise →
bandpass 280 Hz Q 0.6 at −10 dB, and one or two slow wood creaks. As leaves stream off, let the highpass rise to
3.5 kHz and the level fall over 3 s (the leaves leave). The swing on the oak: a faint rope creak at its period.

### A flock rising (drowned-church birds, beach gulls, V-flocks)

A wingbeat is a short broadband puff on the downstroke. Prerender three flap buffers (pink noise → bandpass 900 Hz
Q 0.8, attack 12 ms, decay 45 ms; variants at 700 and 1200 Hz). Each bird has a hash-given flap rate (gull-sized 3–4 Hz
[U]; small birds 6–10 Hz) and phase; at take-off every bird's first three beats are 6 dB louder and 20 % faster (the
clatter of a flock lifting), then settle. Schedule one-shots per bird per beat; with 5–14 birds this is at most ~60
one-shots a second for the first second, then fewer as birds fade with height (lowpass falling to 1.5 kHz, gain to
zero over the 4.4 s the gulls take to settle elsewhere).

---

## 8. Nice to have

- **Town at a distance.** Do not attempt voices; a synthetic crowd is the uncanny valley. Use a very quiet bed (pink
  noise → bandpass 500 Hz Q 0.4, −40 dB) and sparse, seeded, recognisable events: a smith's hammer (strike voice at
  1.9, 3.1, 4.7 kHz, decay 120 ms, in runs of 3–5 at 0.6 s), a cart, a halyard tapping a mast at the harbour (click at
  2.8 kHz every 0.4–0.9 s in wind), the clock.
- **Windmill.** Four sails: a soft whoosh per sail pass (pink → bandpass 350 Hz Q 0.7, 0.5 s swell) at 4 × the
  rotation rate (about one a second), and a creak per turn: stick-slip = an impulse train at an irregular 25–70 Hz
  (a sawtooth oscillator frequency-modulated by noise) → bandpasses 420 and 980 Hz Q 12, 0.3–0.8 s, pitch sagging 20 %.
- **Whale.** Blow: white noise → bandpass 1.4 kHz Q 0.7 falling to 700 Hz, attack 30 ms, 0.7 s, then a softer 0.4 s
  inhale at 500 Hz. Breach: boom (brown, lowpass 120 Hz, attack 60 ms, decay 0.8 s, plus sine 45 Hz), a 2.5 s crown
  of hiss, then rain-back from the `plunge` bed.
- **Balloon burner.** Turbulent flame roar: pink noise → lowpass 900 Hz + bandpass 180 Hz Q 1, gain fluttering
  ±4 dB on a 15–25 Hz random signal; gas jet: white → bandpass 4.5 kHz Q 1 at −12 dB. Instant on (20 ms, with a low
  "whoomp"), blasts of 2–5 s at seeded gaps of 10–25 s.
- **Heron.** One harsh croak: sawtooth falling 95 → 70 Hz (heard as separate pulses) plus 20 % noise, through
  bandpasses 1.1 and 2.3 kHz Q 3; 0.45 s; attack 20 ms. Once, on lifting.
- **Tall ship.** Rigging tones from f = 0.2·U/d [S]: for 10 m/s wind, 10 mm rope → 200 Hz, 5 mm → 400 Hz [D]. Three
  narrow bands (Q 40) at 210, 390 and 640 Hz following the gust signal, faint; timber creaks (windmill creak, lower);
  a canvas thump now and then (brown burst, lowpass 200 Hz).

---

## Shared building blocks

**Noise buffers.** Generate once from `rngFor(seed, "audio/…")`:

- *White*: 2^18 samples (5.5 s at 48 kHz), two channels, independent.
- *Pink*: white through Paul Kellet's three- or six-pole filter (https://www.firstpr.com.au/dsp/pink-noise/). Run the
  filter over the buffer twice and keep the second pass, so the filter state at the loop point is continuous.
- *Brown*: leaky integrator `y = 0.997·y + 0.05·x`, same two-pass trick, then remove the mean.
- *Sparse impulses* ("velvet"): mostly zeros, with N impulses a second of random sign and amplitude (one buffer at
  1500/s for shingle, one at 300/s for crackle and leaves).

Every consumer starts its `AudioBufferSourceNode` at its own seeded offset (`start(when, offset)`) and, where two reads
feed left and right, offsets at least 1 s apart or different channels. Give long-running sources slightly different
`playbackRate`s (0.97–1.03) so no two layers loop together. A 5.5 s noise loop is not audible as a loop; a filtered
bubble or impulse loop can be, which is why those beds have unrelated lengths.

**Strike voice** (clacks, hooves, wheel clicks, hammers, clunks). Exciter: 2–6 ms noise burst. Resonators: 2–4 parallel
bandpass biquads. A bandpass of centre f and quality Q rings for T60 ≈ 2.2·Q/f seconds [D], so set `Q = f·T60/2.2`
(1 kHz for 0.1 s → Q 45). Good to Q of a few hundred; for rings longer than about 0.5 s use oscillators with gain
envelopes instead (bells, chimes). Prerender the common ones in 3–4 variants and play them as one-shots at ±5 % rate.

**Envelope helper.** One function that takes an `AudioParam`, a start time and a list of segments, and writes
`setValueAtTime`, `linearRampToValueAtTime` and `setTargetAtTime` calls. Rules: no gain step without at least a 3 ms
ramp; exponential decays use `setTargetAtTime` with time constant T60/6.91; before rescheduling a parameter that is
mid-envelope, hold its present value (`cancelAndHoldAtTime` where supported, else `cancelScheduledValues` +
`setValueAtTime` of the computed value; the other note covers browser support). Keep the segment maths pure (a function
from clock phase to value) so the unit tests can check the schedules.

**Seeded event scheduler.** The pattern from "A Tale of Two Clocks" (https://web.dev/articles/audio-scheduling): a
timer wakes every ~50 ms and schedules, on the audio clock, every event that falls within the next ~200 ms. Our events
come from pure functions of time, never from state: *periodic* (wave k of a voice at `(k − bend)·5.2`), *slotted*
(time cut into slots; `hash2(stream, slot, seed)` says whether the slot holds an event, where in the slot, and which
variant; this is how `rareSlot` and `momentWindow` already work), and *phase-driven* (chuffs, cobbles, wingbeats: an
accumulated phase crossing whole numbers). A scheduler pass asks each stream for "events in [t0, t1)", which is easy to
test and makes a paused tab resume correctly: on resume, ask only for the window ahead and drop the past.

**Prerender at start-up.** Bubble beds (plain arrays), bell strokes (`OfflineAudioContext`), chuff, flap, lap and strike
variants. About 20 MB of float buffers in the full set; build them after the user turns sound on, most-needed first
(noise → wind → surf), bells last, in slices so no frame goes over budget.

**Where an AudioWorklet would be truly better.** (1) A live bubble generator for rivers, falls, laps (and rain later):
density and size following the water continuously. (2) A grain generator for shingle with live density. (3) The wind's
control signals, sample-accurate and free of buffers. None is required for a first version; the cost is a second code
path and the message round trip, with no shared memory on this host.

**Rough budget.** Persistent nodes: wind 25 + whoosh 4 + surf 50 + rivers and falls 30 ≈ 110, of which those out of
earshot should be disconnected or have their sources stopped (a silent subgraph still costs audio-thread time in some
browsers). One-shots: a few a second in ordinary flight, tens a second briefly in a bell peal or flock lift. Main
thread: parameter updates at 10–20 Hz plus the 50 ms scheduler, well inside 0.3 ms a frame.

---

## What to prototype first

1. **Wind with the three control signals** (layers A, B, D only), driven by a recorded flight (speed and bank over
   time) in an `OfflineAudioContext`, checked by ear and by spectrogram at brake, cruise and boost. If the wind is
   right, the site already feels alive; if it is wrong, nothing else will rescue it. Add the turn whoosh in the same
   prototype, since it is the same graph.
2. **One beach voice on the wave clock**, playing the nine-wave set at a single bend, then four voices at different
   bends. Listen for the lull, the asymmetric envelope and the colour change through the run-up. Then the shingle
   rattle, which tests the sparse-impulse buffer.
3. **One bell stroke**, prerendered, compared by spectrogram with the partial table; then the same stroke through the
   distance chain (lowpass, level wander, reverb). Then five bells swinging.
4. **The bubble bed** for a brook, since rivers, laps, slosh, the train's water and the whale all reuse it.
5. **One gull kyow and one long call**, tuned against a published sonogram.
6. Moments in order of how often they are met near the start: the town clock, then the train, the seaplane, the ferry.

For each prototype, write the reference numbers used and what was changed by ear back into this note, replacing `[U]`
marks with what was found.
