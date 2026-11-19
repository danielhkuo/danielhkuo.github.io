# Flying on a phone: design

Status: approved 2026-11-18. The owner took every recommended option (section 11). Nothing is built.

- **Evidence:** `docs/superpowers/research/2026-11-18-mobile-web-game-controls.md` ("the research doc"), including
  measurements taken in the iOS 26.5 Simulator.
- **[Owner]** marks a decision that was the owner's. All are settled, and the option listed first (marked
  "recommended") is the one chosen.
- **[Call]** marks Claude's call, which the owner can overturn.
- ***tune*** marks a starting number, to be set on a real phone.

## The shape in brief

- **Phones get the short version first.** A phone has its own title screen, and its first and largest choice is The
  Recruiter. Flying is the second choice, and nothing heavy loads until the visitor picks it.
- **One tap starts the flight.** On `/world` a touch device first shows a "Before you fly" card. Its **Take wing**
  button is the user gesture every platform needs to:
  - enter fullscreen and lock landscape, where the browser allows it (Android);
  - unlock sound;
  - ask for tilt permission, if tilt is on.
- **The view is locked.** Flight on a phone is landscape only. Nothing zooms, scrolls, bounces, refreshes, selects or
  opens a menu, and Back opens the game's pause sheet instead of leaving the site. The camera is the desktop's
  overhead camera at one fixed whole-pixel scale. iPhone has no orientation lock, so the game pauses behind a
  "turn your phone" card whenever the phone is upright. The card has a way out for phones whose screen will not turn.
- **The controls.** A floating stick under the left thumb points where to fly. Boost and Brake sit under the right
  thumb, and Land joins them when a landmark is in reach. A small pause seal sits in the top corner. All are pixel art
  in the frame's own hard pixels.
- **One way of teaching.** One short learn-by-doing guide and one set of prompts serve keys, touch and gamepad. The
  prompts follow whichever input was used last, on desktop and phone alike.
- **Phone budgets.** Two bake workers, and a 60 fps cap that steps down to 30 when frames run long. Everything pauses
  when the page is hidden.
- **Tests.**
  - `npm test`: pure-function unit tests and pixel goldens of the controls.
  - Puppeteer: real multi-touch flows in phone emulation.
  - The iOS Simulator: a pass for iPhone-only behaviour.
  - The owner: a short checklist on real phones.

## What exists today

| Piece | Where | What it does now |
|---|---|---|
| Flight page | `src/app/world/Flight.tsx` | Input is keyboard only (`inputFromKeys`): arrows/WASD turn, Up/W/Shift boost, Down/S brake, Esc goes to `/`. The 400×225 frame is scaled by `fitScale` to a whole number of device pixels and letterboxed on paper, with a fixed hint line along the bottom. The bake pool holds `clamp(hardwareConcurrency − 1, 1, 4)` workers. |
| Flight model | `src/world/runtime/flight.ts` | `FlightInput { turn: −1 \| 0 \| 1; boost; brake }`. Bank eases toward `turn` at 6/s, and heading turns at 1.6 rad/s × bank. `CRUISE` 60, `BOOST` ×1.8, `BRAKE` ×0.5, `DT_MAX` 0.1 s. |
| Landing and the Codex | `claude/landing-codex-a05077` | Phases run flying → landing → landed. Space/Enter or a tap on `LandPrompt` lands. The Codex dialog is a right panel, or a bottom sheet under 760 px, and its button takes off. The abbey opens the terminal, and `?at=<site>` starts the flight beside a site. |
| Desktop title screen | `claude/title-menu-9effb3`, in progress | `src/components/title/`. The Recruiter is preselected on phones, by `PHONE_QUERY = "(max-width: 699px), (pointer: coarse) and (max-height: 499px)"`. Sound and Motion settings live in localStorage `settings`, site-wide; the bells are synthesised in Web Audio. |
| Text page | `/recruiter`, on `feat/dragon-world` | The whole site as one plain page. |
| Site shell | `src/app/layout.tsx`, `public/site.webmanifest` | `viewport-fit=cover` site-wide. The manifest has `display: standalone`, no `orientation` and no `start_url`. |
| Checks | `npm test`, `scripts/world-fly.mjs`, `npm run a11y` | `node --test` units. Puppeteer flies `/world?stats` by keys and reads `window.__flight`. axe checks pages at 375 and 1280 px. |

**Non-goals:**
- **A minimap.** The owner wants none; the parchment map stays a later "for fun" extra.
- **Haptics on iPhone.** No web API can play them from a script.
- **Native wrappers.**
- **Changes to desktop flight,** beyond the shared prompts and guide.

## 1. How phones reach the short version, and how they opt in

**[Owner] decision 1: the front door on a phone.**
- **A (recommended).** The phone title screen (section 2), with The Recruiter its first, largest, preselected choice
  and flying second.
- **B.** Phones skip the title and open `/recruiter`, which carries a "Fly the realm" line at the top.
- **C.** As A, but once a visitor has flown, their phone title leads with "Fly on".

**Who is a phone.**
- **For the title:** the title-menu work's `PHONE_QUERY`, used in both CSS and JS.
- **For the flight:** a coarse pointer and a short side under 500 px. That narrower test keeps a rotate card off a
  narrow desktop window.
- **For the controls:** whether the touch controls show is a separate question, answered by the last input used
  (section 6).

**The opt-in.**

1. Phone title → **Fly the realm** → `/world`.
2. On a touch device (phone or tablet), `/world` opens on the **Before you fly** card. A deep link gets the same card,
   and nothing starts by itself.
   - The world starts loading behind the card, because the visitor chose to come. The card states the download size,
     read from the build [Call].
   - The card costs one extra tap (CrazyGames asks for play within one click), but the fullscreen and lock calls need
     a tap on the flight page itself.

   ```
   ┌────────────────────────────────────────┐
   │  ¶ Before you fly                      │
   │   ▯→▭  Hold your phone sideways.       │   pixel glyph of a phone turning (phones only)
   │        About 1.6 MB to start.          │
   │   ✤ Sound  off                         │   the shared settings toggle
   │        ╔══════════════════╗            │
   │        ║    Take wing     ║            │
   │        ╚══════════════════╝            │
   │      Read the short version instead →  │   /recruiter
   └────────────────────────────────────────┘
   ```

