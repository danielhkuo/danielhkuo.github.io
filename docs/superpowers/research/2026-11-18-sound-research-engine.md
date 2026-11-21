# Sound for the world: engine, space and transitions

Research note, 2026-11-18. Companion to `2026-11-18-sound-factsheet.md`. It covers the engine around the sounds:
spatialization, transitions, platform behaviour, mix, performance and accessibility. Synthesis recipes are in the
other note.

A claim with a link was checked against that source this week. "Measured here" is the benchmark in section 5.
"Unverified" means no primary source was found. "Judgement" marks a design opinion.

Axes used below: world x runs east, world y runs south, north is up the screen (fact sheet). `dx`, `dy` are the
torus-wrapped offsets from the listener to a source, in cells.

## 1. 3D spatialization for an overhead flight

### What the API gives

- **StereoPannerNode**: equal-power pan from one `pan` value in −1…1. `gainL = cos(x·π/2)`, `gainR = sin(x·π/2)`
  ([spec §6.3.3](https://webaudio.github.io/web-audio-api/#stereopanner-algorithm)).
- **PannerNode "equalpower"**: the same pan law driven by azimuth. Elevation is ignored, and azimuth is folded into
  ±90°, so a source in front and its mirror image behind sound identical
  ([spec §6.3.1](https://webaudio.github.io/web-audio-api/#Spatialization-equal-power-panning)). It gives no
  front/back or up/down cue at all. Its parameters are a-rate.
- **PannerNode "HRTF"**: convolution with measured head responses; parameters are forced to k-rate
  ([spec, PanningModelType](https://webaudio.github.io/web-audio-api/#enumdef-panningmodeltype)). Chrome, Firefox and
  WebKit all descend from the same code. In Chromium: 256-sample kernels with a 512-point FFT at 44.1/48 kHz; two
  convolvers when still, four while moving; a linear crossfade of 2048 frames (about 43 ms at 48 kHz) between the
  old and new kernel whenever the azimuth index or elevation changes; an interaural delay line of up to 2 ms;
  latency of half the FFT size (about 5 ms)
  ([hrtf_panner.cc](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/platform/audio/hrtf_panner.cc);
  Firefox has the same 2048-frame crossfade in
  [HRTFPanner.cpp](https://github.com/mozilla-firefox/firefox/blob/main/dom/media/webaudio/blink/HRTFPanner.cpp)).
  So HRTF does not click on fast moves. Its artifacts are different: a new position waits for the running
  crossfade, so fly-bys track in roughly 45 ms steps, and the 5 ms latency combs against any dry copy.
- **Chromium's equal-power panner does no smoothing between render quanta**
  ([equal_power_panner.cc](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/platform/audio/equal_power_panner.cc)).
  A position set once a frame steps the gains at 60 Hz. Smoothing is our job.
- **Distance models** ([spec](https://webaudio.github.io/web-audio-api/#enumdef-distancemodeltype)): inverse
  `ref / (ref + f·(max(d, ref) − ref))` (the default; `maxDistance` is not used, so it never reaches silence);
  linear (reaches `1 − f` at `maxDistance`); exponential `(max(d, ref)/ref)^−f`. Defaults: `refDistance` 1,
  `rolloffFactor` 1. With `rolloffFactor = 0` the inverse model is a constant 1.
- **Doppler** was removed from the spec and from Chrome and Firefox (Firefox 63); no replacement was offered
  ([Mozilla bug 1148354](https://bugzil.la/1148354),
  [Chromium intent](https://groups.google.com/a/chromium.org/g/blink-dev/c/-1SI1GoHYO8)).
- Firefox has no `AudioListener.positionX` family
  ([compat data](https://github.com/mdn/browser-compat-data/blob/main/api/AudioListener.json)).

### Headphones and laptop speakers

HRTF only works on headphones. Over speakers each ear hears both channels, which corrupts the cues and colours
the tone (crosstalk; e.g. [Choueiri's patent text](https://patents.google.com/patent/US9167344B2)). The web cannot
tell whether headphones are in use, so the default must be speaker-safe stereo and HRTF an opt-in. Delay-based
tricks fail on phones: summed to a mono speaker, a 0.6 ms delay puts a notch near 830 Hz (computed). Decorrelated
noise is mono-safe: it sums in power.

### Sound scale

Take **1 cell = 1 metre** for distance and air absorption. It matches the picture: the frame is 400 m × 280 m, the
dragon flies 18 m up, cruise is 60 m/s (216 km/h), boost 108 m/s. Each effect scales differently:

- **Inverse-law loudness** is scale-free: only `d / refDistance` matters.
- **Air absorption** is absolute in metres, so the scale fixes it.
- **Propagation delay** is `d / 343`: 0.58 s at the frame edge. A wave that visibly breaks 0.5 s before it is heard
  reads as a sync bug, not as physics. Recommendation: no propagation delay on direct sound.
- **Doppler** is `1200·log2(1 ± v/343)` cents for a still source (computed):

  | Radial speed | Approaching | Receding |
  | --- | --- | --- |
  | 15 m/s | +74 | −77 |
  | 27 m/s | +131 | −142 |
  | 60 m/s (cruise) | +279 | −333 |
  | 108 m/s (boost) | +474 | −655 |

  True-scale Doppler bends every passing sound by five to eleven semitones. That is correct for a jet and wrong for
  a storybook; bells would sour on every pass. Use a **Doppler speed scale of 0.25** (cruise acts as 15 m/s), clamp
  to ±100 cents, and apply it only to mechanical one-off movers (train, seaplane, airship). Never to bells, beds or
  gulls. Emulate it with `detune` on the sources, and `detune` on any BiquadFilterNode that shapes noise, from a
  radial velocity smoothed with τ = 150 ms. A modulated DelayNode gives true Doppler for any signal but also adds
  the propagation delay we just rejected, and its interpolation dulls the highs.

### Air absorption

I computed ISO 9613-1 coefficients from the standard's closed form (the formula as transcribed at
[sengpielaudio](https://sengpielaudio.com/AirdampingFormula.htm); the 20 °C / 70 % row matches the ISO 9613-2
table values of 5.0 and 9.0 dB/km at 1 and 2 kHz that I know from memory, unverified against the paid text):

| dB per km | 1 kHz | 2 kHz | 4 kHz | 8 kHz | 12 kHz | 16 kHz |
| --- | --- | --- | --- | --- | --- | --- |
| 15 °C, 80 % (sea air) | 4.2 | 8.3 | 24 | 84 | 178 | 300 |

Above 2 kHz this is close to `1.3e-6 · f²` dB/km. A second-order Butterworth low-pass with
**`fc = 1500 / sqrt(d_km)` Hz** matches it at `fc` (3 dB) and at `2·fc` (12 dB). That gives 9.5 kHz at 25 m, 4.7 kHz
at 100 m, 3.4 kHz at 200 m, 2.1 kHz at 500 m, 1.5 kHz at 1 km. Clamp to 800 Hz…18 kHz.

### Area sources

Game engines do not treat a shoreline as a point. The common tools are a "spread" value that widens a source toward
all speakers as it gets large or near, several positions on one emitter, or one emitter moved along the nearest
point of a spline ([Audiokinetic Q&A](https://www.audiokinetic.com/qa/1177/how-do-i-simulate-a-sound-that-is-not-a-point-sound-source),
[positioning in Wwise 2018.1](https://www.audiokinetic.com/en/blog/out-with-the-old-in-with-the-new-positioning-revamped-in-wwise-2018.1/)).
The equivalent for our data (judgement):

- Sample shore pixels (by kind: beach, rock, calm), river pixels and fall pixels around the listener. For each
  kind accumulate energy `E = Σ w_i` and a direction vector `D = Σ w_i · u_i`, where `w_i` is the distance weight
  squared and `u_i` the unit vector to the sample.
- Bed loudness follows `sqrt(E)` (incoherent sources add in power). Direction is `D / E`. **Spread is
  `1 − |D| / E`**: 0 for one small patch, 1 when surf surrounds the flier.
- Render each bed as two decorrelated voices A and B through StereoPanners at `pan = p − w` and `p + w`, with
  `p = (D.x / E) · 0.85` and `w = 0.8 · spread`. Power stays constant, a far beach is a narrow source on one side,
  and a cove wraps round.
- Near the water (under about 60 cells) add 1–3 point emitters at the nearest shore points, keyed to that spot's
  wave clock, so the break you see is the break you hear.

### Occlusion, clouds, reverb

- **Occlusion.** The flier is above almost everything. A ridge can still block: sample the `land` grid at 4–6
  points along the line; if the ground rises above it, drop the source 6–10 dB and its low-pass to about 900 Hz,
  τ = 300 ms. Second version (judgement).
- **Clouds and mist.** I found no source that clouds muffle sound in any audible way. Treat it as a storytelling
  convention: inside a cloud bank, low-pass the world bus (not the wind) to about 3.5 kHz over 0.6 s (judgement).
- **Reverb.** Open coast is nearly dry. Outdoor reverb design favours a diffuse tail plus separate, discrete
  delays for large reflectors ([Audiokinetic, outdoor impulse responses](https://www.audiokinetic.com/en/blog/outdoor-impulse-responses-boom-library/)).
  A ConvolverNode helps for bells, the train whistle and gulls under cliffs. Generate the impulse response in code:
  seeded noise (from `core/rng.ts`) with an exponential decay, independent left and right, a low-pass whose cutoff
  falls over time (dark tail), plus 3–6 sparse early taps at 150–600 ms for valley slap. 2.5–3 s is enough.
  Cost is small: 0.5 % of one core for a 2 s stereo IR, 0.7 % for 4 s (measured here). Chromium's convolver has
  zero latency (the first stage is a direct convolution;
  [reverb_convolver.cc](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/platform/audio/reverb_convolver.cc)).
  Firefox and WebKit move the part of the tail beyond about 278 ms to a background thread
  ([ReverbConvolver.cpp](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/audio/ReverbConvolver.cpp)).
  Never swap a convolver's buffer while it sounds; use sends.

### Recommendations

1. **Pan follows the screen, loudness follows the dragon.** Compute direction from the frame's centre and distance
   from the dragon. While flying they coincide; on landing the camera eases away and the pan stays true to the
   picture.
2. **The listener never rotates.** Forward is north (up the screen), up is world up. Do not turn it with the
   dragon's heading: screen-left must stay ear-left. Keep the listener at the origin and give sources relative
   positions; this also avoids Firefox's missing listener parameters and the torus seam.
3. **Default spatializer, per voice: GainNode (distance) → BiquadFilterNode low-pass (air, behind, occlusion) →
   StereoPannerNode.** Do distance by hand, in a pure function that unit tests can cover. Do not use PannerNode's
   distance models.
4. **Pan law:** `pan = 0.85 · dx / sqrt(dx² + dy² + 30²)`. The 30-cell term makes a source passing under the
   dragon cross the centre smoothly instead of flipping. The 0.85 cap keeps a little of everything in both ears.
5. **North/south cue** (a convention, since stereo has none): with `b = dy / sqrt(dx² + dy² + 30²)`, for `b > 0`
   (south, "behind") multiply the low-pass cutoff by `1 − 0.35·b` and the gain by `−1.5·b` dB.
6. **Distance gain:** `ref / (ref + (max(d, ref) − ref))` times a smoothstep fade to zero over the last quarter
   of the range, where `d` includes height. Small sources (gull, cart, fall foot): ref 25, silent at 300 cells.
   Medium (train, tall fall, harbour): ref 40, silent at 450. Bells: ref 60, silent at 1500, so the abbey is faint
   but present from the start point 1150 cells away.
7. **Air absorption:** low-pass at `1500 / sqrt(d_km)` Hz, moved in log frequency (section 2).
8. **Doppler:** speed scale 0.25, ±100 cents, mechanical movers only, off under reduced motion.
9. **HRTF:** not in the first version. If added, make it a "Headphones" setting, for at most 6 point sources,
   never beds. Flatten sources into the listener's horizontal plane with a 12-cell minimum radius, set
   `rolloffFactor = 0` and keep our own gain.
10. **Reverb:** one shared ConvolverNode on a send bus with a generated 2.5 s stereo IR. Sends: bells −12 dB,
    whistle and gulls −16 dB, beds none.

## 2. Smooth transitions, no clicks

### The automation methods

- `param.value = x` has been the same as `setValueAtTime(x, currentTime)` since Chrome removed automatic
  de-zippering in 2018; the spec points to `setTargetAtTime` for smoothing
  ([intent](https://groups.google.com/a/chromium.org/g/blink-dev/c/YKYRrh0nWMo),
  [Mozilla bug 1171438](https://bugzil.la/1171438)). At 60 Hz it makes steps: audible zipper on tones, masked on
  noise.
- `setTargetAtTime(target, t0, τ)`: `v(t) = target + (v0 − target)·e^(−(t−t0)/τ)`
  ([spec](https://webaudio.github.io/web-audio-api/#dom-audioparam-settargetattime)). A new call takes over from
  the current value, so it is interruptible by construction. Chromium ends the event after 10 τ or when within
  4.5e-5 of the target, then the parameter returns to its cheap constant path
  ([audio_param_handler.cc](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/modules/webaudio/audio_param_handler.cc)).
- `linearRampToValueAtTime` ramps from the *previous event*, not from now. It needs an anchor first. Cancelling a
  ramp midway with `cancelScheduledValues` snaps the value back (a click).
- `cancelAndHoldAtTime` fixes that. Support as of November 2026: Chrome 57+, Safari 14.1+, **Firefox none**
  ([compat data](https://github.com/mdn/browser-compat-data/blob/main/api/AudioParam.json); Mozilla
  [bug 1308431](https://bugzil.la/1308431) is still open and unassigned). Fallback:
  `cancelScheduledValues(now); setValueAtTime(param.value, now)`. The `value` getter has reflected automation since
  Firefox 69.
- Firefox quirks in the same data: `exponentialRampToValueAtTime` "sometimes jumps to value immediately"
  ([bug 2011524](https://bugzil.la/2011524)); `cancelScheduledValues` does not cancel an in-progress value curve
  ([bug 1752775](https://bugzil.la/1752775)); before Firefox 134 a `value` set alongside automation was ignored.
- `setValueCurveAtTime` throws if it overlaps another event. `exponentialRamp` cannot reach zero.

So: build the engine on `setTargetAtTime`. Use `setValueAtTime` + `linearRampToValueAtTime` only for envelopes of
freshly made one-shot voices that nothing interrupts. Avoid value curves and exponential ramps.

### Per-frame control

Compute all targets in a pure mixer each frame. Send a target to its AudioParam only when it moved by more than a
threshold (0.5 dB, 1/24 octave, 0.02 pan), and at most once a frame. Choose τ at least 1.5× the worst update
interval, so the one-pole hides the staircase; allow for 30 fps.

| Parameter | τ |
| --- | --- |
| Point-source distance gain | 60 ms |
| Pan | 60 ms |
| Bed gains and bed spread | 250 ms (the scan is sampled and noisy) |
| Filter cutoff | 100 ms, in log frequency |
| Detune (Doppler, wind pitch) | 150 ms |
| Occlusion | 300 ms |
| Mute fade out / fade in | 40 ms / 150 ms |

**Move cutoffs in log frequency.** `setTargetAtTime` on `frequency` is exponential in hertz: from 500 Hz to 8 kHz
it covers 3.4 of the 4 octaves in the first τ; back down it covers 1.3 (computed). Instead fix
`frequency = 1000` and automate the filter's `detune` (cents) with `1200·log2(fc / 1000)`. Set these params to
`k-rate`: less than half the cost (section 5) and a step every 2.7 ms is inaudible on slow moves.

### Crossfades

- Different textures (beach surf to cliff surf, cruise wind to boost wind) are uncorrelated: use equal power,
  `gA = cos(x·π/2)`, `gB = sin(x·π/2)`. Compute both in the mixer from a continuous `x` (beach share, speed) and
  send them with the same τ.
- The same signal through two paths is correlated: use linear gains that sum to 1.
- Prefer morphing one generator (filter and gain) over crossfading two. Wind should be one voice that changes.
- Timed transitions (landing, mist): ease `x` in the mixer with a smoothstep over 1.5–3 s. Do not schedule curves.

### Starts and stops

A practical reference found a 15 ms decay reads as instant and removes the click
([alemangui](https://alemangui.github.io/ramp-to-value)). I found no standard figure. Recommendations (judgement):
attack at least 3 ms for struck sounds that start at a zero crossing, 8 ms otherwise; **any stop or voice steal is
`setTargetAtTime(0, now, 0.015)` then `stop(now + 0.12)`**; culling by distance happens below −60 dB with a 300 ms
fade. Start every looped noise source at gain 0. When a tracked emitter (a waterfall cluster) changes identity,
crossfade the two over 150 ms rather than jumping one voice.

### Two clocks

The page's `t` runs on the requestAnimationFrame clock. Audio runs on `ctx.currentTime`. They drift, and the audio
clock stops while suspended. The standard answer is lookahead scheduling: a frequent callback schedules, on the
audio clock, every event due within a window longer than the callback's worst lateness
([A Tale of Two Clocks](https://web.dev/articles/audio-scheduling): 25 ms timer, 100 ms lookahead).

- Each frame map world time to audio time: `when = ctx.currentTime + (tEvent − tNow)`.
- Schedules are pure functions `events(t0, t1)` (bell strokes, wave breaks, moment cues). Each frame, schedule
  everything in `[scheduledUntil, tNow + 0.2)` with `start(when)`, then advance `scheduledUntil`. The clocks are
  deterministic, so 200 ms of lookahead costs nothing and survives a 200 ms main-thread stall.
- **Stall or `dt` above 0.25 s:** drop events whose time has passed (never play a late burst), snap the mixer's
  smoothing state, and fade the world bus in over 400 ms. Long sounds (the hour's bell count) rejoin in progress:
  work out which stroke we are in from `t`.

### Mute, hide, resume

- **Mute:** `master.gain.setTargetAtTime(0, now, 0.04)`, then `ctx.suspend()` 300 ms later. Suspending matters: a
  running context costs power even when silent ([Mozilla bug 1771179](https://bugzil.la/1771179): "can waste
  multiple watts"; Chrome only pauses the device after sustained silence, and never with an AudioWorkletNode in the
  graph, per the same bug).
- **Unmute:** `resume()`; when `state` is `running`, set every param to its current target with `setValueAtTime`
  (master still at 0), then fade the master in with τ = 150 ms. The very first enable fades in over 1.5 s.
- **Tab hidden:** rAF stops at once, so the frame loop cannot fade. In the `visibilitychange` handler schedule the
  fade on the audio clock (hold, then a 200 ms linear ramp to 0) and `setTimeout(suspend, 250)`. A throttled timer
  is harmless: the gain is already 0.
- **Tab visible:** if sound is on, `resume()` and fade in. While suspended, make no automation calls.

## 3. Platform behaviour

### Autoplay

- An AudioContext is "allowed to start" only once the window has sticky activation
  ([spec](https://webaudio.github.io/web-audio-api/#allowed-to-start)). The HTML standard's activation events are:
  `keydown` (not Escape, not a browser-reserved shortcut), `mousedown`, `pointerdown` **only for a mouse**,
  `pointerup` for touch and pen, and `touchend`
  ([HTML](https://html.spec.whatwg.org/multipage/interaction.html#activation-triggering-input-event)). So
  `touchstart` and touch `pointerdown` do not unlock. `click` always follows a qualifying event.
- Chrome (since 71): a context made before a gesture is `suspended`; call `resume()` after one. It also resumes by
  itself when a source's `start()` is called after activation
  ([Chrome blog](https://developer.chrome.com/blog/web-audio-autoplay)).
- Firefox: `media.autoplay.block-webaudio` defaults to true; contexts play after sticky activation
  ([MDN autoplay guide](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay)).
- Safari: a gesture is required; resume inside the handler. Reports exist of `resume()` failing after a `touchend`
  that slid ([WebKit bug 248265](https://bugs.webkit.org/show_bug.cgi?id=248265)). Desktop Safari's exact event
  list is unverified.
- `resume()` may stay pending (not allowed yet) or reject with InvalidStateError (interrupted). Trust
  `ctx.state` and `statechange`, not the promise.

### Interruptions and iOS

- `"interrupted"` is now in the spec (§2.7) and in Chrome 136+; Safari has long exposed it; Firefox does not
  ([compat data](https://github.com/mdn/browser-compat-data/blob/main/api/BaseAudioContext.json)). Causes: a call,
  another app taking the audio device, the lock screen, Safari going to the background.
- iOS has a run of bugs where the context does not come back after Safari is backgrounded:
  [276016](https://bugs.webkit.org/show_bug.cgi?id=276016) (still open; iOS 17.5 on),
  [281955](https://bugs.webkit.org/show_bug.cgi?id=281955),
  [291892](https://bugs.webkit.org/show_bug.cgi?id=291892) (one user reports it fixed in iOS 26.2 beta; not
  confirmed by WebKit). Workarounds from those threads: on becoming visible, `suspend()` then `resume()`; if
  `currentTime` still does not advance after about 500 ms, build a new context.
- **Silent switch.** Web Audio on iOS uses the "ambient" session: it mixes with other apps and obeys the ringer
  switch ([WebKit bug 237322](https://bugs.webkit.org/show_bug.cgi?id=237322)). The Audio Session API lets a page
  set this: an AudioContext defaults to `ambient`, "mixable with other types of audio"
  ([W3C draft](https://www.w3.org/TR/audio-session/)). Support: Safari 16.4+ only; Firefox preview; Chrome none
  ([compat data](https://github.com/mdn/browser-compat-data/blob/main/api/AudioSession.json)). For an ambient
  world, ambient is the right behaviour. Do not use the silent-`<audio>` tricks that defeat the switch.

### Context options

- `latencyHint`: `"interactive"` (default, lowest latency), `"balanced"`, `"playback"` ("lowest power consumption")
  ([spec](https://webaudio.github.io/web-audio-api/#enumdef-audiocontextlatencycategory)). Actual buffer sizes per
  platform are unverified. Nothing here needs low latency.
- `sampleRate`: leave unset; the default is the device's rate, and forcing one makes the browser resample. All
  synthesis must read `ctx.sampleRate`.

### Hidden tabs and the back/forward cache

- Chrome keeps a hidden tab's context running; tabs playing audio are even exempt from timer throttling
  ([Chrome blog](https://developer.chrome.com/blog/background_tabs)). Chromium interrupts a context for a hidden
  frame only under the opt-in `media-playback-while-not-visible` policy
  ([audio_context.cc](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/modules/webaudio/audio_context.cc)).
  Firefox also keeps playing. Desktop Safari: unverified. iOS interrupts. So we must suspend ourselves everywhere.
- A page with a running context can enter the back/forward cache in WebKit
  ([test](https://github.com/WebKit/WebKit/blob/main/LayoutTests/fast/history/page-cache-running-audiocontext.html));
  Firefox suspends its streams when frozen ([bug 1625375](https://bugzil.la/1625375)). Handle `pagehide` and
  `pageshow`.

### Other Safari reports worth knowing

StereoPannerNode distortion when panned left ([257447](https://bugs.webkit.org/show_bug.cgi?id=257447), 2023);
PannerNode quality degrading over time ([230950](https://bugs.webkit.org/show_bug.cgi?id=230950), 2021);
OfflineAudioContext failing after a few dozen `startRendering` calls
([224279](https://bugs.webkit.org/show_bug.cgi?id=224279), 2021). Current status unverified: test on a real
iPhone before trusting either panner.

### Recommendations

1. Create nothing until sound is first enabled. Load the sound module with a dynamic `import()` and construct the
   AudioContext inside the toggle's `click` handler. A muted visitor pays zero.
2. If the saved preference is "on", arm one-time listeners for `keydown`, `pointerup` and `click`; create and
   resume on the first one. Flight keys count.
3. `new AudioContext({ latencyHint: "playback" })`, no `sampleRate`. Log `baseLatency` and `outputLatency` under
   `?stats`.
4. `if (navigator.audioSession) navigator.audioSession.type = "ambient"`.
5. Drive everything from one state machine fed by `statechange`, `visibilitychange`, `pagehide`/`pageshow` and the
   toggle. If sound is wanted but the state is not `running`, try `resume()`; if that fails, re-arm the gesture
   listeners.
6. Make the engine disposable: `dispose()` and rebuild from nothing, for the iOS stuck-context case.
7. Avoid in the first version: AudioWorklet, PannerNode, `cancelAndHoldAtTime` without the fallback, exponential
   ramps, value curves, AudioListener parameters.

## 4. Mix for realism and comfort

### Loudness

- Broadcast: EBU R 128 targets −23 LUFS with true peaks under −1 dBTP
  ([EBU](https://tech.ebu.ch/docs/r/r128.pdf); from memory, not re-read).
- Games: Sony's ASWG-R001 asks for −24 ±2 LKFS on home consoles and −18 ±2 on portables, peaks under −1 dBTP;
  Audiokinetic repeats −18 for mobile; the Game Audio Network Guild suggests −16 for mobile
  ([Audiokinetic](https://www.audiokinetic.com/en/blog/mastering-a-game-with-wwise-part1/),
  [Designing Sound](https://designingsound.org/2013/02/20/different-loudness-ranges-for-console-and-mobile-games/);
  the Sony document itself was not read).
- An ambient layer on a web page should sit below those targets (judgement).

### The master bus

- The destination hard-clips. A DynamicsCompressorNode is not a clean limiter: in Chromium it has a fixed 6 ms
  look-ahead (latency) and an automatic make-up gain, `(1 / fullRangeGain)^0.6`, that cannot be turned off
  ([dynamics_compressor.cc](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/platform/audio/dynamics_compressor.cc);
  [public-audio thread](https://lists.w3.org/Archives/Public/public-audio/2014JulSep/0008.html)). With the default
  settings (−24 dB threshold, ratio 12) that lifts quiet material by many decibels (estimated from the formula, not
  measured): the ambience floor rises and pumps.
- There is no side-chain input; duck with scheduled gains. We know the bell schedule in advance.

### Recommendations

1. **Loudness at volume 100 %:** −20 LUFS integrated over a three-minute flight; short-term never above −14 LUFS
   (the hour's bells while boosting over cliffs); peaks under −3 dBFS before the limiter. Check with an
   OfflineAudioContext render and `ffmpeg ebur128`.
2. **Default volume 70 %** with `gain = v²`: about −6 dB, so −26 LUFS. Sound itself is off by default.
3. **Buses:** wind · water · life and moments · bells → world bus → master. The reverb returns to the world bus.
4. **Master chain:** volume → DynamicsCompressorNode as a safety limiter (threshold −3 dB, knee 0, ratio 20,
   attack 3 ms, release 250 ms) → trim −1.7 dB (the make-up at these settings, computed) → WaveShaperNode soft
   clip, linear below 0.7 → destination. Design the mix so the limiter never works: under `?stats` and in the
   offline check, assert `compressor.reduction` stays above −0.5 dB.
5. **Ducking for bells:** from 150 ms before the first stroke, lower the wind and water buses by 3 dB over 400 ms;
   release over 2.5 s after the last. Also dip the beds 2 dB around the bell's main partials with a peaking
   filter. No pumping, because nothing reacts to level.
6. **Speed masks the world:** at boost, wind +5 dB and world bus −2 dB. **Landed** (`restShare`): wind falls to
   a ground breeze and the world bus drops 6 dB under the Codex.
8. **Width:** beds decorrelated left and right, with content under 150 Hz in the centre. Point sources within
   ±0.85. No delay-based widening.
9. **Fatigue over ten minutes:** an overall tilt near −3 dB per octave; constant layers keep their energy under
   1.5 kHz; no fixed resonances; every continuous layer modulated by two or three slow, unrelated rates (0.07,
   0.11, 0.19 Hz); a ±2 dB drift over 3–8 minutes. Let quiet places be quiet: inland at brake speed, −40 LUFS.
10. **No audible loops:** noise buffers of unequal lengths (about 7 s and 12 s), different ones left and right,
    random start offsets from the seeded generator. One-shots vary ±3 % in pitch and ±2 dB in level, and never
    repeat the same variant twice running.
11. **Check on small speakers:** every sound must stay recognisable through a 200 Hz high-pass.

## 5. Performance

### Measured here

Chrome 148 (headless), Apple M5 Max, 48 kHz. Each graph was rendered for 30 s in an OfflineAudioContext, best of
three; cost is render time as a share of real time, per node, on one core. Looped noise buffers as sources. The
script is not committed (it lived in the session scratchpad). A mid-range laptop is perhaps 3× slower per core and
a mid-range phone 5–6× (estimates, not measured).

| Per node | Cost (% of one core) |
| --- | --- |
| AudioBufferSourceNode, looped noise | 0.003 |
| GainNode, static / a-rate ramp | 0.003 / 0.004 |
| BiquadFilterNode, static | 0.015 |
| BiquadFilterNode, automated, k-rate / a-rate | 0.027 / 0.065 |
| StereoPannerNode, static / automated | 0.006 / 0.040 |
| PannerNode equalpower, static | 0.012 |
| PannerNode equalpower, position ramped | 0.33 |
| PannerNode HRTF, static | 0.066 |
| PannerNode HRTF, position ramped | 0.43 |
| ConvolverNode, stereo IR 0.5 s / 2 s / 4 s | 0.33 / 0.49 / 0.72 |
| ConvolverNode, mono IR 2 s | 0.24 |
| DynamicsCompressorNode | 0.11 |
| WaveShaperNode, none / 4× oversampling | 0.008 / 0.17 |
| DelayNode, modulated | 0.011 |
| AudioWorklet white noise | 0.022 |

What this says:

- **Automation is the cost, not the node type.** A moving PannerNode costs 27× a still one, because azimuth and
  distance are recomputed per sample. A moving HRTF panner is only 1.3× a moving equal-power one in Chrome.
- The hand-built voice (source, gain, k-rate low-pass, StereoPanner) costs about 0.08 % while moving: a quarter of
  a moving PannerNode. Twenty-four voices, the reverb and the master chain come to about 2.5 % of this core:
  roughly 8 % on a mid laptop and 15 % on a mid phone by the estimates above.
- HRTF is affordable in small numbers: 6 moving HRTF panners are 2.6 % here. Published figures such as "4–8 HRTF
  sources on mobile, 16–24 on desktop" come from guides with no stated method; treat them as folklore. Mozilla's
  only number is that a still equal-power PannerNode took about 20 % of a simple source benchmark
  ([bug 1851758](https://bugzil.la/1851758)).
- Firefox and Safari were not measured; engines differ
  ([Paul Adenot's notes](https://padenot.github.io/web-audio-perf/)).

Main thread, same machine, live context, 80 parameter updates a frame:

| Call | µs per call |
| --- | --- |
| `setTargetAtTime` | 0.25 |
| `setValueAtTime` | 0.32 |
| `value =` | 0.41 |
| cancel + set + `linearRamp` | 0.61 |

At 4× CPU throttle, 60 `setTargetAtTime` calls cost about 0.06 ms. The 0.3 ms budget is safe if the scan of
shore pixels is kept cheap.

### AudioWorklet or native

A worklet runs JavaScript on the audio thread, where a garbage-collection pause or a missed 2.7 ms deadline is a
glitch ([web.dev profiling](https://web.dev/articles/profiling-web-audio-apps-in-chrome),
[worklet design pattern](https://developer.chrome.com/blog/audio-worklet-design-pattern)). It also blocks Chrome's
silent-stream power saving (section 2). Everything this note asks for can be done with native nodes.

### Recommendations

1. **All native nodes; no AudioWorklet** in the first version.
2. **Budgets:** at most 24 sounding voices on desktop and 12 on touch devices; at most 120 live nodes; one
   convolver; one compressor. Voices are prioritised by gain; the quietest is stolen with the 15 ms fade.
3. **Stop culled voices.** A noise source at gain 0 still costs. Stop and disconnect it; restart at gain 0.
4. **Keep parameters still when the scene is still.** Thresholded updates let automations finish, and the nodes
   fall back to their static cost. Set filter parameters to `k-rate`.
5. **Pool the chains, not the sources.** Keep 8–12 emitter slots (gain → filter → panner) and attach new
   source nodes to them. Sources are single-use by design.
6. **Pre-render one-shots at unlock** (gull cries, bell strokes, whistle) into AudioBuffers with one or two
   OfflineAudioContext renders, sliced afterwards. A buffer source is the cheapest node in the table, and few
   renders keep Safari's offline bugs out of reach. Generate the reverb IR off the frame too.
7. **Main thread:** one preallocated typed array of targets; no allocation per frame; the shore scan at about
   10 Hz in slices (roughly 1400 samples); nothing runs while suspended.

## 6. Preferences and accessibility

- **There is no `prefers-reduced-sound`.** "Respect sound settings" on the web can only mean: never start sound
  without a request; remember the user's choice and volume; use the ambient audio session so the iOS silent
  switch and the user's own music win; stop when hidden; register no Media Session.
- **WCAG 1.4.2 Audio Control (Level A):** audio that plays automatically for more than 3 seconds needs a way to
  pause or stop it, or a volume control independent of the system volume. The reason is screen-reader speech,
  which shares the system volume. Sufficient techniques include G171 "playing sounds only on user request" and
  G170, a control near the start of the page
  ([Understanding 1.4.2](https://www.w3.org/WAI/WCAG22/Understanding/audio-control.html)). Off by default with a
  toggle meets G171. A remembered "on" that starts at the first key press is closer to automatic, so G170 and the
  volume control should both hold.
- **The toggle.** MDN suggests a button with a clear label and `role="switch"` for audio on/off
  ([Web Audio best practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices)).
- **Game guidance:** no essential information by sound alone; settings remembered; a stereo/mono toggle
  ([Game Accessibility Guidelines](https://gameaccessibilityguidelines.com/full-list/)).
- **Reduced motion.** `prefers-reduced-motion` is about visual motion. No standard says what it means for sound.
  Motion-linked sound (pitch sweeps, whooshes, fast pans, a roar that rises with speed) reinforces the sense of
  movement, so it is reasonable to soften it (judgement).

### Recommendations

1. A real `<button type="button" role="switch" aria-checked="false">` with the constant accessible name "Sound".
   The pixel icon is `aria-hidden`. Early in the tab order, visible focus ring, at least 44 × 44 CSS pixels.
   Optional `M` shortcut, active only when no text field has focus.
2. When sound is on but waiting for a gesture, add a visible hint tied by `aria-describedby`: "Sound starts with
   your next key press."
3. A volume slider (`<input type="range">`, 0–100, labelled "Volume") in the settings menu, saved with the toggle.
4. A "Mono" setting: a final GainNode with `channelCount = 1`, `channelCountMode = "explicit"`.
5. Under reduced motion (the media query or the site's own setting): Doppler off; the turn whoosh off; pan range
   halved (±0.42) and pan τ doubled; the wind's speed range halved; no onset more than 6 LU above the bed.
6. On iOS, the first time sound is enabled, show once: "No sound? Check the silent switch."

## Decisions to make in the design

| # | Choice | Recommendation |
| --- | --- | --- |
| 1 | Spatializer | Hand-built gain → low-pass → StereoPanner per voice. No PannerNode. |
| 2 | HRTF | Leave out of v1. Revisit as a "Headphones" setting after an A/B listen on six point sources. |
| 3 | Listener | Direction from the frame centre, distance from the dragon, facing fixed north. |
| 4 | Sound scale | 1 cell = 1 m for distance and air; Doppler at 0.25 speed scale, ±100 cents, movers only; no propagation delay. |
| 5 | Area sources | Energy-weighted direction and spread, two decorrelated voices per bed, plus 1–3 near emitters on the wave clock. |
| 6 | Where the shore scan reads | The frame's bake pixels at 10 Hz, extended to 400 cells with the `land` grid so surf is heard before it is seen. |
| 7 | Reverb | One generated 2.5 s stereo IR on a send bus. Cliff echo delays driven by the nearest cliff: later. |
| 8 | Occlusion and cloud muffling | Later. Leave a per-voice `occlusion` input and a world-bus low-pass in the graph now. |
| 9 | Automation | `setTargetAtTime` everywhere with the τ table; cutoffs via `detune`; thresholded sends. |
| 10 | Scheduler | Pure `events(t0, t1)` schedules, 200 ms lookahead from the frame loop, drop late events. |
| 11 | Context | Lazy, in the toggle's click; `latencyHint: "playback"`; suspend on mute and hide; disposable engine. |
| 12 | Saved "on" preference | Start at the first key press or tap, with the visible hint. The stricter alternative is to require the toggle on every visit. |
| 13 | AudioWorklet | None in v1. |
| 14 | Master | −20 LUFS at 100 %, default 70 %; safety limiter that must stay idle; scheduled ducking for bells. |
| 15 | Voice budget | 24 desktop, 12 touch. Confirm on a real mid-range phone and in Safari and Firefox, which were not measured. |
| 16 | Reduced motion | The softened set in section 6. Needs the owner's agreement, since no standard defines it. |
| 17 | Device testing | iPhone Safari (background, lock, silent switch), Firefox, desktop Safari before release. |
