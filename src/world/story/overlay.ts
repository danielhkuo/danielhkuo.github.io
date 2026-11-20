// The quest drawn over the frame: five quatrefoils in the top-left corner (filled vermilion as each thing is found),
// and the arrow to the next thing, at the frame's edge or floating over it (arrow.ts says where). In the guides'
// pixel colours (controls/glyphs.ts), drawn after the dragon and the guide.

import { blit } from "../controls/blit.ts";
import { blank, GOLD, INK, PAPER, PAPER_WASH, VERMILION, VERMILION_DARK, type Sprite } from "../controls/glyphs.ts";
import { pcos, PI, psin } from "../core/psin.ts";
import type { arrowAt } from "./arrow.ts";
import type { QuestState } from "./quest.ts";
import { STOPS } from "./stops.ts";

/** Directions the arrow is drawn in: one sprite each, made once. */
const TURNS = 16;
/** The arrow's box, px a side. */
const BOX = 19;
/** One quatrefoil's box, and the gap between them. */
const FOIL = 7;
const FOIL_GAP = 2;
/** The corner the count sits in, px from the frame's top-left. */
const MARGIN = 5;
/** The floating arrow bobs this many px over this many seconds. */
const BOB = 2;
const BOB_PERIOD = 1.2;

/** A quatrefoil, 7 px: four lobes round a centre, inked round, filled `fill`. */
function quatrefoil(fill: number): Sprite {
  const rows = [
    "..xxx..",
    ".xfffx.",
    "xxfffxx",
    "xfffffx",
    "xxfffxx",
    ".xfffx.",
    "..xxx..",
  ];
  // The four lobes: pinch the middle of each side so the shape reads as four, not one.
  const s = blank(FOIL, FOIL);
  for (let y = 0; y < FOIL; y++) for (let x = 0; x < FOIL; x++) {
    const c = rows[y][x];
    if (c === "x") s.px[y * FOIL + x] = INK;
    else if (c === "f") s.px[y * FOIL + x] = fill;
  }
  s.px[3 * FOIL + 3] = fill === VERMILION ? GOLD : fill;
  return s;
}

const EMPTY = quatrefoil(PAPER);
const FULL = quatrefoil(VERMILION);

/**
 * The arrow pointing east, as a shape: a broad head and a short shaft. Inside the head and shaft is vermilion, the
 * rim ink. Sampled turned to each of TURNS directions.
 */
function inArrow(u: number, v: number): number {
  // u along the arrow (head at +), v across it, px from the box's centre.
  const head = u >= -0.5 && u <= 7.5 && Math.abs(v) <= (7.5 - u) * 0.9;
  const shaft = u >= -7.5 && u < 0 && Math.abs(v) <= 2.1;
  if (!head && !shaft) return 0;
  const headIn = u >= 0.6 && u <= 6.3 && Math.abs(v) <= (6.3 - u) * 0.9 - 0.3;
  const shaftIn = u >= -6.4 && u < 1 && Math.abs(v) <= 1.1;
  return headIn || shaftIn ? VERMILION : INK;
}

function arrowSprite(angle: number): Sprite {
  const s = blank(BOX, BOX);
  const c = pcos(angle), sn = psin(angle), mid = (BOX - 1) / 2;
  for (let y = 0; y < BOX; y++) for (let x = 0; x < BOX; x++) {
    const dx = x - mid, dy = y - mid;
    s.px[y * BOX + x] = inArrow(dx * c + dy * sn, -dx * sn + dy * c);
  }
  // A paper halo round the ink, so it reads over dark woods as over pale fields.
  const rim = s.px.slice();
  for (let y = 0; y < BOX; y++) for (let x = 0; x < BOX; x++) {
    if (rim[y * BOX + x] !== 0) continue;
    const near = (x > 0 && rim[y * BOX + x - 1] === INK) || (x < BOX - 1 && rim[y * BOX + x + 1] === INK)
      || (y > 0 && rim[(y - 1) * BOX + x] === INK) || (y < BOX - 1 && rim[(y + 1) * BOX + x] === INK);
    if (near) s.px[y * BOX + x] = PAPER;
  }
  // A dark keel under the vermilion: the lit side and the shaded side.
  for (let i = 0; i < s.px.length; i++) {
    if (s.px[i] !== VERMILION) continue;
    const below = i + BOX;
    if (below < s.px.length && s.px[below] === INK) s.px[i] = VERMILION_DARK;
  }
  return s;
}

const ARROWS: Sprite[] = [];
for (let k = 0; k < TURNS; k++) ARROWS.push(arrowSprite((2 * PI * k) / TURNS));

/** The arrow sprite nearest `angle` (radians, 0 east, π/2 down the screen). */
export function arrowFor(angle: number): Sprite {
  const k = Math.round((angle / (2 * PI)) * TURNS);
  return ARROWS[((k % TURNS) + TURNS) % TURNS];
}

/** The plate under the count: a paper wash, so the quatrefoils read over any land. */
function plate(w: number, h: number): Sprite {
  const s = blank(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const corner = (x === 0 || x === w - 1) && (y === 0 || y === h - 1);
    if (!corner) s.px[y * w + x] = PAPER_WASH;
  }
  return s;
}

const COUNT_W = STOPS.length * FOIL + (STOPS.length - 1) * FOIL_GAP + 4;
const PLATE = plate(COUNT_W, FOIL + 4);

/**
 * Draws the quest into the fw × fh frame `out`: the count while the visitor is on the quest, and the arrow when there
 * is one. `t` in seconds bobs the floating arrow; under `reduced` motion it holds still.
 */
export function drawQuest(
  out: Uint32Array, fw: number, fh: number, quest: QuestState, arrow: ReturnType<typeof arrowAt> | null, t: number, reduced: boolean,
): void {
  if (quest.mode !== "on") return;
  blit(out, fw, fh, PLATE, MARGIN - 2, MARGIN - 2, 0.85);
  for (let i = 0; i < STOPS.length; i++) {
    const found = quest.found.includes(STOPS[i].key);
    blit(out, fw, fh, found ? FULL : EMPTY, MARGIN + i * (FOIL + FOIL_GAP), MARGIN);
  }
  if (!arrow) return;
  const s = arrowFor(arrow.angle);
  let bob = 0;
  if (arrow.mode === "over" && !reduced) {
    const p = (t % BOB_PERIOD) / BOB_PERIOD;
    bob = Math.round(BOB * psin(2 * PI * p));
  }
  // In the corner the count stands in, the arrow moves out of its way.
  let x = arrow.x - (BOX >> 1), y = arrow.y - (BOX >> 1) + bob;
  if (arrow.mode === "edge" && x < MARGIN + COUNT_W && y < MARGIN + FOIL + 4) y = MARGIN + FOIL + 6;
  x = Math.max(0, Math.min(fw - BOX, x));
  y = Math.max(0, Math.min(fh - BOX, y));
  blit(out, fw, fh, s, x, y);
}
