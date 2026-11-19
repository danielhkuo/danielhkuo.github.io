# The WebKit pass (2026-11-19)

The end-to-end suite runs every journey that exists on `world/bigmap` in Chromium and in WebKit. WebKit is Playwright's
build of Safari's engine (Safari 26.6 in Playwright 1.63), the closest automated stand-in for Safari. Each engine runs
at a desktop size and on an emulated phone (Pixel 7, iPhone 17). This note covers what WebKit showed, what was fixed,
and what only a real Safari or iPhone can confirm.

## The suite

`npm run e2e` builds the static export and runs `e2e/` against `out/`, served as GitHub Pages would serve it
(`scripts/serve-out.mjs`). `npx playwright test` runs against an `out/` that is already built, and
`--project=webkit` runs one engine. Install the browsers once per machine with `npx playwright install chromium webkit`.

| Spec | What it checks |
|---|---|
| `world-open` | `/world` loads, and within a few seconds a whole second of frames passes with no haze. The canvas shows land (many colours, none covering half the frame). The frame covers the window from its top-left corner, at whole device pixels per frame pixel, overhanging by less than a frame pixel. Sizes checked: 1920×1080, 1440×900 and 2560×1080, and phones upright and turned. Nothing scrolls. |
| `flight` | Left and D turn the dragon, Up and S set its speed, and it crosses the world. The first-flight lesson steps through steering, speed and leaving, then fades and is stored. The options panel opens with O and the corner button, and closes with Esc and Close; each of its choices sits on one line. Esc leaves the world. |
| `landing` | `?at=<site>` shows "Press Space to land: …". Space opens the Codex, named for the project and set in IM Fell English, and Space takes off again. At the abbey, the arrow keys read down the Codex. The terminal runs `help`, the first Esc puts it away, and the second takes off. |
| `errors` | A garbled `current.json`, a missing manifest, or a `core.bin` that fails its checksum each show "The realm could not be loaded." with a link home. |
| `pages` | `/` in its fonts, with third parties stubbed. `/world-bench` with its workers ready. `/fish.json`, and the 404 page. |

Any console error or uncaught exception fails a test. The suite reads the world through `window.__flight`, which the
page sets with `?stats`. It gains two fields for the suite: `state()` (position, heading, speed and phase) and
`landmarks` (what each landmark holds). The light is held at noon in clear weather (`?time=noon&weather=clear`). The
run is 40 tests and takes about a minute after a 10-second build, two pages at a time (`E2E_WORKERS` changes that).

## What WebKit showed

### Fixed, with a regression test

1. **The options panel's labels sat above their choices.** Each choice row is a fieldset laid out as a flex row, and
   its legend was floated so that it would become an ordinary flex item. WebKit ignores the float on a flex
   container's child and keeps the legend as the fieldset's rendered legend, on a line of its own. So "boost", "pace"
   and "motion" sat above their plates, the panel was about 70 px taller, and the focus ring on the first plate cut
   into "boost". The legend is now positioned absolutely, which takes it out of the flow so it is never the rendered
   legend, and centred on its row (`options.module.css`). The panel is now identical in both engines: 684×453 at
   1280×800. `flight.spec.ts` checks that each label is centred on its plates and to their left. Without the fix,
   that check fails in WebKit by 30 px.
2. **The Codex's name split its first word.** The suite found this in both engines, so it is not a WebKit-only bug.
   The illuminated initial is an inline block, which splits the accessible name of the heading, and of the Codex it
   labels, into "E mpty-state-repo". Chrome's own accessibility tree reads the same. The title now carries the plain
   text as `aria-label` (`Codex.tsx`), and `landing.spec.ts` finds the Codex by its exact name.

### Differences that are not bugs

- **Keyboard scrolling eases in over several frames in WebKit.** Automation releases a key in the same frame it
  pressed it, and in WebKit that scrolls nothing; a held key scrolls. In Chromium the same tap scrolls 40 px. The
  suite holds the arrow for 400 ms. A person's tap should last long enough, but this is on the list below.
