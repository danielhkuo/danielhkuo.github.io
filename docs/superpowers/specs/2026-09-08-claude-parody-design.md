# `claude` in the interactive terminal — design

**Date:** 2026-09-08
**Status:** built

## Goal

A `claude` command in the site's shell that looks and behaves like Claude
Code's terminal UI and never does what it is asked. Every prompt gets a
sardonic refusal; the point is the joke, delivered in a pixel-faithful frame.

## What it copies from Claude Code

- Welcome box (rounded, orange border): `✻ Welcome to Claude Code!`,
  `/help for help, /status for your current setup`, `cwd:`; then
  "Tips for getting started" and a `※ Tip:` line.
- The `>` prompt in a rounded grey box with a block cursor and a dim
  placeholder (`Try "…"`); `? for shortcuts` and a `⏵⏵ … (shift+tab to cycle)`
  mode label beneath it. Long input wraps inside the box.
- The asterisk spinner (`· ✢ ✳ ✶ ✻ ✽`) with rotating verbs and
  `(esc to interrupt · Ns · ↑ N tokens)`.
- `⏺` paragraphs that stream in, `⏺ Tool(arg)` calls in green with
  `⎿  result` beneath, `⎿  Interrupted · What should Claude do instead?`
  in red on Escape.
- Slash commands with the live menu that opens on `/` (arrows, Tab, Enter),
  real descriptions, unknown-command error. `/help /status /cost /clear
  /compact /doctor /init /login /memory /model /vim /exit`.
- History on the arrow keys, Ctrl-A/E/U/K/W line editing, Ctrl-L,
  `Press Ctrl-C again to exit` (also Ctrl-D), `exit`/`quit`.
- On exit the whole transcript stays in the scrollback, as an inline TUI's
  would. Mouse wheel and PageUp/Down scroll the transcript.

## What it does not copy

- Anything useful.

## Architecture

```
src/components/terminal/tty/       Screen/Win, wcwidth, colours (shared with cbonsai)
src/components/terminal/claude/
  content.ts   spinner verbs, tips, slash texts, tool theatre, reply pools
  wrap.ts      word wrap of styled runs with continuation indent
  program.ts   ClaudeProgram: line editor, transcript, spinner/stream
               choreography, slash commands, exit → scrollback
```

Host additions for programs that read text (`types.ts`, `Terminal.tsx`,
`ScreenView.tsx`): `captureEscape` keeps Escape from closing the terminal,
`textInput` keeps an invisible input focused so phones show a keyboard (text
arrives through a native `beforeinput` listener), `wheel()` receives mouse
wheel rows, `key()` gains `shift`. Cells gained an inverse-video attribute
(`.ti`) for the cursor and the highlighted menu row.

## Replies

`replyFor(prompt, turn, rand)` picks a pool by what the prompt looks like
(greeting, thanks, please, fix/bug, build, explain, git, tests, delete,
identity, sudo, pasted code, very long, all caps, else generic), fills
`{p}` with a quoted, truncated echo of the prompt, and every third turn
appends a remark about persistence. Roughly half the replies are preceded by
one or two fake tool calls. Nothing is personal, profane or about the
visitor beyond the fact that they typed into a fake terminal.

## Testing

`node --test` with mocked timers: layout, editing and cursor, the spin →
tools → stream → idle choreography, interrupt, Ctrl-C arming and disarm,
every exit path, slash commands and menu, history, wrapping, scrolling,
Shift-Tab, `stop()`, and restart after `stop()` (StrictMode double mount).
Headless Chrome run via Puppeteer for the DOM path in both themes and on a
phone viewport.
