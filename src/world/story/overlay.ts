// The quest drawn over the frame: five quatrefoils in the top-left corner with the count in words (each filled with its
// piece's colour as it is found), the moment of a find (its piece flies from its place to its slot),
// and the arrow to the next thing, at the frame's edge or floating over it (arrow.ts says where). In the guides'
// pixel colours (controls/glyphs.ts), drawn after the dragon and the guide.

import { blit } from "../controls/blit.ts";
import { blank, GOLD, haloed, INK, PAPER, PAPER_WASH, PIECE_SLOTS, text, VERMILION, VERMILION_DARK, type Sprite } from "../controls/glyphs.ts";
import { KEEPSAKE } from "../../components/terminal/content.ts";
import { pcos, PI, psin } from "../core/psin.ts";
import type { arrowAt } from "./arrow.ts";
import type { QuestState } from "./quest.ts";
import { STOPS, type StopKey } from "./stops.ts";

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
/** Each slot filled with its own piece's colour. */
const FULL = STOPS.map((_, i) => quatrefoil(PIECE_SLOTS[i]));
/** A slot as its piece lands in it: one frame of gold. */
const PRESSED = quatrefoil(GOLD);

/** A piece in flight: a cut glass in its colour, inked round and haloed in paper so it reads over any land, 9 px. */
function gem(slot: number): Sprite {
  const rows = ["...k...", "..kck..", ".kcLck.", "kcLLcck", ".kccck.", "..kck..", "...k..."];
  const s = blank(7, 7);
  for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
    const c = rows[y][x];
    if (c === "k") s.px[y * 7 + x] = INK;
    else if (c === "c") s.px[y * 7 + x] = slot;
    else if (c === "L") s.px[y * 7 + x] = PAPER;
  }
  return haloed(s);
}
const GEMS = STOPS.map((_, i) => gem(PIECE_SLOTS[i]));

/** A find being taken: which, where its piece sat on the frame this frame, and seconds since the landing. */
export interface Taking {
  key: StopKey;
  from: { x: number; y: number };
  since: number;
}

/** The piece rises out of its place over LIFT s, flies to its slot by ARRIVE s, and the line names it until SHOW s. */
export const LIFT = 0.4;
export const ARRIVE = 1.1;
export const SHOW = 4.5;
/** Steps of the lift and of the flight: the piece moves by whole hops, never glides. */
const LIFT_STEPS = 4;
const FLY_STEPS = 8;

/**
 * The arrow pointing east, as a shape: a notched pointer, vermilion inside, inked round. Sampled turned to each of
 * TURNS directions.
 */
function inArrow(u: number, v: number): number {
  // A pointer: one broad triangle, its tip at +7, its back notched so it reads as pointing, not as a kite.
  const back = -5 + 2.2 * (1 - Math.abs(v) / 6.5);
  const out = u <= 7.5 && u >= back - 0.6 && Math.abs(v) <= (7.5 - u) * 0.62;
  if (!out) return 0;
  const inside = u <= 5.8 && u >= back + 0.9 && Math.abs(v) <= (5.8 - u) * 0.62 - 0.4;
  return inside ? VERMILION : INK;
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

const FOILS_W = STOPS.length * FOIL + (STOPS.length - 1) * FOIL_GAP;
/** The plate under the count: the quatrefoils, then the count in words, "keepsakes 2/5". */
const labelOf = (n: number): Sprite => text(`${KEEPSAKE.many} ${n}/${STOPS.length}`);
const LABEL_W = labelOf(STOPS.length).w;
const COUNT_W = FOILS_W + 4 + LABEL_W + 4;
const PLATE = plate(COUNT_W, FOIL + 4);
/** The slot of each stop, its top-left in the frame. */
function slotAt(i: number): { x: number; y: number } {
  return { x: MARGIN + i * (FOIL + FOIL_GAP), y: MARGIN };
}

/**
 * Draws the quest into the fw × fh frame `out`: the count while the visitor is on the quest, and the arrow when there
 * is one. `t` in seconds bobs the floating arrow; under `reduced` motion it holds still.
 */
export function drawQuest(
  out: Uint32Array, fw: number, fh: number, quest: QuestState, arrow: ReturnType<typeof arrowAt> | null, t: number, reduced: boolean,
  taking: Taking | null = null,
): void {
  // A find is shown whether or not the visitor follows the quest: the count comes up for it.
  const moment = taking !== null && taking.since < SHOW;
  if (quest.mode !== "on" && !moment) return;
  const arrived = !moment || taking.since >= ARRIVE;
  let n = 0;
  for (const k of quest.found) if (arrived || k !== taking?.key) n++;
  blit(out, fw, fh, PLATE, MARGIN - 2, MARGIN - 2, 0.85);
  for (let i = 0; i < STOPS.length; i++) {
    const key = STOPS[i].key;
    let found = quest.found.includes(key);
    let sprite = found ? FULL[i] : EMPTY;
    if (moment && key === taking.key) {
      found = taking.since >= ARRIVE;
      // The frame it lands, the slot shows gold; after, its own colour.
      sprite = !found ? EMPTY : taking.since < ARRIVE + 0.12 ? PRESSED : FULL[i];
    }
    const at = slotAt(i);
    blit(out, fw, fh, sprite, at.x, at.y);
  }
  blit(out, fw, fh, labelOf(n), MARGIN + FOILS_W + 3, MARGIN);
  if (moment) {
    const i = STOPS.findIndex((st) => st.key === taking.key);
    if (taking.since < ARRIVE) {
      // Out of its place by hops, then across the frame to its slot by hops.
      let x: number, y: number;
      if (taking.since < LIFT) {
        const k = Math.floor((taking.since / LIFT) * LIFT_STEPS) / LIFT_STEPS;
        x = taking.from.x;
        y = taking.from.y - Math.round(10 * k);
      } else {
        const k = Math.min(1, Math.ceil(((taking.since - LIFT) / (ARRIVE - LIFT)) * FLY_STEPS) / FLY_STEPS);
        const to = slotAt(i);
        const sx = taking.from.x, sy = taking.from.y - 10;
        x = Math.round(sx + (to.x + 3 - sx) * k);
        y = Math.round(sy + (to.y + 3 - sy) * k);
      }
      blit(out, fw, fh, GEMS[i], x - 4, y - 4);
    } else {
      // The line that names it, under the count, until it has been read.
      const line = text(`${STOPS[i].name}: ${KEEPSAKE.one} ${n} of ${STOPS.length}`);
      const pad = plate(line.w + 6, line.h + 4);
      blit(out, fw, fh, pad, MARGIN - 2, MARGIN + FOIL + 4, 0.85);
      blit(out, fw, fh, line, MARGIN + 1, MARGIN + FOIL + 6);
    }
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
  void VERMILION_DARK;
  x = Math.max(0, Math.min(fw - BOX, x));
  y = Math.max(0, Math.min(fh - BOX, y));
  blit(out, fw, fh, s, x, y);
}
