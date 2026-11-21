# The title: the site's terminal over the world. Implementation plan

> Cursor (`cursor-agent -p --force --model grok-4.7-xhigh`) builds each piece that a test or a precise brief pins. Claude writes the briefs and the failing tests first, reviews every diff, and judges the motion on frame strips. Art and motion are never Cursor's alone.

**Goal:** mount the title the owner approved on `/` (2026-11-20, "Yes, build it"): the mock at https://claude.ai/artifact/FrpYNHsrR6ep7Y6mtZFcxu, variant D.

**Design:** `docs/superpowers/specs/2026-11-20-title-terminal-design.md`.

## The pieces

| # | Piece | Who | Pinned by |
|---|---|---|---|
| 1 | Genie geometry (`title/genie.ts`) and arrival order (`title/arrival.ts`) | Cursor | `genie.test.ts`, `arrival.test.ts` |
| 2 | World hold: the flight held behind the title (speed 0, no input, no guides or HUD), the camera offset that eases to the flight's framing on release, and hold again on Back | Cursor | `session` unit tests, `e2e/site/title.spec.ts` |
| 3 | Mount on `/`: `PhoneSwitch` with the phone title, and the desktop title (the neofetch window with the `./world` lines from `content.ts`, the Enter world button, the row of three links) | Cursor | `e2e/site/title.spec.ts`, `pages.spec.ts` |
| 4 | The links: ⏎, the button and the yellow light minimize the window into the world (genie, then `history.pushState` to `/world`); Back returns; Minimal version and the green light grow the window into `/minimal`; agents.md; Settings opens the options | Cursor | `e2e/site/title.spec.ts` |
| 5 | The genie renderer: the window cut into bands, each a clone of the window mapped onto its piece of the funnel with `matrix3d`; Shift for slow motion | Cursor, judged by Claude | frame strips |
| 6 | The opening: blank paper, the terminal's intro, the `./world` lines; the world arriving pixel by pixel from the dragon; then the button and links | Claude | frame strips at 120 Hz and through a long idle |

## Done

tsc, lint, `npm test`, `npm run e2e` without `GITHUB_TOKEN`, `npm run test:mobile` and `npm run a11y` all pass. The e2e covers ⏎, Esc, the links and Back. Phones still open on the minimal version. Fresh critics audit the strips before the owner sees them. Nothing is pushed.
