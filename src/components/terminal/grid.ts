/** A character cell, in CSS pixels. */
export interface Cell {
  width: number;
  height: number;
}

/**
 * How many whole cells fit in a terminal body's content box: the terminal's
 * size, as the title reports it and as a full-screen program draws in. Taken
 * from the border box, so a classic scrollbar appearing over long scrollback
 * doesn't change the count, just as it doesn't in Terminal.
 */
export function gridSize(body: HTMLElement, cell: Cell): { rows: number; cols: number } {
  const cs = getComputedStyle(body);
  const width = body.offsetWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const height = body.offsetHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  return {
    rows: Math.max(1, Math.floor(height / cell.height)),
    cols: Math.max(1, Math.floor(width / cell.width)),
  };
}
