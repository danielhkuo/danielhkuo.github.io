# cbonsai in the interactive terminal — design

**Date:** 2026-09-07
**Status:** approved (autonomous session; assumptions listed at the end)

## Goal

Add `cbonsai` to the site's interactive shell (`src/components/terminal`) as a
faithful port of [cbonsai](https://gitlab.com/jallbrit/cbonsai) (C, ncurses).
Same growth algorithm, same random number generator, same strings, colours,
base art, message box, flags and key handling. Same seed on the same grid size
must produce the same tree as the Linux binary.

## Non-goals

- Anything that changes the rest of the shell's behaviour.
- A standalone page or hero decoration. The tree lives in the terminal only.
- Shipping cbonsai in the first-load bundle. It loads on first use.

## User experience

```
~/ $ cbonsai            # full-screen tree, any key returns to the prompt
~/ $ cbonsai -l         # watch it grow (0.03 s per step); q quits early
~/ $ cbonsai -li -w 2   # keep growing new trees every 2 s
~/ $ cbonsai -S         # screensaver: -li, resumes the saved tree, any key quits
~/ $ cbonsai -p -s 42   # print the finished tree into the scrollback
~/ $ cbonsai -m "hi"    # message box at 70%/70% of the screen, word-wrapped
~/ $ cbonsai -h         # cbonsai's own help text
```

While cbonsai runs, the terminal behaves like an ncurses alternate screen:
the scrollback and prompt disappear, the whole body is a fixed character grid,
the cursor is hidden, and keys go to the program. On exit the scrollback and
prompt come back exactly as they were. `-p` appends the tree as output.

Tapping the screen on a touch device counts as a key press, since there is no
keyboard to press.

## Architecture

```
src/components/terminal/cbonsai/
  rand.ts        glibc random() (TYPE_3 additive feedback) — srand/rand parity
  wcwidth.ts     display width of a code point (wide/emoji → 2, else 1)
  screen.ts      Screen: rows×cols cell grid with dirty-row tracking; Win: an
                 ncurses-style window (origin, size, cursor, wrapping writes)
  args.ts        getopt_long-compatible parser producing Config, or help/error
  bonsai.ts      the port: drawBase, setDeltas, chooseString, chooseColor,
                 branch/growTree as generators, drawMessage
  program.ts     CbonsaiProgram: implements ScreenProgram; owns scheduling
                 (live stepping, infinite wait, key handling, save/load)
  colors.ts      xterm-256 index → CSS colour (0–15 via --ansi-N vars)
  ScreenView.tsx React host: measures the grid, paints dirty rows
  *.test.ts      node:test unit tests
```

Boundaries:

- `screen.ts`, `bonsai.ts`, `rand.ts`, `args.ts` are pure TypeScript with no
  DOM. They run in Node for tests and benchmarks.
- `program.ts` uses timers only. It talks to the host through a small
  interface and never touches the DOM.
- `ScreenView.tsx` is the only file that knows about React and the DOM.

### Terminal integration

`types.ts` gains:

```ts
export interface ScreenProgram {
  start(size: { rows: number; cols: number }, host: ProgramHost): Screen;
  key(key: string, ctrl: boolean): void;   // "tap" for touch
  stop(): void;                            // host is going away
}
export interface ProgramHost {
  paint(): void;                           // screen changed, repaint dirty rows
  exit(output?: TerminalLine[]): void;     // back to the prompt
}
// CommandContext gains:
program(p: ScreenProgram): void;
// TerminalLine gains:
| { kind: "screen"; rows: CellRun[][] }    // static snapshot for -p
```

`Terminal.tsx` holds `program` state. When set it renders `<ScreenView>` in
place of the scrollback and hides the input row. A window `keydown` listener
forwards keys and calls `preventDefault` so Space and arrows do not scroll
the page. Closing the terminal (Esc, click outside, ⌘K) calls `stop()`.

The `cbonsai` command in `commands.ts` parses nothing itself. It lazy-loads
`./cbonsai/program` and hands the raw args over. Parse errors and help text
come back through `ctx.err` / `ctx.out` before any screen is taken over.

### Grid size

`ScreenView` measures the terminal body's content box and one character cell
(a hidden 10-character span) after mount, then calls `program.start`. The
grid is fixed for the life of the program, like a terminal that ignores
SIGWINCH. Row height is the body's line-height; the pre is sized to
rows × line-height so nothing scrolls.

### Rendering

DOM rows, not canvas. Each row is one `<div>`; a dirty row is rebuilt as a
string of `<span>`s grouped by (colour, bold) runs and assigned via
`innerHTML` with escaped text. Reasons over canvas:

- Colours are CSS variables, so the live theme toggle recolours the tree
  with no redraw.
- Uses the terminal's own font and metrics: no font-load race, no DPR work.
- The tree is selectable text, as in a real terminal.
- Live mode dirties one to three rows per step. Rebuilding a row is
  microseconds. Paints coalesce to one per animation frame.

`-p` output is a `screen` line: the final grid as `CellRun[][]`, rendered by
React once, leading blank rows trimmed (a real terminal clears then prints the
full screen, which in a scrollback would be a screenful of empty lines).

### Colours

cbonsai's four colour pairs default to xterm indices 2, 3, 10, 11 (dark
leaves, dark wood, light leaves, light wood) and text on 8. `-k` accepts any
0–255. Indices 0–15 map to `--ansi-N` CSS variables defined for both themes
on `.term-win` in `globals.css` using the Atom One palettes; 16–231 use the
xterm colour cube and 232–255 the grey ramp, computed once. Bold is
`font-weight: 700`. Background is the terminal's own.

