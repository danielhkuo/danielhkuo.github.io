// macOS 26 window chrome shared by the live terminal and the neofetch header:
// the traffic lights and the title bar's proxy icon. Geometry lives in
// globals.css (.term-bar); see the Terminal section there for the measurements.

/** The glyphs macOS shows on the lights while the pointer is over them. */
const GLYPHS = [
  <path key="x" d="M4.5 4.5l5 5M9.5 4.5l-5 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />,
  <path key="-" d="M3.75 7h6.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />,
  <path key="+" d="M4.2 4.2h3.6L4.2 7.8zM9.8 9.8H6.2l3.6-3.6z" fill="currentColor" />,
];

/**
 * Close, minimise, zoom. A light with a handler is a button (the live window,
 * and the title's yellow and green lights). A light without one is a plain
 * span, so the header's lights stay decorative and the title's red light is
 * not a control. `closeHref` makes the red light alone a link, for a window
 * that is a page: closing it goes somewhere.
 */
export function Lights({
  onClose,
  onMinimize,
  onZoom,
  closeHref,
  closeLabel = "Close",
}: {
  onClose?: () => void;
  onMinimize?: () => void;
  onZoom?: () => void;
  closeHref?: string;
  closeLabel?: string;
}) {
  if (closeHref) {
    return (
      <div className="lights">
        <a href={closeHref} aria-label={closeLabel}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>{GLYPHS[0]}</svg>
        </a>
        {GLYPHS.slice(1).map((g, i) => (
          <span key={i} aria-hidden>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>{g}</svg>
          </span>
        ))}
      </div>
    );
  }
  const actions = [
    { label: "Close", run: onClose },
    { label: "Minimize", run: onMinimize },
    { label: "Zoom", run: onZoom },
  ];
  if (!onClose && !onMinimize && !onZoom) {
    return (
      <div className="lights" aria-hidden>
        {GLYPHS.map((g, i) => (
          <span key={i}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>{g}</svg>
          </span>
        ))}
      </div>
    );
  }
  return (
    <div className="lights">
      {actions.map((a, i) =>
        a.run ? (
          <button key={a.label} type="button" aria-label={a.label} onClick={a.run}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>{GLYPHS[i]}</svg>
          </button>
        ) : (
          <span key={a.label} aria-hidden>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>{GLYPHS[i]}</svg>
          </span>
        ),
      )}
    </div>
  );
}

/** The cwd proxy icon: SF Symbols' folder.fill at 14×12. */
export function ProxyIcon() {
  return (
    <svg className="proxy" viewBox="0 0 14 12" aria-hidden>
      <path
        fill="currentColor"
        d="M1.6 0h3.3c.5 0 .8.2 1.1.5l.8.9H12.4c.9 0 1.6.7 1.6 1.6v.2H0V1.6C0 .7.7 0 1.6 0z"
      />
      <path fill="currentColor" d="M0 3.6h14v6.8c0 .9-.7 1.6-1.6 1.6H1.6C.7 12 0 11.3 0 10.4z" />
    </svg>
  );
}