3. **Take wing** is a `click`, which counts as user activation everywhere. In order, each step allowed to fail
   quietly:
   - **Android:** `await requestFullscreen({ navigationUI: "hide" })`, then `await screen.orientation.lock("landscape")`.
   - **iPad:** `requestFullscreen()`.
   - **Every platform:**
     - resume the shared `AudioContext` if sound is on (on iOS only a discrete tap unlocks audio, never a stick drag);
     - call `DeviceOrientationEvent.requestPermission()` if tilt is on and the function exists;
     - start the flight, and run the guide (section 7) unless it has been seen.
4. A phone held upright after Take wing gets the rotate card (section 5).
5. **Desktops go straight in, as today.** A touchscreen laptop shows the touch controls when it is touched.

**Remembered.** localStorage `flight` holds `{ flown: true }`. It feeds the guide's "already seen" check and, under
option C, the order of the phone title.

## 2. The phone title screen

`PhoneTitle` is a component of its own, at the same URL as the desktop title:
- **Both in the page.** The static page holds both title screens. CSS on `PHONE_QUERY` shows one and sets the other
  to `display: none`, which also removes it from the accessibility tree. Nothing flashes and no script chooses.
- **Shared data.** Words come from the title's `copy.ts`, and the settings are the same record.

**The look [Owner, after mockups].** "A page of an illuminated book."
- **Layout:** the rose window as a small headpiece, the name, an inked rule, and the ways in as a short contents page.
- **Kept from desktop:** the quatrefoil bullet that fills red when chosen, and IM Fell English.
- **Touch only:** no hover states. Every target is at least 48 px tall, and the two lead cards about 76 px.
- **Mockups:** Fable draws two or three, and the owner picks one.

```
Portrait                        Landscape (e.g. back from a flight)
┌──────────────────────────┐    ┌──────────────────────────────────────────────────────┐
│           ✠              │    │   ╭─────────╮      ┌──────────────────────────────┐  │
│      ╭───────────╮       │    │   │ (rose)  │      │ ❦ The Recruiter · short      │  │
│      │  (rose)   │       │    │   ╰─────────╯      └──────────────────────────────┘  │
│      ╰───────────╯       │    │   DANIEL KUO       ┌──────────────────────────────┐  │
│       DANIEL  KUO        │    │  ─────❖─────       │ ✤ The Wayfarer · fly         │  │
│     ───────❖───────      │    │  a portfolio you   └──────────────────────────────┘  │
│   a portfolio you can    │    │  can fly through    ✤ Artificer  ✤ Herald  ✤ Settings │
│       fly through        │    └──────────────────────────────────────────────────────┘
│ ┌──────────────────────┐ │
│ │ ❦ The Recruiter      │ │  lead card, preselected; opens /recruiter
│ │   the short version  │ │
│ └──────────────────────┘ │
│ ┌──────────────────────┐ │
│ │ ✤ The Wayfarer  ▯→▭  │ │  "turn sideways · about 2 MB"
│ │   fly out and find   │ │
│ └──────────────────────┘ │
│  ✤ The Artificer         │  rows 48 px tall
│  ✤ The Herald            │
│  ✤ Settings              │  bottom sheet: Sound, Motion
└──────────────────────────┘
```

**Tablets** get the desktop title. The Wayfarer's meta line follows the input in use: "arrow keys to steer" or
"touch to steer".

## 3. The view: frame, camera and scale

**The camera stays as it is.** Overhead, north-up, following the dragon, at one zoom: no pinch and no rotation. The
desktop keeps its 400×225 letterboxed frame.

**[Owner] decision 2: the picture on a phone.**
- **Fill the screen (recommended).** The renderer draws a frame sized to the visible area, in whole device pixels, and
  the controls sit over the picture's lower corners.
  - This is the largest picture in every case, including the Home Screen app.
  - It needs a small renderer change.
- **Keep 16:9, controls in the margins.** The 400×225 frame stays, with the controls on paper margins beside it, like
  marginalia on a manuscript page.
  - No renderer change, and nothing covers the land.
  - The picture shrinks to about 35–55% of an iPhone screen. With Safari's tab bar it is 400×225 CSS px, one frame
    pixel per CSS pixel.
  - The Home Screen app leaves margins too thin for a stick unless the frame drops a scale.
  - Under this option, decision 5 falls away: the controls live in the margins, not in the frame.

**Filling the screen.**
- **Inputs:** the visible area is `visualViewport` width × height in device pixels.
- **Scale:** s is the smallest whole number for which the frame W = ⌈visW / s⌉ by H = ⌈visH / s⌉ stays within 110,000
  pixels. The desktop frame is 90,000.
- **The canvas** is W·s/dpr × H·s/dpr CSS px, anchored top-left. The wrapper hides the part of a frame pixel that
  falls past the right or bottom edge.

| Visible area (CSS px @ dpr) | s | Frame | Pixels | CSS px per frame px |
|---|---|---|---|---|
| iPhone 17 Safari landscape, one tab: 874×338 @3 (measured) | 5 | 525×203 | 106,575 | 1.67 |
| iPhone 17 Safari landscape, tab bar: 874×292 @3 (measured) | 5 | 525×176 | 92,400 | 1.67 |
| iPhone 17 Home Screen app: 874×402 @3 (measured) | 6 | 437×201 | 87,837 | 2.0 |
| SE-sized Safari landscape: 667×321 @2 (estimated) | 3 | 445×214 | 95,230 | 1.5 |
| Pixel 7 fullscreen: 915×412 @2.625 | 5 | 481×217 | 104,377 | 1.9 |
| Low-end Android fullscreen: 800×360 @2 | 4 | 400×180 | 72,000 | 2.0 |
| iPad 11" fullscreen landscape: 1194×834 @2 | 7 | 342×239 | 81,738 | 3.5 |

**Control sizes are set in CSS px** and converted to frame pixels by rounding. Their physical size therefore holds
steady while the frame pixel varies (1.5–2 CSS px on phones).

