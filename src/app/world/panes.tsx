// The five panes of coloured glass, drawn as pixel art in the Codex: a pointed lancet, leaded in ink, glazed in the
// pane's colour. Game layer: inline SVG, not Astryx.

import { PIECE_RGB, type StopKey } from "../../world/story/stops";

/** The lancet, 7 × 11 px: k ink (the lead), g glass, l a glint of light in the glass. */
const LANCET = [
  "...k...",
  "..kgk..",
  ".kglgk.",
  ".kglgk.",
  "kgggggk",
  "kkkkkkk",
  "kgggggk",
  "kglgggk",
  "kgggggk",
  "kgggggk",
  "kkkkkkk",
];

/** A packed ABGR colour (the renderer's) as CSS. */
function css(abgr: number): string {
  return `rgb(${abgr & 255} ${(abgr >>> 8) & 255} ${(abgr >>> 16) & 255})`;
}

/** One pane, in its own colour, leaded in `currentColor`. */
export function Pane({ stop, className }: { stop: StopKey; className?: string }) {
  const glass = css(PIECE_RGB[stop]);
  const cells = [];
  for (let y = 0; y < LANCET.length; y++) {
    for (let x = 0; x < LANCET[y].length; x++) {
      const c = LANCET[y][x];
      if (c === ".") continue;
      const fill = c === "k" ? "currentColor" : c === "l" ? "var(--paper, #f4ecd8)" : glass;
      cells.push(<rect key={`${x},${y}`} x={x} y={y} width={1} height={1} fill={fill} />);
    }
  }
  return (
    <svg className={className} viewBox="0 0 7 11" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      {cells}
    </svg>
  );
}
