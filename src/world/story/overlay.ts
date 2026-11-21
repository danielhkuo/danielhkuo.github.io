// The quest drawn over the frame: a five-lobed rose window in the top-left corner with the count in words (a lobe
// takes its pane's colour as it is found), the moment of a find (its pane flies from its place to its lobe),
// and the arrow to the next thing, at the frame's edge or floating over it (arrow.ts says where). In the guides'
// pixel colours (controls/glyphs.ts), drawn after the dragon and the guide.

import { blit } from "../controls/blit.ts";
import { blank, GOLD, haloed, INK, INK_SOFT, PAPER, PAPER_WASH, PIECE_SLOTS, text, VERMILION, VERMILION_DARK, type Sprite } from "../controls/glyphs.ts";
import { GLASS } from "../../components/terminal/content.ts";
import { pcos, PI, psin } from "../core/psin.ts";
import { NO_INSETS, type Insets } from "../mobile/layout.ts";
import { ROSE_LIGHTS } from "../gen/monuments.ts";
import type { arrowAt } from "./arrow.ts";
import type { QuestState } from "./quest.ts";
import { STOPS, type StopKey } from "./stops.ts";

/** Directions the arrow is drawn in: one sprite each, made once. */
const TURNS = 16;
/** The arrow's box, px a side. */
const BOX = 19;
/** The corner the count sits in, px from the frame's top-left. */
const MARGIN = 5;
/** The floating arrow bobs this many px over this many seconds. */
const BOB = 2;
const BOB_PERIOD = 1.2;

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

/** The plate under the count: a paper wash, so the rose reads over any land. */
function plate(w: number, h: number): Sprite {
  const s = blank(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const corner = (x === 0 || x === w - 1) && (y === 0 || y === h - 1);
    if (!corner) s.px[y * w + x] = PAPER_WASH;
  }
  return s;
}

/**
 * The rose window the count is drawn as: the hall's own window (gen/monuments.ts) drawn as a badge, a
 * dark ring round pale stone tracery, its five lights mid stone until glazed, a gold boss at the heart.
 */
const ROSE = 21;
const ROSE_C = 10;
/** Each light's centre in the rose's box: the first at the top, then round clockwise, evenly, as the window's are. */
const LOBES = ROSE_LIGHTS.map((_, i) => {
  const a = -PI / 2 + (i * 2 * PI) / ROSE_LIGHTS.length;
  return { x: ROSE_C + 5.4 * pcos(a), y: ROSE_C + 5.4 * psin(a) };
});
/** The rose with the lights in `fills` glazed (a palette slot each, 0 for unglazed). */
function rose(fills: readonly number[]): Sprite {
  const s = blank(ROSE, ROSE);
  for (let y = 0; y < ROSE; y++) for (let x = 0; x < ROSE; x++) {
    const dx = x - ROSE_C, dy = y - ROSE_C, d = Math.sqrt(dx * dx + dy * dy);
    if (d > ROSE_C + 0.5) continue;
    let c: number;
    if (d > ROSE_C - 1) c = INK;
    else if (d < 1.6) c = GOLD;
    else {
      // Each light the same rounded lobe, turned to point at the ring; the stone between them is the tracery.
      // Unglazed, a light is mid stone, waiting for glass.
      c = PAPER_WASH;
      for (let k = 0; k < LOBES.length; k++) {
        const lx = x - LOBES[k].x, ly = y - LOBES[k].y;
        const ox = (LOBES[k].x - ROSE_C) / 5.4, oy = (LOBES[k].y - ROSE_C) / 5.4;
        const along = lx * ox + ly * oy, across = -lx * oy + ly * ox;
        if ((along * along) / (2.6 * 2.6) + (across * across) / (2.4 * 2.4) <= 1) { c = fills[k] === 0 ? INK_SOFT : fills[k]; break; }
      }
    }
    s.px[y * ROSE + x] = c;
  }
  return s;
}
/** Roses by which lobes are filled (a bit each) and which, if any, shows gold as its pane lands. */
const roses = new Map<number, Sprite>();
function roseFor(mask: number, pressed: number): Sprite {
  const id = mask * 8 + (pressed + 1);
  let s = roses.get(id);
  if (!s) {
    s = rose(STOPS.map((_, i) => (i === pressed ? GOLD : mask & (1 << i) ? PIECE_SLOTS[i] : 0)));
    roses.set(id, s);
  }
  return s;
}
const FOILS_W = ROSE;
/** The plate under the count: the rose, then the count in words, "glass 2/5". */
const labelOf = (n: number): Sprite => text(`${GLASS.short} ${n}/${STOPS.length}`);
const LABEL_W = labelOf(STOPS.length).w;
const COUNT_W = FOILS_W + 4 + LABEL_W + 4;
const PLATE = plate(COUNT_W, ROSE + 4);
/** Each stop's lobe, its top-left as a 7-px slot in the frame (its centre is 3 px in), from the count's corner. */
function slotAt(i: number, cornerX: number, cornerY: number): { x: number; y: number } {
  return { x: cornerX + Math.round(LOBES[i].x) - 3, y: cornerY + Math.round(LOBES[i].y) - 3 };
}

