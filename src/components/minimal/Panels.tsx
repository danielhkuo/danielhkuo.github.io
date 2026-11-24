import { FILE_NAME, type Mark } from "./daniel";
import { GOTO, HELP } from "./ids";

/**
 * The two screens a shortcut opens: Help (^G) and Go To Line (^/). Each is a `<dialog>` shown as a popover, opened by
 * its key's button with `popovertarget`, so both work with no JavaScript and read as dialogs; Esc and a press outside
 * close them. Footer.tsx adds the Control keys and moves focus in and out.
 */

/** The key that closes a screen: ^X, as in nano's help. */
function Close({ panel }: { panel: string }) {
  return (
    <button
      type="button"
      className="nano-key"
      popoverTarget={panel}
      popoverTargetAction="hide"
      aria-keyshortcuts="Control+X Escape"
    >
      <kbd aria-hidden="true">^X</kbd> Close
    </button>
  );
}

/** A key as the help lists it: "^G" on screen, "Control G" to a screen reader. */
function Key({ shown, spoken }: { shown: string; spoken: string }) {
  return (
    <dt>
      <kbd aria-hidden="true">{shown}</kbd>
      <span className="nano-sr">{spoken}</span>
    </dt>
  );
}

export function Help() {
  return (
    <dialog id={HELP} popover="auto" className="nano-panel nano-help" aria-labelledby="nano-help-title">
      <div className="nano-bar" aria-hidden="true">
        <span>GNU nano 8.2</span>
        <span className="nano-file">{FILE_NAME}</span>
        <span />
      </div>
      <div className="nano-help-text">
        <p id="nano-help-title" className="nano-help-title">
          Help
        </p>
        <p>
          This is {FILE_NAME}&mdash;the entire site as a single plain-text file inside nano. Scroll through, follow
          any link, or use these shortcuts:
        </p>
        <dl className="nano-help-keys">
          <div>
            <Key shown="^G" spoken="Control G" />
            <dd>Open or close this help window (^X or Esc also closes it).</dd>
          </div>
          <div>
            <Key shown="^F" spoken="Control F" />
            <dd>
              Search the page. Type a term and press Enter to jump to a match; press Enter again on an empty prompt to
              find the next one. Without JavaScript, use your browser&rsquo;s find shortcut.
            </dd>
          </div>
          <div>
            <Key shown="^/" spoken="Control slash" />
            <dd>Jump directly to a section: the top, PROJECTS, CONTACT, or ELSEWHERE.</dd>
          </div>
          <div>
            <Key shown="^X" spoken="Control X" />
            <dd>Close the file and return to the title menu.</dd>
          </div>
          <div>
            <Key shown="Esc" spoken="Escape" />
            <dd>Close the open dialog or search prompt, or return to the title menu when nothing is open.</dd>
          </div>
        </dl>
        <p>
          On mobile, tap any active shortcut at the bottom of the screen. The remaining dimmed shortcuts are part of
          nano&rsquo;s classic bar and are inactive here.
        </p>
      </div>
      <div className="nano-panel-keys">
        <Close panel={HELP} />
      </div>
    </dialog>
  );
}

export function GoTo({ marks }: { marks: readonly Mark[] }) {
  return (
    <dialog id={GOTO} popover="auto" className="nano-panel nano-goto" aria-labelledby="nano-goto-title">
      <p id="nano-goto-title" className="nano-prompt">
        Go to line:
      </p>
      <ul className="nano-goto-list">
        {marks.map((m) => (
          <li key={m.id}>
            <a href={`#${m.id}`} data-goto={m.id}>
              <span className="nano-line">
                <span className="nano-sr">Line </span>
                {m.line}
              </span>{" "}
              {m.label}
            </a>
          </li>
        ))}
      </ul>
      <div className="nano-panel-keys">
        <Close panel={GOTO} />
      </div>
    </dialog>
  );
}
