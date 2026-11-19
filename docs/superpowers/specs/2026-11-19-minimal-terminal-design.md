# The minimal version and the terminal, as one page: design

Status: **built 2026-11-19** on branch `claude/minimal-terminal-302562`, to the picks below. The owner's decisions
(section 11) are open; each has a recommended option, and that option is what is built.

- **Evidence:** `docs/superpowers/research/2026-11-19-minimal-terminal-mobile.md` ("the research doc"), which includes
  measurements taken in real mobile Safari in the iOS 26.5 Simulator, on a probe page and on the built page.
- **[Owner]** marks a decision that is the owner's. The option listed first, marked "recommended", is what is built.
- **[Call]** marks Claude's call, which the owner can overturn.
- ***tune*** marks a starting number.

## 1. The shape in brief

- **One page that is both.** The page is a macOS Terminal window. Its scrollback is the whole site, already printed:
  who Daniel is, every project, every link. Its last line is a live prompt.
- **Content first.** Everything the minimal version held is in the static HTML as headings, lists and links. It reads
  with no JavaScript, in a screen reader and to a crawler. Nothing waits behind a command.
- **Commands are optional.** The prompt takes typing. Every command can also be run by tapping: a row of commands
  above the prompt, and the command and file names in the terminal's own output.
- **On a phone the page is the terminal.** The document itself scrolls, in Safari's own scroller. The prompt is the
  last line of the document. Nothing is pinned to the bottom of the screen and no script positions anything. That is
  what stops the prompt floating (section 2).
- **On a desktop** it is the same document inside a Terminal window that sits on the paper page.
- **It looks like the terminal the site already has.** The window chrome, the `neofetch` start, the type and the
  colours are the existing ones.

## 2. The fault this fixes

The owner's words: "the text bar just scrolls up so far that it blocks everything else from happening... It's not
anchored onto like right above the actual keyboard part... instead it just kind of floats all over the place."

Measured in the iOS 26.5 Simulator (iPhone 17e); the research doc has the numbers.