**Size changes mid-flight.** The frame is worked out when a flight starts and whenever it resumes from a pause. In
between, a few rows gained or lost (the tab bar appearing, Safari's toolbar quirks) are cropped or padded with paper,
so the stream view is never rebuilt in flight. On resume, `createStreamView` takes a new frame size and keeps its
chunk cache, through a small `view.resize(w, h)`.

**400×225 assumptions to revisit.**
- `sky/field.ts` lays out the opening cloud composition for 400×225. On other frames it is centred; check it on
  renders.
- The landing branch's `codexShift()` scales by `FRAME_W`.

## 4. Touch controls

### 4.1 Layout

Landscape and right-handed by default; left-handed is the mirror image. Every position comes from one pure function of
the visible area, the safe-area insets, the platform, handedness and the size setting.

**The usable rectangle.**
- **Sides:** at least max(safe-area inset + 16, edge budget) CSS px from the screen's left and right edges. The edge
  budget, 32 px on Android and 24 on iOS, keeps drags out of the system back-gesture strips.
- **Top and bottom:** the safe-area inset + 16.
- **The bottom strip:** the stick never starts in the bottom 24 px.
- **On an iPhone 17 in landscape,** the sides come out at 78 px, from the 62 px insets.

```
  env(safe-area-inset-left)                                env(safe-area-inset-right)
┌──────┬──────────────────────────────────────────────────────────────┬──────┐
│      │ ⦙‖⦙ pause seal                 ¶ A heron in the shallows      │      │
│      │─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ 64 px: no stick above this ─ ─│      │
│      │  STICK ZONE: the left 45%          ~~∿∿ dragon ∿∿~~          │      │
│      │  of the width                                                │      │
│      │                                       ┌─────────────┐ ╭───╮  │      │  Land, only when a
│      │                                       │ Land at the │ │ ⌂ │  │      │  landmark is in reach
│      │      ╭─────╮                          │ abbey       │ ╰───╯  │      │
│      │     │  ✤   │  stick (shown under       └─────────────┘ ╭───╮  │      │
│      │      ╰─────╯   the thumb)                      ╭──╮   │ » │  │      │  Boost
│      │                                               │ « │   ╰───╯  │      │  Brake
│      │                                                ╰──╯           │      │
└──────┴──────────────────────────────────────────────────────────────┴──────┘
                                env(safe-area-inset-bottom)
```

| Control | Drawn size (CSS px, *tune*) | Centre | Acts |
|---|---|---|---|
| Stick | ring radius 56, knob radius 22; knob travel R = 48 | appears under the thumb anywhere in the stick zone: the left 45% of the width, below the top 64 px | while held: points the way (4.2) |
| Boost | roundel, radius 36 | 48 px in from the right and the bottom | while held |
| Brake | roundel, radius 28 | 140 px in from the right, 34 px up from the bottom | while held |
| Land | roundel, radius 36, with the existing `LandPrompt` card beside it naming the landmark | 56 px in from the right, 140 px up from the bottom | on release (sliding off cancels); present only while a landmark is in reach |
| Pause | seal, 44×44 | the top-left corner of the usable rectangle | on release |

- **Worked example.** On an iPhone 17 in landscape Safari (874×338 visible), the usable rectangle runs from x 78 to
  796 and y 16 to 302. Boost sits at (748, 254), Brake at (656, 268) and Land at (740, 162). With the tab bar
  (292 visible), every bottom-anchored control moves up 46 px and Land's top edge is at y 80.
- **Hit areas** are 8 px larger than the drawn shapes. The smallest control, Brake at 56 px, clears Apple's 44 pt
  minimum. The Xbox Accessibility Guidelines ask for about 15 mm on phones, which the size setting reaches.
- **The size setting:** 80, 100, 125 and 150%. At every size and on every device in the test table (section 9), the
  layout keeps every control inside the usable rectangle with no overlaps.
- **The stick at rest.** It shows as a faint ghost at its rest spot (72 px in from the left and bottom of the usable
  rectangle) until the guide is done. Afterwards it is hidden until touched, as Apple advises. The whole stick zone
  works, so no spot needs remembering.
- **When the controls show.** While touch was the last input (section 6). They fade out over 250 ms after a key or
  gamepad press and come back on the next touch.
- **Landed.** The controls hide while the Codex is open; it has its own Take off button.

### 4.2 Steering: the stick points where to fly

**[Owner] decision 3: how the stick steers.**
- **Point (recommended).** The stick says where to fly on screen. The dragon turns toward that heading at its normal
  turn rate, and flies straight when the stick is let go. It suits the unrotated overhead camera. slither.io, the
  closest web cousin (an overhead serpent), offers it.
- **Turn.** The stick's x is the keys' left and right; up boosts, down brakes. One model with the keys, but tank
  steering whenever the dragon flies down the screen.
- **Both,** as a setting, with Point the default.

Point steering is one pure function. The flight model's shape does not change.

```
desired = atan2(stick.y / 0.8, stick.x)      // screen y is 0.8 of world y (screenY = 0.8·y − alt)
error   = wrapToPi(desired − heading)
if |error| > 170°: error = sign(lastTurn or +1) · |error|    // a 180° flick keeps turning one way
turn    = |stick| < deadZone ? 0 : clamp(error / 0.5, −1, 1)
```

- **The input type.** `FlightInput.turn` widens from −1 | 0 | 1 to a number in [−1, 1]. Keys still send −1, 0 or 1,
  and the landing branch's `advance()` passes it through.
- **Stability.** With bank easing at 6/s and heading turning at 1.6 rad/s per unit of bank, a gain of 1/0.5 rad gives
  a damping ratio of about 0.7. The dragon settles on the pointed heading without wobble; a unit test pins it.
- **The stick's feel (*tune*).**
  - A radial dead zone of 12% of R, rescaled so the output starts at 0 at its edge.
  - Past R, the base follows the thumb, so hard steering never sticks at the rim.
  - On release the knob springs back. These are nipplejs's conventions.
  - Smoothing belongs to the dragon's bank easing, not to the stick.
- **Speed.** Boost and Brake are held, as the keys are. Two settings (4.7) give alternatives to holding, as the
  accessibility guidelines ask:
  - **Boost toggles:** one tap on, one tap off.
  - **One thumb:** pushing the stick past 0.9 for 0.2 s boosts. Apple's touch-controls example sprints past 0.8.
    It is off by default, so a hard turn never surprises anyone with speed.
- **Gamepad.** The left stick steers by Point, the right trigger boosts and the left trigger brakes.

### 4.3 Pointer handling

- **One surface.** The game layer is a single surface with `touch-action: none`. It hit-tests each pointer itself from
  `pointerdown`, `pointermove`, `pointerup`, `pointercancel` and `lostpointercapture`. Per-element listeners would
  fight touch's implicit capture, and slide-on needs one surface.
- **Ownership at `pointerdown`.** On a button's hit area, the pointer belongs to that button. Otherwise, in the stick
  zone with the stick free, it takes the stick. Anything else is ignored.
- **Slide-on.** A button pointer that moves onto another button switches to it, so a thumb rolls from Brake to
  Boost. A stick pointer never becomes a button.
- **Release.** `pointerup`, `pointercancel` and `lostpointercapture` each release a pointer. Pausing, `blur` and the
  page going hidden release all of them, because a suspended page never hears `pointerup`.
- **Never filter on `isPrimary`.** The second finger never is primary.
- **DOM controls are left to the DOM.** The Land card, the Codex and the sheets are skipped via
  `target.closest("button, a, dialog")`. Cancelling `touchstart` would otherwise swallow their clicks.
- **The core is pure.** The state machine in `src/world/input/touch.ts` has no DOM and is tested in Node.

### 4.4 The look: drawn in the frame's pixels

**[Owner] decision 5: where the controls are drawn** (only under "fill the screen" in decision 2).
- **In the frame (recommended).** The renderer draws them into the frame buffer after the sky's "above" pass.
  - Same hard pixels as the land, at any device-pixel ratio.
  - One small draw per frame.
  - Pinned by golden hashes in `npm test`.
  - Text (the Land card, captions, sheets) stays in the DOM in IM Fell.
- **Over the frame.** SVG or CSS snapped to the frame's grid. Easier to restyle, but it blurs at fractional DPRs unless
  snapped with care, and it needs screenshot tests.

**The look is Fable's to draw and the owner's to judge on renders**, within these constraints:
- **Shapes:** cream paper roundels with an inked double ring (2 frame px outside, 1 inside) and an inked glyph.
- **Glyphs** show the action, never a controller letter (Apple's rule for touch):
  - » Boost, « Brake;
  - a pointed arch with a down-stroke for Land;
  - ‖ in a small seal for Pause;
  - the site's quatrefoil as the stick's knob.

  Gothic ornament only.
- **Pressed:** a vermilion wash with a cream glyph. The outer ring reddens and thickens by a frame pixel, so the press
  shows around the thumb, as Apple asks for presses under a finger.
- **Fading:** solid while touched. After 3 s untouched a control fades to a 55% wash, never below 40%. "Always solid"
  keeps it at 100%.
- **Line weight:** never under one frame pixel; sizes come from the layout.

### 4.5 Vibration

Android Chrome only (`navigator.vibrate`, after the first tap). iPhone has no Vibration API. Libraries report that the
switch-control trick stopped working from scripts in iOS 26.5, so iPhone gets none.

**[Owner] decision 6: vibration by default on Android.**
- **On (recommended).** Three light events only: 10 ms on pressing Boost, 25 ms on touching down at a landing, and two
  8 ms ticks for a discovery.
- **Off.**

A setting turns it off either way, as the Game Accessibility Guidelines ask.

### 4.6 Tilt steering, as an option

**[Owner] decision 7: tilt.**
- **An opt-in setting (recommended).**
- **Not built.**

How it works if built:
- **Turning it on.** Off by default. The setting's own tap calls `DeviceOrientationEvent.requestPermission()` on iOS;
  Android does not ask. If permission is refused, the setting stays off.
- **The wheel.** The steering angle is the direction of gravity in the screen's plane:
  `devicemotion.accelerationIncludingGravity`, rotated by `screen.orientation.angle`. Using gravity avoids Euler-angle
  flips when the phone is held upright. (*tune*)
  - Low-pass filtered with a 50–100 ms time constant.
  - Dead zone 4°, full turn at 25°.
  - Neutral is captured when tilt is switched on and at every resume.
  - Ignored while the phone lies flat (in-plane gravity under 3 m/s²).
- **What it drives.** A relative turn, like the keys. Boost and Brake stay buttons, and touching the stick overrides
  tilt.
- **WCAG 2.5.4 is met:** the stick always works, and tilt can be turned off.

### 4.7 Controls settings

The settings sit in the pause sheet under **Controls** and are kept in the shared `settings` record:
- Handedness, size, and Always solid;
- Boost toggles, and one-thumb boost;
- Vibration (Android), and tilt;
- Steering style, if decision 3 is "Both".

## 5. Locking the view, per platform

| | Fullscreen | Orientation | Visible area | Back gesture |
|---|---|---|---|---|
| **Android Chrome tab** | `requestFullscreen` on Take wing | `lock("landscape")` after fullscreen | whole screen | system Back first leaves fullscreen, which drops the lock → `fullscreenchange` → pause |
| **Android, installed** | same | same | whole screen | same |
| **iPhone Safari tab** | none (`fullscreenEnabled` undefined, measured) | none (`lock` undefined, measured) → rotate card | 874×338, or 874×292 with the tab bar (iPhone 17, measured) | the edge swipe was blocked by the recipe below in the Simulator; `pushState` catches it if it fires |
| **iPhone Home Screen app** | not needed | none → rotate card | 874×402, the whole screen (measured) | as in Safari |
| **iPad Safari** | `requestFullscreen` on Take wing | none; both orientations play | whole screen | as in Safari |
| **Desktop** | unchanged | n/a | unchanged | Esc as today |

**[Owner] decision 4: phone orientation.**
- **Landscape only, with the rotate card (recommended).** Two thumbs and a wide view, and the "locked" feel the
  owner asked for.
- **Both orientations.** Portrait would play one-thumbed with a control deck below the picture. The Xbox Accessibility
  Guidelines ask games to support both, for players whose phones are mounted. The layout function is orientation-free,
  so portrait can be added later.

**The rotate card (phones only).** It shows whenever the visible area is taller than wide. The flight pauses behind it.

```
┌──────────────────────────┐
│                          │
│        ▯  ↷  ▭           │   pixel glyph, still under reduced motion
│                          │
│  Turn your phone         │
│  sideways to fly on.     │
│                          │
│  Screen won't turn?      │   iPhone: Portrait Orientation Lock may be on
│  ✤ Play sideways anyway  │   the CSS-turned fallback below
│  ✤ Leave the realm       │
└──────────────────────────┘
```

- **Coming back to landscape [Call].** The card offers **Fly on**, so the player re-grips before the dragon moves.
- **"Play sideways anyway" [Call].** When the iPhone's own Portrait Orientation Lock is on, the page never turns and a
  rotate card would trap the visitor. Android with auto-rotate off may be the same; no source says. This fallback
  turns the game layer 90° with a CSS transform inside the portrait viewport, and the visitor turns the phone.
  - The layout function and the touch surface work in the turned layer's coordinates.
  - Safe-area insets are mapped across.
  - One pure adapter remaps pointer coordinates, and it is unit-tested.
  - A second tap, **Other way round**, flips the layer 180°.
  - Safari's toolbar and the home indicator stay where portrait puts them.

**The lock recipe, on `/world` only.** Other pages stay zoomable.
- **Scope.** The lock is applied as a class on `<html>` while the flight is mounted, and its listeners are removed on
  unmount. The App Router keeps `<html>`, `<body>` and `document` alive across client navigations, so a leak would lock
  zoom on `/recruiter`; a test guards it.
- **CSS.**
  - On html and body: `height: 100%; overflow: hidden; overscroll-behavior: none; user-select: none;
    -webkit-user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent`.
  - On the game layer: `position: fixed; inset: 0; touch-action: none`.
- **Script.**
  - A non-passive `touchstart` on the game layer calls `preventDefault()`, except on DOM buttons, links and dialogs.
    WebKit's engineers confirm this stops the long-press loupe. In the Simulator it also stopped Safari's edge back
    swipe. Pointer events still arrive.
  - `gesturestart`, `gesturechange` and `gestureend` (WebKit), `contextmenu` and `dblclick` are cancelled.
- **Measured in the iOS 26.5 Simulator.** With the recipe, pinch, double-tap, long-press, pull-down and the edge swipe
  all did nothing; on a plain page, pinch zoomed and the edge swipe went back. Confirm on a real iPhone.
- **Viewport meta [Call]: no `user-scalable=no`.** iOS ignores it, the recipe already stops zoom on the game layer,
  and it would cost Android users zoom on the Codex for nothing.
- **The Codex on a phone.**
  - It takes `touch-action: pan-y`, so it scrolls but never pinches.
  - Its type is at least 17 px, since it cannot be zoomed. All it says is also on `/recruiter`, which zooms
    normally.
  - Its height comes from the measured visible height (a `--vvh` property set from `visualViewport`), not from `vh`.
    In landscape Safari `86vh` is 346 px, more than the 338 or 292 px actually visible.
- **Sizing.**
  - The visible area comes from `visualViewport`, never `100vh`. It is re-measured on `visualViewport` `resize`, two
    frames after an orientation change, and on every resume. iOS 26's toolbar has open viewport bugs (WebKit 297779),
    so nothing assumes its height.
  - The controls stay inside the usable rectangle. The land itself fills under the notch and the home indicator,
    which is harmless.

**Back, leaving and full screen.**
- **Back.** Entering flight pushes a history entry. A `popstate` while flying opens the pause sheet and pushes again;
  **Leave the realm** goes to `/`.
- **CloseWatcher** (Chrome 126+) closes the pause sheet and the Codex on Android's back gesture, where it exists.
- **Losing fullscreen** on Android (`fullscreenchange`) pauses the flight, and the sheet offers **Back to full
  screen**. Its tap requests fullscreen and the lock again.

**[Owner] decision 8: telling iPhone visitors about the Home Screen.** A Home Screen web app is the only way to the
whole 874×402 screen on an iPhone (measured), and iOS 26 opens any Home Screen site as a web app.
- **One line (recommended).** The pause sheet, on iPhone only, says "For the whole screen: Share → Add to Home Screen."
- **Nothing.**

Either way the site keeps its one manifest [Call]. iOS ignores a manifest's `orientation`, and Android gets fullscreen
and the lock in the tab, so a `/world`-scoped manifest would add little.

**Pausing.**
- **Triggers:**
  - `visibilitychange` to hidden, `pagehide` or `freeze`;
  - window `blur`: Safari's tab switcher fires only this, and no source says what Control Center or Notification
    Center fire, so `blur` is the safe catch;
  - a gap of more than 250 ms between frames (a silent stall);
  - a phone held upright;
  - leaving fullscreen on Android;
  - a `popstate`;
  - the pause seal.
- **While paused:**
  - the flight stops stepping and one dimmed frame stays up;
  - the bake queue takes no new wants, and finished chunks are kept;
  - audio is suspended and the wake lock released.
- **Resuming** is always a tap on **Fly on**. On Android it re-requests fullscreen and the lock if lost. It also
  re-requests the wake lock and resumes audio.
- **Hidden for more than 60 s on a phone [Call].** The workers are told to drop their tile caches, and the chunk cache
  shrinks to the chunks under the view. The pool itself stays: a WebKit report says terminated workers may not free
  their memory (unconfirmed), and respawning costs a boot. If trimming proves not enough on a device, terminate.
- **After a memory kill.** sessionStorage keeps the dragon's position every few seconds, so when iOS reloads the tab
  after killing it, the next flight starts where the visitor was.
- **The wake lock** is held while flying, since a visitor may let go and watch the dragon fly straight. It is
  re-requested on resume, because it lapses whenever the page is hidden.

**The pause sheet** is Ink & Glyph paper, in the DOM.

```
┌───────────────────────────────┐
│ ¶ Paused                       │
│   ╔═════════════╗              │
│   ║   Fly on    ║              │
│   ╚═════════════╝              │
│   ✤ How to fly                 │   the controls card; replays the guide
│   ✤ Controls                   │   4.7
│   ✤ Sound  off                 │
│   ✤ Leave the realm            │   to the title
│   For the whole screen:        │   iPhone only, if decision 8 says so
│   Share → Add to Home Screen   │
└───────────────────────────────┘
```

## 6. Which input is in use

`src/world/input/hub.ts` merges keys, touch, tilt and gamepad into one `FlightInput` and keeps the **last device
used**:
- a `keydown` → keys;
- a `pointerdown` with `pointerType` touch or pen → touch;
- a gamepad button, or a stick past 0.5 → pad.

The on-screen controls and every prompt follow that device. Nothing is decided from `maxTouchPoints` or
`ontouchstart`; CrazyGames warns against both, since many laptops have touchscreens. Mouse movement changes nothing,
because the mouse does not fly. Before the first input, `(pointer: coarse)` gives the first guess.

## 7. Teaching the controls, shared with desktop

| Action | Keys | Touch | Gamepad |
|---|---|---|---|
| Steer | ← → or A D | the stick, left thumb | left stick |
| Speed up | ↑, W or Shift (hold) | » (hold) | right trigger |
| Slow down | ↓ or S (hold) | « (hold) | left trigger |
| Land | Space or Enter | ⌂ | lower face button |
| Take off | Space, Enter or Esc | Take off | lower or right face button |
| Pause or leave | Esc | ‖ seal | Start / Options |

**Keys.** Keys are bound by position (`KeyboardEvent.code`), so WASD stays the four keys under the left hand on
AZERTY. Their labels come from `navigator.keyboard.getLayoutMap()` where Chrome offers it, and otherwise read as
QWERTY.

**[Owner] decision 9: gamepad glyphs.**
- **Generic, by position (recommended).** A small pixel diagram of the four face buttons with one inked.
  `Gamepad.id` has no specified format, so a brand cannot be read reliably, and generic glyphs fit "no logos".
- **Brand-accurate.** Xbox letters and PlayStation shapes, where the pad can be identified.

**The guide: learning by doing.**

The evidence for the shape:
- George Fan's GDC 2012 rules: have the player do each thing once, show at most eight words, never pause play, and
  skip a tip for a player already doing it.
- A CHI 2012 study of 45,000 players found tutorials only paid off in complex games.

So the guide is three steps, during the opening flight upriver to the abbey:

1. **"Steer toward the abbey."** Touch shows a pixel ghost-thumb dragging at the stick's rest spot; keys show ← →;
   the pad shows its stick. Done after 1.5 s of steering.
2. **"Hold » to speed up."** Done after 1 s of boost.
3. **At the abbey: "Tap ⌂ to land."** The Land control pulses; done on landing. The Codex's Take off button needs no
   lesson.

How the steps behave:
- **Placement.** Each step is a small paper card beside the control it teaches (touch), or at the bottom centre (keys,
  pad).
- **Brake** has no step. It is on the controls card, under **How to fly** in the pause sheet, which also replays the
  guide.
- **Skip** is always there. Completion is kept in localStorage `guide`, shared by desktop and phone.
- **Reduced motion** shows the still glyph, without the ghost-thumb animation. Nothing shows ghost thumbs work better
  than still glyphs [Call].
- **On desktop** the guide replaces today's fixed hint line. Afterwards prompts appear only when they matter, such as
  the Land prompt near a landmark.

## 8. Phone performance settings

| Setting | Desktop today | Phones | Why |
|---|---|---|---|
| Frame | 400×225, letterboxed | fills the screen within 110,000 px (section 3) | about desktop's pixel count, no bars |
| Frame rate | the display's | capped at 60. Drops to 30 when the 90th-percentile frame over 2 s passes 12 ms, or when rAF itself runs near 30 Hz (iOS Low Power Mode). Back to 60 after 10 s under 8 ms (*tune*) | Safari on ProMotion gives 60 anyway; 90/120 Hz Android panels would burn power. No web API reports heat on phones, so frame time is the only signal. A 30 fps cap skips callbacks by timestamp, which divides evenly into 60, 90 and 120 Hz |
| Bake workers | `clamp(hc − 1, 1, 4)` | 2, or 1 where `deviceMemory` ≤ 2 (Android) | WebKit's source reports 4 cores on every iPhone, so today's rule would spawn 3 × 30–50 MB. Worker heaps count against the tab's one process limit (about 1.5 GB soft on iPhone, lower on small-RAM models) |
| Chunk cache | 32 chunks (8.4 MB) | 32; trimmed when hidden | small next to the workers |
| Memory | not counted | the game counts its own bytes (workers, cache, frame) and stays under about 300 MB (*tune*) | iOS has no memory API, and a tab over its limit is reloaded, sometimes in a loop |
| Audio | bells on the title | unlocked by the Take wing tap; ambient session, so the silent switch mutes it as visitors expect | `playback` would also stop the visitor's music |
| Download | loads on arrival | the same, with the size on the card | Save-Data exists only in Chrome; a stated size works everywhere |

- **Fixed timestep: not needed.** The flight step already copes with any frame rate: it eases with `min(1, k·dt)`
  and caps dt at 0.1 s.
- **Two things to measure on an iPhone in phase 8.** First, `putImageData` on an accelerated canvas forces a GPU
  readback in Safari. Measure it against an unaccelerated context (`willReadFrequently: true`, where Safari honours it) before anything
  else.
  Second, the phone perf gate: `world-fly` gets a phone profile (4× and 6× CPU throttle, a phone frame, 2 workers).
  It must hold p95 ≤ 8 ms at 4× and have the start view ready in ≤ 3 s at 4× (*tune*).

## 9. Test plan

The owner asked for a whole suite. It runs in five layers, cheapest first; only the last two need a person or the
Simulator.

**1. Unit tests (`npm test`, Node, pure modules).**

| Module | What the tests pin |
|---|---|
| `input/stick.ts` | radial dead zone rescaled from 0; output ≤ 1; continuous at the dead-zone edge; base follows past R; release springs back |
| `input/steer.ts` | for 16 start headings × 8 stick directions, the flight model settles within 3° in under 1.5 s with under 10° overshoot; a 180° flick turns one way without dithering; the 0.8 foreshortening; no turn inside the dead zone |
| `input/touch.ts` | the stick and Boost held at once; Brake → Boost slide-on; a third finger ignored; `pointercancel`, `lostpointercapture`, `blur` and hidden each release; a stick pointer never becomes a button; DOM targets skipped; Land fires on release and not after sliding off |
| `input/hub.ts` | keys, touch, tilt and pad merge into one `FlightInput`; the last device wins; every action has a prompt for every device |
| `mobile/frame.ts` | over a table of measured and published sizes (iPhone 17 Safari one tab and tab bar, Home Screen app, 17 Pro Max, 17e, Air; Pixel 7; 360×800 Android; iPad 11"), both orientations: whole device pixels, within budget, fills the visible area, H between 160 and 240. Measured sizes are used, not Playwright's descriptors, which match no measured case |
| `mobile/layout.ts` | the same table × handedness × four sizes × iOS and Android edge budgets: every control in the usable rectangle, no overlaps, drawn sizes ≥ 44 px, Land above Boost, left-handed the exact mirror |
| `mobile/turned.ts` | the CSS-turned fallback: pointer remap at 90° and 270°, safe areas mapped, layout valid in the turned frame |
| `mobile/lifecycle.ts` | every pause trigger pauses, including a 250 ms stall; only Fly on resumes; all pointers released on pause; the hidden trim after 60 s; the wake lock follows flying; the saved position round-trips |
| `mobile/tilt.ts` | the gravity-to-wheel angle at orientation angles 0, 90, 180 and 270; the filter; the dead zone; the flat-phone guard; calibration |
| `mobile/perf.ts` | the 60 → 30 → 60 ladder and its hysteresis; the worker count from platform, `hardwareConcurrency` and `deviceMemory` |
| `mobile/guide.ts` | step order; done-already steps skipped; Skip; replay; persistence; garbage in storage reads as "not seen" |
| title `PhoneTitle` | entries come from `copy.ts`; the Recruiter comes first; the CSS and JS phone queries agree (the title-menu test, extended) |

**2. Pixel goldens (`npm test`).** The controls are drawn into a blank frame at three scales, in these states: idle,
the stick to the north-east, Boost pressed, Land offered, left-handed, and 150% size. The SHA-256 of each RGBA buffer
is checked against a committed golden, as the water tests do. `npm run world:controls` writes the same states as a
contact sheet PNG, for Claude and the owner to judge by eye.

**3. Browser flows (Puppeteer, new `npm run test:mobile`, serving `out/` like `world-fly`).** Puppeteer is already a
dependency and has real multi-touch since 23.7, which the research probes confirmed on the repository's install.
Playwright would add WebKit and Firefox engines, not better touch, so it is not needed.

The setup is phone emulation (Pixel 7 and iPhone-sized profiles with the measured sizes: viewport, DPR, `isMobile`,
`hasTouch`), with notch insets from CDP `Emulation.setSafeAreaInsetsOverride`. Then:
- **Two fingers.** With two touch handles at once (the stick held north-east, Boost held), `window.__flight` shows
  the heading converging and the speed rising. Releasing flies straight. A CDP `touchCancel` releases both.
- **Rotation.** Portrait shows the rotate card and stops flight time. Landscape, then **Fly on**, resumes. **Play
  sideways anyway** turns the layer, and a turned touch still steers.
- **No zoom or scroll.** Under `Input.synthesizePinchGesture` and a two-finger drag, `visualViewport.scale` stays 1
  and `scrollY` stays 0.
- **No leaked lock.** After a client-side navigation from `/world` to `/recruiter`, the lock class and its listeners
  are gone, and a pinch there zooms.
- **Back and visibility.** `history.back()` while flying opens the pause sheet and stays on `/world`. Bringing a second
  tab to the front pauses the flight. The hidden trim runs after its timeout, shortened by a test hook.
- **Landing.** With `?at=<site>`, a tap on Land lands the dragon, and Take off flies on.
- **The card.** Before you fly appears on a phone profile and not on desktop, and Take wing starts the flight.
- **Prompts.** A faked `navigator.getGamepads()` switches the prompts to pad glyphs, and a key press switches them to
  keys.
- **Accessibility.** `npm run a11y -- / /world` at 375×667 and 667×375: the phone title and the cards pass axe.
- **Screenshots.** The phone title, the cards and the pause sheet are saved for review but not gated. IM Fell's
  rendering differs between machines.

**4. iOS Simulator pass, before each merge that touches mobile.** An agent with the Simulator tool runs it on the iPhone
17, the iPhone 17e and the iPad Air, repeating the research probe against the real page:
- **Safari:** portrait shows the rotate card. Landscape keeps the controls inside the safe area, both with one tab and
  with the tab bar. Pinch, double-tap, long-press, pull-down and the edge swipe do nothing.
- **Home Screen app:** the frame fills 874×402.
- **Evidence:** screenshots go to the session's notes. Nothing measures iOS 27 until a 27 runtime is installed.

**5. Real phones (the owner, about ten minutes a phone).**
- **Feel:** stick size and dead zone, button reach, accidental presses.
- **Endurance:** ten minutes of flight, watching for heat, the 30 fps step-down, and any tab reload.
- **Sound:** with the silent switch on and off.
- **Vibration:** on Android.
- **Tilt:** the permission prompt, and whether the grant is remembered.
- **Interruptions:** app switching, the lock screen, Control Center.
- **Orientation:** Portrait Orientation Lock on, then the fallback.
- **The edge swipe:** is it really blocked?

**[Owner] decision 10: which real phones.** Recommended: the owner's own iPhone and one Android phone. For more
Android models, BrowserStack's free open-source plan is an option; it needs an account, which the owner creates.

## 10. Build order and who builds

Following CLAUDE.md's "Who builds":
- **Cursor** builds plumbing and test-pinned mechanics.
- **Fable** draws anything judged by eye.
- **Claude** writes the briefs and tests, and judges the results.

Each phase is a `world/<topic>` branch off `feat/dragon-world`.

| # | Branch | What | Builder | Needs |
|---|---|---|---|---|
| 1 | `world/input-hub` | `turn` as a number; the hub, stick, steer and touch state machine; the prompts table. Desktop unchanged | Cursor | — |
| 2 | `world/phone-shell` | Before you fly, Take wing, the rotate card and the turned fallback, the lock recipe, sizing, the phone frame and `view.resize`, the pause sheet, history Back, the lifecycle, the wake lock | Cursor | 1; landing-codex merged |
| 3 | `world/touch-controls` | layout; controls drawn in the frame (placeholder art); Land placement; the Codex on phones (`--vvh`, `pan-y`, type size); goldens | Cursor | 2 |
| 4 | `world/controls-art` | the control sprites, the phone-turning glyph, the pause seal, the ghost thumb; contact sheets | Fable | 3 |
| 5 | `world/phone-title` | mockups (the owner picks), then `PhoneTitle` | Fable, then Cursor | the desktop title merged |
| 6 | `world/teach` | the guide, device-aware prompts on desktop and phone, gamepad | Cursor (logic), Fable (cards) | 1, 3 |
| 7 | `world/phone-options` | handedness, size, solid, Boost toggles, one thumb, vibration, tilt | Cursor | 3 |
| 8 | `world/phone-perf` | the frame-rate ladder, worker count, hidden trim, memory count, `putImageData` check, phone perf gate, Simulator pass | Cursor; Claude runs the Simulator | 2 |

## 11. Decisions (settled 2026-11-18)

The owner took every recommended answer. The phones in decision 10 are still to be named.

| # | Decision | Chosen | Not chosen |
|---|---|---|---|
| 1 | Front door on a phone | a phone title with the Recruiter first | straight to `/recruiter`; or Recruiter first until the visitor has flown |
| 2 | The picture on a phone | fill the screen, controls over the corners | keep 16:9 with the controls in paper margins |
| 3 | How the stick steers | point where to fly | turn left/right like the keys; or both as a setting |
| 4 | Phone orientation | landscape only, with the rotate card | portrait too |
| 5 | Where the controls are drawn | in the frame's pixels | SVG over the frame |
| 6 | Vibration on Android | on, three light events | off by default |
| 7 | Tilt steering | an opt-in setting | not built |
| 8 | iPhone Home Screen hint | one line in the pause sheet | nothing |
| 9 | Gamepad glyphs | generic, by position | brand-accurate |
| 10 | Real-phone testing | the owner's iPhone and one Android phone | plus BrowserStack's free plan |
| 11 | The terminal at the abbey on a phone | from the Codex, open `/artificer#terminal` in portrait (a phone keyboard in landscape leaves about 150 px of screen) | keep it in the flight |
| 12 | The phone title's look | pick from Fable's mockups (phase 5) | — |

## 12. Risks and unknowns

The research doc lists every unverified finding; these are the ones that bite here:
- **The edge-swipe block** held in the Simulator, but community reports call it unreliable on devices. If it fails on
  a real iPhone, `pushState` turns the swipe into a pause, not an exit.
- **Portrait Orientation Lock (iPhone) and auto-rotate off (Android)** would trap a visitor behind the rotate card.
  The turned fallback is the answer, and it is the least proven part of this design.
- **iOS 26's toolbar** has open viewport bugs (WebKit 297779). Re-measuring from `visualViewport` on every resume is
  the defence, and the Simulator pass checks it.
- **Android's back-gesture strip** varies by device (24–30 dp in AOSP) and cannot be switched off from a page. The
  32 px edge budget may be too little on some phones (*tune*).
- **Heat** can only be inferred from frame times, so the ladder's thresholds need a real ten-minute flight.
- **iOS memory limits** are unpublished (around 1.5 GB soft per an Apple engineer, much lower under pressure). The
  300 MB budget and the trim-not-terminate choice need a long flight on the smallest iPhone the owner can borrow.
- **`putImageData` on iOS** may force a GPU readback each frame, and is unmeasured on phones.
- **iOS 27** shipped in September 2026, and the Simulator runtime here is 26.5, so iOS 27 Safari is unmeasured.

## As built (2026-11-19)

Built on `claude/mobile-research-9125c0`, on top of `world/bigmap` (the controls guide, landing and the Codex). Where
the build departs from the sections above:

- **The frame (§3).** The shared canvas fitting is left to the edge-sprites session's fill-the-window work; the phone's
  needs were passed on (size from `visualViewport`, whole device pixels per frame pixel, about 110,000 frame pixels at
  most, the size held steady mid-flight). The touch controls are laid out inside the frame's on-screen rectangle, so
  they work over today's letterboxed 400×225 and over a filled frame alike.
- **The controls (§4).** As designed, numbers as in §4.1. Boost and Brake carry up and down chevrons, the shared glyph
  set's own touch buttons, so the lesson's small glyphs match the big ones. Land is in the cluster, and the guide's
  prompt by the dragon still lands on a tap too. The stick shows as a faint ghost until the first-flight lesson is
  learned, then only under the thumb.
- **The pause sheet (§5).** The options panel is the pause sheet on a touch screen: the corner's options plate opens
  it, it holds the flight while open, and its Close reads "fly on". Interruptions show a small Paused card (Fly on,
  options, leave). The phone's settings (hand, size, fade, one thumb, vibration, tilt) are a "touch" section of the
  same panel, in place of the keys.
- **The lesson (§7).** The shared lesson's stages are kept and drawn in touch glyphs: the stick, then the two speed
  buttons, then the options plate ("pause · leave"). The land prompt teaches landing, as on a desktop.
- **Not built.** Trimming the workers' caches after a minute hidden (§5) needs a new worker message; phones already run
  two workers, so it waits for a long-flight measurement on a real iPhone. Audio unlock on Take wing waits for the
  world to have sound.
- **The phone title (§2).** Built in `src/components/title/phone/` (`PhoneTitle`, its own `copy.ts`) and mounted on
  `/` for phones only. `PhoneSwitch` in `src/app/page.tsx` is one wrapper with a component each side. The title's
  phone query (`phone.ts`, held to the CSS by a test) shows the phone title. The home page sits in a
  `display: contents` box, so desktops lay out exactly as before. The hidden side is `display: none`, out of the
  accessibility tree. The noindex route `/phone-title` stays as the bench Fable judged it on.
- **Merging the title later.** The desktop title (the parked title-menu work) replaces the desktop side of the switch
  alone. Its `copy.ts` and `title/phone/copy.ts` name the same four ways in, so the two should become one list
  then.
- **Links into other branches.** "Read the short version" goes to `/recruiter` (on `feat/dragon-world`), and on a phone
  the abbey's terminal opens `/artificer#terminal`, which exists only once the title-menu work lands.

Tests, as §9 asks:
- **Unit, `npm test`.** `controls/{stick,steer,touch,options-touch,guides}`; `mobile/{layout,turned,lifecycle,perf,tilt,art}`.
  The steering test flies the real flight model from 16 headings toward 8 directions. The art test pins the controls'
  pixels by hashing twelve scenes.
- **Browser, `npm run test:mobile`.** Fourteen flows in phone emulation with real multi-touch: the gate, two fingers,
  touch cancel, upright and level, played sideways, no zoom or scroll, Back, hidden and blur, landing, Android
  fullscreen and lock, an iPhone asking for neither, the lock lifting on leaving, and a desktop unchanged.
- **Renders.** `npm run world:controls` draws the controls over the world. `scripts/world-mobile-shots.mjs` takes the
  phone screenshots. `scripts/title-phone-shots.mjs` shoots the front door on phones and desktops.
- **Frame budget.** `node scripts/world-fly.mjs` runs on desktop. Against the base build in alternating runs, 4×
  throttle p50 was 2.5–2.7 ms and p95 3.8–3.9 ms, against 2.6–2.8 and 4.0. `--phone` flies by touch as an iPhone 17
  in landscape. At 4×, phones hold 60 fps with p50 3.6 ms and p95 4.8 ms; the controls and guide take 0.8 ms p95.
  The phone gate is 8 ms.
- **Desktop unchanged.** At 700, 1280 and 1600 px every element of `/` has the same box as in the base build, and the
  phone title is not in the accessibility tree. axe on `/`: the phone side passes in light and dark, where the base
  build failed. The desktop side keeps the base build's two findings (`.kbd` contrast, no `h1`), left alone so
  desktops get exactly today's page.
- **Real WebKit.** In the iOS 26.5 Simulator (iPhone 17, Safari), checked by hand:
  - the phone title opens on `/`, and the Wayfarer card leads to Before you fly;
  - Take wing while upright shows the turn card, and turning to landscape shows Paused, with the Home Screen hint;
  - after Fly on, a drag on the stick steers to the abbey, where Land joins the cluster;
  - a pinch and a long-press do nothing, and the lesson moves on to the touch speed glyphs.
