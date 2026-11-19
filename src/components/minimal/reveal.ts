// Where to scroll after the terminal prints, worked out from the VISUAL
// viewport's height and nothing else of it. On an iPhone with the keyboard
// up everything else is wrong or late (measured in the iOS 26.5 Simulator;
// see the research doc):
//
//   - `window.innerHeight` reads 389, 487, 607 or 699 in the same state;
//   - `scrollIntoView` rests an element under Safari's own floating bar, 98 px
//     too low;
//   - `visualViewport.pageTop` and `offsetTop` go stale after a scroll, and
//     for a while still give where the viewport was.
//
// Its `height` held in every reading. Pure, so the arithmetic is pinned by
// tests on the measured numbers.

/** The part of the page that can be seen, in the coordinates client rects use. */
export interface View {
  top: number;
  bottom: number;
}

/** The readings `visibleArea` needs of `window.visualViewport`. */
export interface Viewport {
  height: number;
  offsetTop: number;
}

/**
 * The visible area in client coordinates.
 *
 * Client rects are measured from the layout viewport in Chrome and Firefox,
 * so the visible area starts where the visual viewport has panned to inside
 * it (`offsetTop`). iOS WebKit measures them from the visual viewport itself
 * (and reports `window.scrollY` to match), so there it starts at 0 whatever
 * `offsetTop` says: `rectsFromVisual`. Without a visual viewport the window
 * is all there is.
 */
export function visibleArea(
  viewport: Viewport | null | undefined,
  innerHeight: number,
  rectsFromVisual: boolean,
): View {
  if (!viewport) return { top: 0, bottom: innerHeight };
  const top = rectsFromVisual ? 0 : viewport.offsetTop;
  return { top, bottom: top + viewport.height };
}

/**
 * How far to scroll, in CSS pixels with down positive, so that what was just
 * printed can be read: `from` is the top of the new entry and `to` the bottom
 * of the prompt under it.
 *
 * Already in view, nothing moves. If both fit, the prompt rests on the bottom
 * edge, as it does in a terminal. If the entry is taller than the view, it
 * depends on who is asking. Someone typing (`keepEnd`) keeps the prompt in
 * view, as a terminal would, and scrolls back to read. Someone who tapped a
 * command is reading, so its first line goes to the top.
 */
export function revealBy(from: number, to: number, view: View, keepEnd = false): number {
  if (from >= view.top && to <= view.bottom) return 0;
  if (keepEnd || to - from <= view.bottom - view.top) return to - view.bottom;
  return from - view.top;
}
