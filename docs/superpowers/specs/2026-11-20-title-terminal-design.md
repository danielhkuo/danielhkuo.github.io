# The title: the site's terminal over the world

Approved by the owner on 2026-11-20 ("Yes, build it"), from the round-7 mock, variant D
(https://claude.ai/artifact/FrpYNHsrR6ep7Y6mtZFcxu). The plan is `plans/2026-11-20-title-terminal.md`.

## What the visitor sees

`/` is a title screen and nothing else: nothing scrolls below it.

1. **Blank paper.** A new tab opens on the paper alone. The terminal's own intro plays as it always has: a cursor, the
   window opening out of it, `neofetch` typed, the bio printed.
2. **`./world`.** The terminal then runs `./world` and prints two lines: "A world to fly over." and "Press ⏎ or choose
   Enter world." The words live in `src/components/terminal/content.ts` (`WORLD_COMMAND`, `WORLD_LINES`), so they
   change in one place.
3. **The world arrives.** Behind the window, the live world comes in pixel by pixel from the dragon outward, at the
   world's own pixel grid, with an 8×8 ordered-dither edge, over 2.8 s. Each pixel switches from paper to world in one
   step: nothing fades. It starts when both the intro is over and the world's first full view is drawn.
4. **The ways in.** Under the window: **Enter world** (with a ⏎ key cap), and below it a row of three small links:
   **Minimal version**, **agents.md**, **Settings**.

The world behind is live (clouds, water, birds, light) but held: the dragon waits in place with its body laid out
behind it, low in the frame (80% of the way down), under the window. No guide, caption, lesson, corner or sound toggle
is drawn while it is held, and no key reaches it.

## The ways in

| Way in | What happens |
|---|---|
| ⏎, the Enter world button, the yellow light | The window minimizes into the bottom of the screen with a macOS genie; the dragon sets off at once and the camera eases back onto it. The address becomes `/world` (`history.pushState`), in place. |
| Back, Esc in flight, the Leave links | The genie runs backwards out of the bottom of the screen into the window; the dragon glides to a stop and the camera eases down again. The address is `/` again. |
| Minimal version, the green light | The window grows to fill the screen, keeping its font and colours, and lands on `/minimal` (nano viewing `daniel.txt`). ^X or Esc there comes back to `/`. |
| agents.md | The agent file. |
| Settings | The world's options panel. |
| A click on the window's body | The live shell, as before. The corner terminal button is gone. |

Shift held as the genie starts plays it ten times slower, as on a Mac. Any key during the opening skips it: the world
then shows as soon as it is ready. Under reduced motion there is no intro, no genie and no grow: everything cuts.

A phone gets its own title (`src/components/title/phone/`), with the minimal version first and preselected, through
`PhoneSwitch`. A phone never loads the world from `/`.

## How it is built

- **The hold** (`src/world/runtime/hold.ts`, wired through `session.ts`, `controls.ts`, `useFlight.ts`, `Flight.tsx`):
  `FlightSetup.held()` read each frame; held, the flight is asked for nothing (`HELD_INPUT`, pace 0), a speed under
  `HOLD_STOP` is stopped outright, and `holdCamera` shifts the camera by an eased share (`easeHold`, 1.25 s) so the head
  sits `HOLD_LOW` of the frame's height below centre. Held from the start, the dragon starts at speed 0 as a
  `flownDragon`. `FlightSetup.leave()` and `FlightEvents.ready()` let the title take Esc and start the arrival.
- **The genie** (`src/components/title/genie.ts`, pure, frame-tested; `genieRun.ts`, DOM): the window cut into 40
  horizontal bands, each a clipped clone of the window mapped onto its piece of the funnel with a projective
  `matrix3d`. The bottom edge is drawn down into the neck first (to t = 0.42), then the rest flows through after it;
  the sides are S-curves from the window's top corners to the neck.
- **The arrival** (`src/components/title/arrival.ts`, pure, tested): a threshold per world pixel (distance from the
  dragon, plus the Bayer dither), and a paper mask drawn over the world at its own pixel size, alpha 0 or 255 only.
- **The title** (`src/components/title/Title.tsx`): one mode, `title` → `leaving` → `flying` → `returning` → `title`,
  shown as `data-title` for the tests. The terminal's launcher stays for the shell, without its corner button.

## Tests

`e2e/site/title.spec.ts` covers the opening, Esc, ⏎, the button, the lights, Back, Esc in flight, the shell keeping its
keys, the options, the links and a phone's own title. The motion (the opening, the arrival, the genie, the grow) is
judged on frame strips at 120 Hz and through a long idle, and audited by fresh critics before the owner sees it.
