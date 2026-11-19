import { FILE_NAME, type Mark } from "./daniel";
import { GOTO, HELP } from "./ids";

/**
 * The two screens a shortcut opens: Help (^G) and Go To Line (^/). Each is an HTML popover, opened by its key's
 * button with `popovertarget`, so both work with no JavaScript; Esc and a press outside close them. Footer.tsx adds
 * the Control keys and moves focus in and out.
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
    <div id={HELP} popover="auto" className="nano-panel nano-help" role="dialog" aria-labelledby="nano-help-title">
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
          This is {FILE_NAME}: the whole site as one plain text file, open in nano. Scroll it, follow its links, and use
          these keys:
        </p>
        <dl className="nano-help-keys">
          <div>
            <Key shown="^G" spoken="Control G" />
            <dd>Show this help. ^X or Esc closes it.</dd>
          </div>
          <div>
            <Key shown="^F" spoken="Control F" />
            <dd>
              Search: type a word and press Enter to go to it. Enter on an empty search goes to the next one. Without
              JavaScript, use the browser&rsquo;s own find.
            </dd>
          </div>
          <div>
            <Key shown="^/" spoken="Control slash" />
            <dd>Go to a section: the top, PROJECTS, CONTACT or ELSEWHERE.</dd>
          </div>
          <div>
            <Key shown="^X" spoken="Control X" />
            <dd>Close the file and go back to the title menu.</dd>
          </div>
          <div>
            <Key shown="Esc" spoken="Escape" />
            <dd>Close what is open. With nothing open, the same as ^X.</dd>
          </div>
        </dl>
        <p>On a phone, tap the keys at the foot of the screen. The other keys there are nano&rsquo;s own, shown as nano
          shows them; they do nothing here.</p>
      </div>
      <div className="nano-panel-keys">
        <Close panel={HELP} />
      </div>
    </div>
  );
}

export function GoTo({ marks }: { marks: readonly Mark[] }) {
  return (
    <div id={GOTO} popover="auto" className="nano-panel nano-goto" role="dialog" aria-labelledby="nano-goto-title">
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
    </div>
  );
}