| How the prompt is placed | What happened when the keyboard opened |
|---|---|
| Fitted to `visualViewport` by script (the old terminal's method) | For an interval of under 0.6 s the bar was drawn at the top of the visible area, from stale viewport readings, then jumped down. It came to rest about 100 pt above the keyboard. |
| `position: sticky` at the bottom | The page jumped several hundred pixels. The bar rested about 100 pt above the keyboard with page text showing under it. One short drag put the bar behind the keyboard. (A `fixed` bar hangs off the same layout viewport; it was not measured.) |
| A locked `100dvh` shell | Safari pushed the whole shell up by 310 px. The title bar left the screen and text drew over the clock. |
| **The prompt as the last line of a normally scrolling page** | Safari scrolled the page itself and put the prompt's bottom edge exactly on the bottom of the visible area. It did not move again. |

Two facts set the limit for every design:

- **A page cannot put anything on the keyboard's top edge in iOS 26 Safari.** Safari draws its own floating address
  pill and previous / next / ✓ bar in a band about 100 pt tall above the keyboard, and the page shows through behind
  them. WebKit's source turns that bar on for every text input on an iPhone, with an off switch only for apps that
  embed WebKit. "Right above the keyboard" therefore means right above Safari's bar. iOS 27 was not measured; nothing
  in the sources read says 27.0 to 27.2 differ.
- **The numbers a script would pin a bar from are wrong or late while the keyboard moves.** `window.innerHeight` took
  five different values in one keyboard-open state, and the viewport's reported position lagged the page's scroll.
  Only `visualViewport.height` held in every reading.

So the fix is not a better way of pinning. It is to pin nothing.

## 3. Approaches

| | A. The page is the terminal | B. A locked shell, fitted by script | C. A reading page with a docked command bar |
|---|---|---|---|
| What scrolls | The document | An inner box; the page is locked | The document |
| Where the prompt is | The last line of the document | The bottom of the shell | A bar stuck to the bottom of the screen |
| Keyboard on iPhone | Safari places the prompt. No script. | Jumps while the keyboard animates; depends on numbers Safari reports late | Floats 100 pt up with text under it; can end up behind the keyboard |
| Scroll faults | None to have: one native scroller, nothing locked | Needs a scroll lock that iOS does not reliably honour; loses toolbar collapse and tap-to-top | Page jumps on focus |
| Screen reader, crawler, no JavaScript | The transcript is the document | Content sits in a scroll box inside a dialog-like shell | Same as A |
| Looks like a terminal | Yes. The prompt follows the last output, as in a real one | Yes, and most like an app | Less: a chat composer under a document |
| Prompt always in reach | No: it is at the end. A small jump button covers this. | Yes | Yes |
| Script that can go wrong | One scroll after output is printed | The whole layout | The bar's position |

**Pick: A.** [Call] It is the only one that was right in Safari without help, and it is also the simplest and the
most readable. B is what the site had. C is how chat pages are built, and the measurements show why they jump.

What A costs: the prompt is at the end of a long page, so a phone visitor at the top cannot see it. A small `>_`
button in the corner jumps to it. The button is hidden whenever the prompt has focus, so nothing fixed is ever on
screen with the keyboard.

## 4. The page

### 4.1 What is in the static HTML

In order, inside one `<main>`:

1. **The start.** `Last login: …` (the time the site was built), then the command `neofetch` and its output: the
   headshot, `daniel@portfolio`, and the facts as a definition list. The name is the page's `<h1>`.
2. **Projects.** The command `cat projects/README.md` and its output: an `<h2>`, then each pinned repository as an
   `<h3>` link, its description, and its facts and homepage as a short list.
3. **Contact.** `cat contact.md`: email, GitHub, LinkedIn, résumé.
4. **Elsewhere on this site.** `cat sitemap.md`: the title menu, the flight, `agents.md`, `llms.txt`.
5. **The prompt.** A form with one labelled text input, and the row of commands above it.

- Every command shown is real. They are run on the real shell while the site is built, and the page shows what they
  print. Typing one at the prompt prints the same thing again.
- Each section is a `<section>` named by its heading, so a screen-reader user can move by heading or by region.
- A command line is read as "Command: neofetch". The `daniel@portfolio ~ %` before it is hidden from screen readers
  and cannot be selected, so copying a command takes the command alone.

### 4.2 The look

- **Reused as it is:** the title bar with its lights and folder icon (`WindowChrome`, `.term-bar`), the ink ground
  `#1e1e1e`, white text, the grey and cyan of `neofetch` with its layout (the header's own `.nf-*` rules), Terminal's
  sixteen colours, the system monospace stack, the block cursor (solid with focus, hollow without), and the way `cat`
  sets a file (a bar for the title, hashes on a heading, bullets, green underlined links, code on its own ground).
- **Changed for reading:** the text is larger than the old terminal's 11 px (15 px on a phone, 14 px on a desktop,
  ***tune***), lines are 1.6 tall, and prose wraps to the window in CSS, not to a column count.
- **The start plays once per tab.** `neofetch` is typed, its output prints row by row, and then the rest of the page
  is there. It is the old header's animation. Everything is in the document from the first frame, so a screen reader
  and a crawler get the whole page at once. A reload, a deep link, reduced motion and a visit without JavaScript get
  the finished page.
- The terminal stays dark in both site themes, as it does today.

### 4.3 On a phone (up to 640 px wide)

- The window fills the screen edge to edge, and the page behind it is the same ink. Safari's own bars, the area
  behind its keyboard bar and the overscroll bounce all take that colour, so the prompt reads as sitting on the
  keyboard.
- The title bar sticks to the top.
- `neofetch` stacks: the headshot, then each label over its value. This is the existing phone header.
- The prompt reads `~ % `. The full `daniel@portfolio ~ % ` leaves about sixteen characters to type in.
- Tap targets are at least 44 pt tall.

### 4.4 On a desktop

- The window is centred on the paper page, up to 896 px wide (the existing header's width), with the rounded corners
  and shadow of the existing window. It is as tall as its content, and the page scrolls.
- `neofetch` is two columns: the headshot beside the facts.
- ⌘K (Ctrl+K) jumps to the prompt. Tab completes, → accepts the suggestion, ↑ and ↓ walk the history, Escape leaves
  the prompt.
- Tab completes only when there is something to complete. Otherwise it moves focus on, so the prompt is never a
  keyboard trap. Shift+Tab always moves back.
- The row of commands is one Tab stop; the arrow keys move inside it.

### 4.5 The prompt and the keyboard

These rules come straight from the measurements.

1. **The prompt row is the last thing in the document.** The commands sit above it, not below. On focus Safari then
   rests the prompt's bottom edge on the bottom of the visible area.
2. **Nothing is `fixed` or `sticky` at the bottom while the prompt has focus.** The jump button is hidden by CSS
   (`:has(input:focus)`), not by a viewport measurement.
3. **The input is 16 px.** Safari zooms the page for anything smaller (13 px zoomed to 1.23×). Zooming by pinch is
   left on.
4. **After printing output, scroll by the visual viewport's height, and by nothing else of it.**
   `window.scrollBy(0, rect.bottom − visualViewport.height)`. `scrollIntoView` put the prompt under Safari's bar.
   `window.innerHeight` is never read, and neither is the viewport's position (`pageTop`, `offsetTop`): on the built
   page a scroll worked out from `pageTop` left the prompt about 30 pt low after a typed command, and the same scroll
   from the height alone was right.
5. **The page never moves focus to the prompt by itself.** No autofocus: it would skip a screen-reader user past
   the content and, on a phone, do nothing visible.
6. **Focus follows what the visitor is using.**
   - *A finger:* a tapped command gives the prompt no focus, because focus opens the keyboard and that is the
     visitor's to ask for. If the keyboard was open, Safari closes it when a button takes the tap; the scroll then
     waits for the keyboard to finish closing (the visual viewport growing back, or 800 ms). Scrolling at once put
     the output 310 px low.
   - *Keys:* Return keeps focus, and the keyboard, in the prompt, and the prompt stays on the bottom edge as in a
     terminal. A command pressed with the keyboard on a button leaves focus on that button.
   - *A mouse:* a clicked command leaves the keys with the prompt, so typing can carry on.
   - A button that only completes the line (`cat …`, a directory) cancels `pointerdown`, so an open keyboard stays
     open for the next word.
7. `autocapitalize`, `autocorrect` and `spellcheck` are off and the form is `autocomplete="off"`, so iOS shows no
   capitals and no Passwords strip. `enterkeyhint="go"` labels the Return key.

If the script fails or is late, the page is still right: rule 4 is the only script in the path, and without it the
new output is simply below the fold.

### 4.6 Commands by tap

- **The command row.** Above the prompt, a wrapping row of buttons: `help`, `ls`, `cat`, `open`, `work`, `cbonsai`,
  `claude`, `theme`. It is what Tab would offer. As the line is typed it narrows to what still matches, and after
  `cat ` it becomes the files.
  - A command that needs nothing more runs at once.
  - `cat` and `open` need a file, so they fill the line and the row shows the files. Tapping a file runs it; tapping
    a directory goes into it.
- **The terminal's own output.** In `help`, each command is a button (`ls [-la] [path]` runs `ls`; `cat <file>` goes
  on the prompt). In `ls`, each name is a button: a file is read, a directory is listed, the résumé is opened. A
  command quoted in a file (`cat contact.md`) is a button.
- **A run key (⏎)** at the end of the prompt row, shown once the line has text, for keyboards with no Return and for
  switch users.
- Every command in `help` can therefore be reached and run without the keyboard.
- The static sections hold no command buttons: with JavaScript off they would be dead. They hold links only.

### 4.7 Output

- Output is appended above the prompt as ordinary HTML: a file prints as headings, paragraphs, lists and links.
- The transcript is not a live region. One hidden `role="status"` line says what happened, in a sentence ("help:
  printed 16 lines above the prompt"; "zsh: command not found: foo"). Real terminals cap what they read aloud for
  the same reason.
- After a command the page scrolls so that the whole new entry and the prompt are in view. If the entry is taller
  than the screen, a reader (a tap or a click) gets its first line at the top, and someone typing keeps the prompt.
  The scroll is instant, as a terminal prints.

### 4.8 Full-screen programs (`work`, `cbonsai`, `claude`)

- They run inline: a pane takes the prompt's place until the program exits, then the prompt returns. The grid and
  its drawing code are the existing `ScreenView`, unchanged.
- The pane has its own line: the program's name, and a `quit` button that needs no keyboard and does not depend on
  the program. Escape also leaves a program that has no use for it.
- The pane is 24 rows on a desktop. On a phone it is as tall as the visible area, and it is the one thing sized from
  `visualViewport` (its height only, never its position). A stale reading makes it briefly too tall; it cannot float.
- A program reads typed text through a hidden input, as it did in the old window. Three things keep that steady on
  a phone, each found by measuring:
  - A press on the pane asks for the keyboard with a focus made inside the press. Re-focusing a field that script
    had already focused opened nothing.
  - Safari does not pan to the hidden input, so while the keyboard is up the page ends one keyboard lower, and the
    pane is scrolled up clear of it.
  - The hidden input sits at the top of the pane, in view. At the foot, the first key typed made Safari pan to it.
  - Measured: the program's input sits above Safari's bar before typing, after typing, with the keyboard dismissed
    and with it summoned again.
- [Owner] See decision 4.

### 4.9 Without JavaScript, and for machines

- With JavaScript off the page is complete. The row of commands, the prompt and the links to it are taken away, and
  a line says that the prompt needs JavaScript and that everything its commands print is already on the page. No
  dead control is offered.
- Links are `<a href>`. The page has a canonical address, Open Graph tags and a `Person` JSON-LD block, generated
  from `content.ts`.
- Print: black on white, without the prompt.
- `forced-colors`: system colours, focus rings kept.
- Reduced motion: no start animation.

### 4.10 What three commands mean here

- `clear` clears what the session printed. The page's own sections stay. [Call]
- `exit`, and the red light, go to the title menu (`/`).
- `theme` switches the site theme. On a phone the window fills the screen, so only the browser's bars change.

## 5. One source of content

- The profile and links come from `src/components/terminal/content.ts`; the projects from the pinned repositories
  (`src/lib/github.ts`). Nothing is copied into the page.
- Each static section is the output of a file in the terminal's filesystem (`src/components/terminal/site.ts`):
  `projects/README.md` (new: the pinned repositories, one entry each), `contact.md` and `sitemap.md` (new: built
  from `SITE_PAGES`). The page and the `cat` command render the same markdown with the same component.
- `neofetch` is one component, used for the static start and for the command.
- The page's address is one constant, `TEXT_PAGE` in `src/lib/site-content.ts`. The page list, the agent files, the
  canonical link and the forward from the old address all read it.
- The mock repositories that stand in when a build has no `GITHUB_TOKEN` are never published
  (`publishedProjects`), as on the text page before.

## 6. Code

- **New:**
  - `src/app/minimal/`: the page and `minimal.css`.
  - `src/components/minimal/`: `Banner` (neofetch), `Doc` (a markdown file as a document), `Lines` (one line of
    output as HTML), `Session` (the live end: output, the command row, the prompt, programs), `transcript.ts` (the
    opening commands, run on the real shell; the one-line summaries) and `reveal.ts` (the scroll arithmetic).
  - `e2e/minimal/`: the WebKit tests, as two projects (`minimal-phone`, `minimal-desktop`) of the end-to-end suite
    in `playwright.config.ts`. `npm run test:minimal` runs them alone; `npm run e2e` runs them with the rest.
- **Reused unchanged:** `ScreenView`, the three programs, `fs.ts`, `shell.ts`'s tokenizer, history and completion,
  `tty/`, the Terminal and neofetch styles in `globals.css`.
- **Extended, without changing what the old terminal does:**
  - `types.ts`: two more kinds of output line (`doc`, `neofetch`), a `run` hint on a text run, two optional methods
    on the command context, `pages` on the site info.
  - `commands.ts`: `cat`, `open` and `neofetch` use those methods when the host has them.
  - `site.ts`: the new files, in the tree only for a page that gives the site's other pages: this one, and the
    abbey's terminal in `/world`.
  - `ls.ts`: each listed name carries the command that looks inside it.
  - `markdown.ts`: `parse` and `spans`, the model a document view starts from.
  - `shell.ts`: `suggest()`, the list the command row shows.
  - `useShell.ts`: options for the rich output, and `run`, `suggestions`, `names`.
  - `WindowChrome.tsx`: the red light can be a link.
- **Styles** live in `src/app/minimal/minimal.css` under the `mt-` prefix, not in `globals.css`. The page is the
  terminal replica, hand-written like the header and the old window; Astryx does not govern it. The forward at
  `/recruiter` is ordinary page chrome and uses Astryx.
- **Not touched:** `src/app/page.tsx`, `src/app/layout.tsx`, the title menu.
- **`/world`, one line:** its page gives the abbey's terminal the site's other pages (`otherPages` in
  `src/lib/site-content.ts`, which this page uses too). Its contact card no longer points at a form that page does
  not have, and it gains `~/sitemap.md` and `projects/README.md`. With that comes the one change to what the old
  window does: its renderer (`markdown.ts`) links a path on this site as well as the web, so the sitemap's pages and
  the résumé can be followed there. They open in a new tab, like its other links.

## 7. Tests

- **Unit (`npm test`), 74 new:** the new files and what they print; the opening commands; the one-line summaries;
  the document model and which link targets it allows; `suggest()`; the commands that `ls` names carry; the scroll
  arithmetic, pinned to the Simulator's numbers; the page list, a page's list of the others, the JSON-LD and the
  agent files.
- **WebKit (`npm run test:minimal`), 46:** the `minimal-phone` and `minimal-desktop` projects of the end-to-end
  suite (`e2e/minimal/`), against the static export. Like every test in that suite, each also fails on any console
  error or uncaught exception.
  - With JavaScript off, every heading, profile fact and link is present, and no dead control is offered.
  - No sideways scroll at 320, 375 and 390 px, before or after commands print.
  - The document is the only scroller. The prompt row is the last thing in it. Its text is 16 px. Zoom is not
    turned off.
  - Nothing takes focus on load. With the prompt focused, the only pinned thing is the title bar.
  - Taps: the jump button, a command, a command that needs a file, names in `ls`, commands in `help`, `clear`.
  - Keys: Return, Tab, Shift+Tab, the arrow keys, ⌘K, Escape. A mouse click leaves the keys with the prompt.
  - A program takes the prompt's place, whole on screen, and gives it back.
  - The start plays once in a tab and leaves the page finished.
  - The old address forwards here.
  - Where output comes to rest is read once the page has stopped moving. WebKit scrolls to a focused field a moment
    after a script changes its value; a test that read at once missed it (research doc, "Building the page").
- **`npm run a11y`:** axe on `/minimal`, no violations, phone and desktop, light and dark.
- **The iOS Simulator, by hand:** the keyboard cases Playwright cannot show (its WebKit has no on-screen keyboard).
  Run on the final build; screenshots are with the session notes.
- **Not covered:** a real iPhone, and iOS 27. See section 12.

## 8. What a visitor meets

- **A recruiter on a phone** sees the headshot, the name and the facts, scrolls through projects and contact, and
  leaves. They never need the prompt.
- **A curious visitor** taps `>_` or scrolls to the end, taps `help`, then taps a command.
- **A terminal user on a laptop** presses ⌘K and types.
- **A screen-reader user** gets a page with one `h1`, sections by heading, and a labelled command field with its
  buttons, announced one line at a time.
- **A crawler or an agent** gets all of it in the first response.

## 9. What exists today

| Piece | Where | Becomes |
|---|---|---|
| The text page | `src/app/recruiter/page.tsx` | A forward to this page. Decision 2. |
| The pop-up terminal | `src/components/terminal/Terminal.tsx`, `TerminalLauncher`, `ShellView`, `useTermWindow` | Still used by today's home page. Decision 3. |
| The `neofetch` header | `src/components/NeofetchHeader.tsx` | Its look is this page's start. Still used by today's home page. |
| The shell, the filesystem, the programs | `src/components/terminal/` | Shared by both. |

## 10. Order of building (as built)

1. The content: the new files, the document model, `suggest()`, with tests.
2. The static page and its look, judged on phone and desktop screenshots.
3. The live session: prompt, command row, output, scrolling.
4. Programs inline.
5. The forward, the page list, the agent files, axe.
6. WebKit tests and the Simulator pass.

## 11. Decisions for the owner

1. **Where the page lives.**
   - `/minimal` (recommended, built). It matches the menu's "Minimal version".
   - `/recruiter`. It keeps the address other branches link to, under a name that is being retired.
   - `/` itself, with the title menu drawn over it. Best for search engines: the site's main address would carry the
     whole text, where a menu of four links carries almost none. This changes the title menu's design, so it is the
     owner's and the title session's call.
   - Moving it is one constant (`TEXT_PAGE`) and one folder.
2. **What happens to `/recruiter`.**
   - It forwards to the new page (recommended, built), so links from other branches keep working. It has never been
     published, so no search engine knows it.
   - It is deleted.
3. **The old pop-up terminal and the old home page.**
   - Removed once the title menu takes `/` (recommended). This page replaces both. The code stays until then because
     today's `/` still uses it.
   - Kept at its own address.
4. **Programs on a phone.**
   - `work`, `cbonsai` and `claude` run inline on phones too (recommended, built).
   - Or desktop only, with a line saying so on a phone. `claude` types through a hidden input, the kind of input
     that goes wrong on phones. It took three fixes to hold steady in the Simulator (section 4.8), which is a reason
     to check it first on a real phone.
5. **Text size on a phone:** 15 px with a 16 px prompt (recommended, built), or 16 px throughout.
6. **`clear`:** clears the session only (recommended, built), or the whole page as a real terminal would.
7. **The contact form.** Left out (recommended, built): the page stays text and links, as the text page was. Or
   added under Contact.
8. **LinkedIn.** `content.ts` still marks the address as a guess, and this page publishes it, as the text page did.
   The JSON-LD lists only GitHub for that reason.

## 12. Not in this piece

- **A real iPhone.** Everything was measured with synthesised touches in the Simulator on iOS 26.5. Momentum,
  rubber-banding and Safari's tab-bar layouts need a hand on a phone, and iOS 27 needs a device or a runtime. The
  research doc lists what would settle each open point.
- **`interactive-widget`.** WebKit has it in the iOS 27.3 beta. If `resizes-content` comes to work, nothing here
  depends on it and nothing here breaks.
- **The title menu's link** to this page, and `.claude/CLAUDE.md`'s description of the four ways in. Both belong to
  the title session and the coordinator.
- **Project descriptions.** Some are rough on GitHub itself ("Main Repo I guess"). They come straight from GitHub;
  fix them there.