Dark theme: 2 `#98c379`, 10 `#c3e88d`, 3 `#d19a66`, 11 `#e5c07b`, 8 `#5c6370`.
Light theme: 2 `#50a14f`, 10 `#6fbf4a`, 3 `#986801`, 11 `#c18401`, 8 `#a0a1a7`.

### Randomness

`rand.ts` implements glibc `srand`/`rand` exactly (LCG 16807 seeding of 34
words, 310 discarded outputs, `r[i] = r[i-3] + r[i-31]`, result `>>> 1`).
Every `rand()` call in the C source has a counterpart in the same order,
including `shootCounter = rand()`, the colour rolls and the leaf choice.
The default seed is `time(NULL)`, i.e. `Math.floor(Date.now() / 1000)`;
infinite mode reseeds with the clock after each tree, as the C does.

### Scheduling (program.ts)

- Non-live: run the growth generator to completion synchronously, paint once.
- Live: a `setTimeout` loop. Each tick runs every step whose due time has
  passed (capped at 8 ms of work per tick so a backgrounded tab catches up
  without a long task), then asks the host to paint. Step period is `-t`.
- After growth: non-infinite waits for any key. Infinite waits `-w` seconds;
  `q` (any key in screensaver) quits; any other key ends the wait early,
  as `timeout()` + `wgetch` does in C. Then reseed, clear, redraw base and
  message, grow again.
- During live growth: `q` quits (any key in screensaver). Ctrl+C always quits.
- Load (`-C`): steps are not painted or delayed until the branch count reaches
  the saved target, so a saved tree reappears instantly and then continues.
- Save (`-W`): on every exit, seed and branch count are written.
- The "file" is `localStorage` under `cbonsai:<path>`; the default path is
  `~/.cache/cbonsai`. `-S` sets save and load, like the C.

### Argument parsing (args.ts)

A getopt_long port: clustered short flags (`-li`), attached (`-t0.5`) or
separate (`-t 0.5`) values, `--long=value` and `--long value`, `--` ends
options, non-option words are ignored. The optstring is
`:lt:iw:Sm:b:c:k:M:L:ps:C:W:vh` and the long table is copied from the source,
including its quirk that `--print` declares a required argument. Numeric
validation copies the C: `strtof(arg) != 0` for `-t -w -M -L -s` (so `0` and
non-numbers are rejected, `3abc` is accepted as 3), `errno`-based for `-b`.
`-W`/`-C` with a following option or no argument keep the default path.
Errors print `error: …` and, where the C prints help, the help text.

### Message box

`drawMessage` is ported line for line onto a `Win` with wrapping writes
(`wprintw` semantics: advance, wrap at the right edge, stop at the bottom).
The box geometry (`0.25 * maxX`, `maxY * 0.7`) uses `Math.trunc` where the C
truncates to `int`. The message panels sit above the tree panel, so tree
writes inside the box rectangle are dropped.

### Verbosity

`-v` writes the same debug fields at the same coordinates as the C. `-vv`
does not sleep one second per message character (that path exists only to
debug the wrapper); it otherwise behaves as `-v`.

## Testing

`node --test` on the pure modules (Node 26 strips types natively; the engine
uses explicit `.ts` import specifiers and `allowImportingTsExtensions`):

- `rand.test.ts`: glibc's known sequence for `srand(1)`, `srand(42)`.
- `args.test.ts`: every flag, clustering, quirks, error strings, help.
- `screen.test.ts`: wrapping writes, clipping, wide characters, dirty rows,
  overlay mask.
- `bonsai.test.ts`: a fixed seed on 80×24 renders to a golden text file
  captured from the Linux binary; branch counts; base placement; message
  wrapping against known layouts.

Performance:

- `scripts/bench-cbonsai.mjs`: trees/second and steps/second at defaults on
  80×24, and at `-L 200 -M 20` on 200×60; heap stable across 2 000 trees.
- Browser: dev server plus the in-app browser. Run `cbonsai -li -t 0.001`
  and sample `requestAnimationFrame` deltas and `longtask` entries for
  several seconds. Target: no long tasks, no frame over 33 ms, main-thread
  cost per frame under 2 ms. Heap flat across a minute of infinite mode.
- Bundle: the page's first-load JS must not grow; cbonsai is its own chunk.

## Assumptions made without the user

1. cbonsai lives in the existing terminal, not elsewhere on the page.
2. Parity target is the Linux (glibc) binary. macOS `rand()` differs.
3. `-p` output drops leading blank rows.
4. Save/load use `localStorage`.
5. `-vv` does not sleep per character.