/**
 * Draws the quest into the fw × fh frame `out`: the count while the visitor is on the quest, and the arrow when there
 * is one. `t` in seconds bobs the floating arrow; under `reduced` motion it holds still. `inset`, in frame pixels,
 * moves the count in from the corner and keeps the arrow inside the safe frame.
 */
export function drawQuest(
  out: Uint32Array, fw: number, fh: number, quest: QuestState, arrow: ReturnType<typeof arrowAt> | null, t: number, reduced: boolean,
  taking: Taking | null = null,
  inset: Insets = NO_INSETS,
): void {
  // A find is shown whether or not the visitor follows the quest: the count comes up for it.
  const moment = taking !== null && taking.since < SHOW;
  if (quest.mode !== "on" && !moment) return;
  // The count sits in the top-left of the safe frame. With no inset the corner is where it always was.
  const cornerX = inset.left + MARGIN;
  const cornerY = inset.top + MARGIN;
  const arrived = !moment || taking.since >= ARRIVE;
  let n = 0;
  for (const k of quest.found) if (arrived || k !== taking?.key) n++;
  blit(out, fw, fh, PLATE, cornerX - 2, cornerY - 2, 0.85);
  let mask = 0, pressed = -1;
  for (let i = 0; i < STOPS.length; i++) {
    const key = STOPS[i].key;
    let found = quest.found.includes(key);
    if (moment && key === taking.key) {
      found = taking.since >= ARRIVE;
      // For a moment as its pane lands, the lobe shows gold and the rose is pressed down a pixel; then its colour.
      if (found && taking.since < ARRIVE + 0.12) pressed = i;
    }
    if (found) mask |= 1 << i;
  }
  blit(out, fw, fh, roseFor(mask, pressed), cornerX, cornerY + (pressed >= 0 ? 1 : 0));
  blit(out, fw, fh, labelOf(n), cornerX + FOILS_W + 3, cornerY + ((ROSE - 7) >> 1));
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
        const to = slotAt(i, cornerX, cornerY);
        const sx = taking.from.x, sy = taking.from.y - 10;
        x = Math.round(sx + (to.x + 3 - sx) * k);
        y = Math.round(sy + (to.y + 3 - sy) * k);
      }
      blit(out, fw, fh, GEMS[i], x - 4, y - 4);
    } else {
      // The line that names it, under the count, until it has been read.
      const line = text(`${STOPS[i].name}: ${GLASS.one} ${n} of ${STOPS.length}`);
      const pad = plate(line.w + 6, line.h + 4);
      blit(out, fw, fh, pad, cornerX - 2, cornerY + ROSE + 4, 0.85);
      blit(out, fw, fh, line, cornerX + 1, cornerY + ROSE + 6);
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
  if (arrow.mode === "edge" && x < cornerX + COUNT_W && y < cornerY + ROSE + 4) y = cornerY + ROSE + 6;
  void VERMILION_DARK;
  // The sprite stays inside the safe frame, clear of a notch, the corners and the home indicator.
  x = Math.max(inset.left, Math.min(fw - inset.right - BOX, x));
  y = Math.max(inset.top, Math.min(fh - inset.bottom - BOX, y));
  blit(out, fw, fh, s, x, y);
}