- **`performance.now()` ticks in whole milliseconds in WebKit**, since the page has no cross-origin isolation. So
  `__flight.frameMs` reads 1.00 or 2.00 there, and frame timings from Safari are coarse. A frame costs about 1 ms in
  both engines, at desktop and phone sizes.
- **`navigator.hardwareConcurrency` is 8 in WebKit on this Mac**, against 18 in Chromium. Desktop Safari still gets
  the full pool of four workers. An iPhone reports 4 and gets three (see the mobile research).
- **Phone emulation.** WebKit's iPhone matches `(hover: none) and (pointer: coarse)`, but reports `maxTouchPoints` as
  0, and Playwright gives mobile WebKit no mouse wheel.
- **Wrapping.** A few lines wrap at a different word, because the font metrics differ slightly. No layout differs.

### The same in both engines

- **Workers.** Turbopack turns `new Worker(new URL(…), { type: "module" })` into a classic worker that loads its
  chunks from a `blob:` URL. It starts and bakes in WebKit, on `/world` and on `/world-bench`.
- **Decoding.** `DecompressionStream("deflate-raw")` and `crypto.subtle` both work: the core and the regions decode
  and pass their checksums.
- **Fonts.** IM Fell English in the Codex; Libron and TeX Gyre Adventor on `/`.
- **The frame.** It fills the window in hard pixels at 1× in Chromium, 2× in desktop Safari and 3× on the iPhone. The
  world page never scrolls, and the home page scrolls normally.
- **Keys.** Arrows, letters, Space, Enter, Esc and O all work, as do the modal options dialog with Esc and the
  terminal drawer's input.
- **Failure.** A broken world file shows the failure message.
- **Pages.** `/`, `/world-bench`, `/fish.json` and the 404 page load with no console errors (with hCaptcha stubbed; see
  below).

## What only a real Safari or iPhone can confirm

- **Toolbars and `vh`.** Automation has no toolbars, so `vh` equals the visible height there. On an iPhone, `vh` is
  taller than what shows. The failure page (`.failed`, `min-height: 100vh`) scrolls a little and sits below centre.
  In landscape, the options panel (`max-height: calc(100vh - 2rem)`) can reach under the toolbar. The mobile branch
  already fixes the Codex's `86vh` (with `--vvh`).
- **Touch.** On `/world`: rubber-band overscroll, pull to refresh, pinch zoom and double-tap zoom (the mobile
  branch's gesture lock covers these). Also how `visualViewport` changes when a page is pinched, since the frame is
  fitted to it.
- **Keyboard in desktop Safari.** Whether a person's tap of an arrow key reads down the Codex (see above). Tab skips
  links and buttons unless Option-Tab or Safari's "Press Tab to highlight each item" setting is on.
- **Performance.** Frame time on a real phone, 30 fps in Low Power Mode, and memory with three bake workers.
- **Older Safari.** `deflate-raw` needs Safari 16.4; older versions show the failure message, which the suite tests.
  The home page's colours are `light-dark()` pairs, which need Safari 17.5.
- **Testing on a phone over the LAN needs HTTPS.** `crypto.subtle` exists only in a secure context, so
  `http://<LAN address>:3000/world` shows "The realm could not be loaded." (checked in Chromium on a non-local
  name). Use the Pages deploy or an HTTPS dev server (`next dev --experimental-https`).

## Notes for the merge

- **The probe.** The mobile branch adds a fuller `probe.state()` (it also has paused, workers and rate). It contains
  this one, so its version should win the conflict in `session.ts`; keep `landmarks` beside it.
- **The phone shell.** The mobile branch's "Before you fly" card and "Take wing" will change what `/world` shows first
  on a phone. The `@phone` world tests will then need to pass the card, or use a query that skips it.
- **The title menu.** When it lands at `/`, the home page test changes with it.
- **hCaptcha.** On `/`, hCaptcha logs a console error in Chromium: "hl: Language was not provided". It comes from the
  contact form, and the suite stubs third parties.
