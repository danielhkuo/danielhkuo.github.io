# Teaching the controls — design

2026-11-18. Branch `claude/unruffled-jones-c0c8ed`, built on `world/bigmap` with `claude/landing-codex-a05077`
merged in. The brief came from the coordinating session (owner's asks, roadmap "Ideas: mobile, controls and
wayfinding"). It was treated as the approval.

## Why

`/world` tells you how to fly in one line of grey text at the foot of the page, and only a keyboard can fly. The
owner wants clearer interactivity: simple guides in the pixel style, so a visitor knows when to steer, when to press
a button and which one, on whatever they hold. They also want no minimap.

## Goals

1. **A first-flight lesson.** Pixel key-caps drawn by the dragon light as they are pressed and fade once learned. The
   lesson is remembered in localStorage and can be shown again.
2. **Device-aware glyphs.** The guides show keyboard caps, gamepad glyphs once a pad is used (with gamepad steering,
   boost, slow, land and take-off), or touch glyphs on a touch screen. There is one glyph set, which the mobile work
   reuses.
3. **Contextual prompts by the dragon, not a HUD.** "Space · land" near a landmark, "Esc · pull up" while coming down,
   "Space · take off" when landed, and "Esc · leave". These replace the text line at the foot of the page.
4. **Options in a small pixel panel.** Hold or toggle boost, a slower cruise, reduced motion, key remapping, show the
   lesson again, and leave.

## Non-goals and anti-goals

- No minimap and no compass HUD. The guides appear only when they are useful, then go.
- No touch flight yet. The floating joystick and the boost and brake buttons are the mobile work's to build. This
  branch only draws their glyphs and makes a tap land and take off.
- No brand logos for gamepads. Face buttons are drawn by position: a diamond of four with the one to press filled.
  Triggers carry the pad's own label (LT/RT, L2/R2, ZL/ZR) when its id says which family it is.
- The guides must not cost the frame budget: 4× throttle p95 stays under 4 ms.

## Approaches considered

| | How | Trade-off |
|---|---|---|
| **A. Drawn into the frame** (chosen for guides) | Glyph sprites are blitted into the 400×225 buffer after the sky, beside the dragon's head | On the world's own pixel grid, so they are part of the world. They cost microseconds and are captured in canvas screenshots. They need a live region for screen readers and a hit test for taps. |
| B. DOM overlay | SVG pixel glyphs in positioned buttons over the canvas | Accessible and tappable for free, but per-frame DOM moves, sub-pixel drift off the world's grid, and it reads as a HUD layered on top |
| C. Plain text, restyled | The old hint line, in a pixel font | Least work, but still a HUD line at the foot of the page, which is what the owner asked to replace |

The guides take **A**. The options panel is real DOM, a modal `<dialog>` with native controls, drawn with the same
glyphs through an SVG renderer. So one glyph set has two renderers: the frame blit and SVG. The mobile work's
pixel-art touch controls can use either.

## Decisions

### The glyph set (`src/world/controls/`, pure TypeScript, tested under Node)

- **One pixel font, our own.** Caps and ascenders are 6 px, the x-height 4 px and descenders 2 px, so a line is 9 px.
  It covers printable ASCII (project names can be anything), plus `← → ↑ ↓ · ¶`. Lowercase reads friendlier and more
  like the storybook than all caps.
- **Key-caps** are inked outlines on a paper face with a 2 px darker skirt. Letters are uppercase (W A S D); named
  keys are lowercase, as on a Mac keyboard: `shift`, `space`, `esc`, `enter`. **Lit**: the face presses down 1 px
  and turns vermilion with a paper legend. **Dim**: drawn at reduced opacity for keys of a stage not yet reached.
- **Palette:** ink `#2e2a24`, paper `#f0e8d2`, skirt `#d8caa6`, vermilion `#cf3f2b`, gold `#d9a637`, the colours of
  the Codex sheet.
- **Labels** sit on paper slips: flat plates 2 px shorter than a cap, with a soft-inked rim and clipped corners. They
  read over sea, forest, cliffs and cloud, and beside a cap they read as its label, never as another key. A 1 px paper
  halo was tried first; the critic found it made a pale blob on sea and cloud. Only the "or" between two families of
  keys keeps the halo.
- **Gamepad glyphs:** the face diamond (south, east, west, north), the left stick with ↔, the d-pad, and the triggers
  and shoulders. **Touch glyphs:** a tapping finger, plus the joystick ring and the boost and brake buttons for the
  mobile work.
- **Sprites** are small palette-indexed bitmaps (`Sprite { w, h, px: Uint8Array }`). `blit` draws one into a frame at
  an opacity; `PixelGlyph` (React, SVG with `shape-rendering: crispEdges`) draws one into the DOM at the frame's
  pixel scale.

### Input (`bindings.ts`, `gamepad.ts`)

- **Actions:** left, right, boost, slow, land (also take off), back (pull up, take off, or leave), options.
- **Keyboard:** the primary keys can be remapped: A, D, W, S and Space by default. Arrows, Shift, Enter and Esc always
  work and cannot be rebound. A remap that takes another action's key swaps the two keys. Esc, Tab and the fixed keys
  cannot be taken.
- **Gamepad (standard mapping):** left stick x (dead zone 0.2, analog) or d-pad steers. RT or RB boosts, LT or LB
  slows (d-pad up and down too). South lands and takes off, east pulls up and takes off, View leaves while flying,
  and Menu opens the options. The pad is polled only while one is connected. `FlightInput.turn` widens from
  `-1 | 0 | 1` to a number in [-1, 1].
- **Device:** whichever was used last: a key press, a pad button or stick, or a touch. The page starts on touch when
  `(hover: none) and (pointer: coarse)` matches, and on keyboard otherwise.

### The lesson (`lesson.ts`)

- It starts one second after the first ready frame on a first visit (`world:lesson` not set).
- **Stage 1, steer:** `[A][D] or [←][→] steer`. It is learned once left and right have each been held for 0.35 s.
- **Stage 2, speed:** the inverted T with `boost`, `slow` and `[shift] boost`. It is learned after 0.6 s of boost and
  0.6 s of slow. Once the visitor has used only one family (arrows or letters), only that family is shown.
- **Stage 3, leave:** `[esc] leave` and `[O] options`, shown for 4 s.
- A stage that has shown for 20 s fades and moves on, so nobody is nagged. When the last stage ends, `world:lesson`
  is written.
- On a pad, stage 1 shows the stick and stage 2 the triggers.
- On touch, stage 1 is skipped until touch flight exists. A tap is taught by the land prompt itself.
- Caps light while held. A learned stage fades over 0.5 s; under reduced motion it goes at once.
- While a contextual prompt shows, the lesson steps aside. The two never stack.

### Contextual prompts (`guides.ts`)

| When | Keyboard | Gamepad | Touch |
|---|---|---|---|
| Flying, a landmark in reach | `[space] land · leaf` | `(south) land · leaf` | `(tap) land · leaf` |
| Coming down | `[esc] pull up` | `(east) pull up` | `(tap) pull up` |
| Landed | `[space] take off` | `(south) take off` | none: the Codex's Take off button |

- The name is the project's, "about me" at the abbey, or the landmark itself ("the windmill") when it keeps no work.
- **Landed:** the dragon offers to take off only on a wide screen with keys or a pad. On a touch screen the Codex's own
  button is the thing to tap, and over the narrow Codex (a bottom sheet) the prompt would be hidden. The Codex shows
  its own `Space` hint only where the dragon's prompt does not.
- **Placement.** A guide (prompt or lesson) stands 14 px from the dragon's head, in one of four slots: below, right,
  above or left. When it appears, the first slot in that order that the body leaves clear wins. The body's joints are
  counted under each slot, and leaving the frame costs heavily.
- **Holding still.** The head's place on screen is measured from the camera in whole pixels: the frame's centre plus
  the head's offset from the camera, rounded (`guideAnchor`). While flying the camera sits on the head, so a guide
  holds exactly the same pixels frame after frame. Coming down, the camera eases onto the landmark and the guide steps
  a whole pixel at a time.
- **The jitter this fixed.** The guide used to round the head's position against the view's floored origin. That
  flipped it a pixel whenever the head crossed half a cell: on 37–43 of every 47 frames at 60 and 120 Hz, whatever
  the window size (owner's report, 2026-11-19).
- **Changing slot.** A guide keeps its slot until the body has covered it for a second (`DWELL`), so a sway or a short
  turn passes under it, or at once if its slot would leave the frame. Then it glides to the new slot a whole pixel at
  a time, never back, and cuts there under reduced motion. Circling one way and then the other, it changed slot five
  times in eleven seconds of flight, and only that way.
- Over the narrow Codex (a bottom sheet) the order is above, right, left, below.
- A click or tap on a prompt's rectangle acts on it: the canvas hit-tests the rectangles the guides report each
  frame.
- A visually hidden `aria-live="polite"` line says the same thing in words, e.g. "Press Space to land at the
  lighthouse: leaf".
- **Esc · leave** is in the lesson's last stage. The canvas's top-right corner also holds `[esc] leave` and
  `[O] options` (the pad's View and Menu on a gamepad) for 4 s after load and for 4 s after each pointer move. On
  touch, the corner is a single plate that opens the options, where Leave is, and it stays shown.

### Options (`options.ts`, `OptionsPanel.tsx`)

- Kept in `world:options` as `{ boost: "hold" | "toggle", pace: "cruise" | "gentle", motion: "full" | "reduced",
  keys }`. Motion defaults to the OS setting.
- **Toggle boost:** a boost press flips it on and off. A slow, a landing, or a second press turns it off.
- **Gentle pace:** cruise × 0.6. `FlightInput` gains `pace`.
- **Reduced motion:** no boost streaks, a camera cut in place of the landing swoop, and no fades or pulses in the
  guides.
- **Opening it:** `O`, the pad's Menu, or the corner button. It is a modal `<dialog>`, so Esc closes it (the pad's
  Menu or east button too). While it is open the session ignores flight keys, and the dragon cruises on.
- **Glyph pixels** are a step finer than the world's pixel, 2 or 3 CSS px. The panel fills about half the window's
  height: 50% at 1600×900, 42% at 1280×720. Keys and actions are laid out two to a row. The keys section has a
  vermilion header over a dotted rule, as the Codex heads its register. A pilcrow stands before each action (soft at
  rest, vermilion on hover or focus), and focus is an ink ring with a paper gap.
- **Rows:** Boost (hold or toggle), Pace (cruise or gentle), Motion (full or reduced), the five keys, Show the
  lesson again, Leave the world, and Close.

### The flight page

- `Flight.tsx` was split first: `session.ts` holds the loop and is plain TypeScript; `useFlight`, `useFrameScale` and
  `useTerminalDrawer` are the hooks; the overlays are small components. React Doctor went from 81 to 100.
- The text hint line and the DOM land prompt are removed. Their jobs move to the drawn guides and the live region.

## Tests

- **Font:** every printable ASCII glyph exists, fits the metrics and has ink; widths are measured.
- **Glyphs:** cap sizes, lit and dim variants, and the gamepad and touch sprites.
- **Bindings:** defaults, remap with swap, refused keys, input from held keys, and toggle boost.
- **Gamepad:** a fake pad gives steering with the dead zone, boost and slow, and edges for land, back and options.
- **Lesson:** the stages advance on held time and on timeouts, reduce to one family, are stored, and reset.
- **Guides:** the right prompt for each phase and device, its layout clamped to the frame, and the announcement.
- **Frame budget:** `npm run build && node scripts/world-fly.mjs --port 4351`, with 4× p95 under 4 ms. The fly
  script runs a fresh profile, so the lesson is on the screen while it measures.

## Left for others

- Touch flight (the joystick and the boost and brake buttons) goes to the mobile work, using the touch glyphs here.
- Steering toward the pointer on desktop (roadmap) is not built.

## Critic rounds

A Fable critic judged the renders twice, scoring legibility, fit, placement, device glyphs, the panel and restraint.
Round 1 found eight fixes; three were blockers:

- the corner said `esc leave` while the prompt said `esc pull up`;
- the `O` cap read as a zero;
- the take-off prompt was hidden or doubled when landed.

All eight went in, as recorded above.

Round 2 scored 8, 8, 8, 7, 8, 8 and said ship. It asked for one more fix before release: same-height slips read as
pressable keys. They are now 2 px shorter and soft-rimmed. Two polish items also went in: a 2 px gap between a glyph
and its slip, and "land · take off" spanning the panel's width.
