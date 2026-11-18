// Study B, the winged dragon: a compact body with broad wings that beat twice and then glide, a horned head on a
// short neck, and a tail of rings that follows the path. About 40 pixels long and 34 across the wings.

import type { ViewRect } from "../render/compose.ts";
import type { FlightState } from "../runtime/flight.ts";
import { leafPiece, ringsOf, skinOf, smooth, type Pose, type Rings } from "./body.ts";
import { LACQUER, type Look } from "./look.ts";
import { castShadow, drawGroup, figure, pieceOf, place, type Land, type Piece } from "./parts.ts";
import { ball, filled, limb, put, vox } from "./vox.ts";

/** No pixel of the study is drawn farther than this from the flier's screen position. */
export const WINGED_REACH = 44;
/** Seconds: one wingbeat, and the whole cycle of two beats and a glide. */
export const WINGED_BEAT = 0.8;
export const WINGED_CYCLE = 3.6;

const SPAN = 18;
const FLAP_STEPS = 4;
const TAIL_RINGS = 7;
const TAIL_START = 10;
const TAIL_SPACING = 2.2;

/** The wing's outline seen from above, by distance s along the span: its leading and trailing edges (x). */
function lead(s: number): number {
  return s < 7 ? 2 + 5 * (s / 7) : 7 - 10 * Math.pow((s - 7) / (SPAN - 7), 1.4);
}
function trail(s: number): number {
  const u = s / SPAN;
  return -8 + 6 * u * u * u + 1.8 * Math.abs(Math.sin((Math.PI * s) / 6));
}

/** The body and wings with the wings at `flap` (−1 down … 1 up) and the body rolled by `roll` (−1 left … 1 right). */
function bodyPiece(look: Look, flap: number, roll: number): Piece {
  const v = vox(19, 21, 12);
  const skin = skinOf(look);
  // Wings first, so the body covers their roots.
  const fold = flap > 0 ? 1 - 0.28 * flap : 1;
  for (const side of [-1, 1]) {
    for (let s = 0; s <= SPAN; s += 0.34) {
      const theta = 0.3 * flap * (0.3 + 0.7 * (s / SPAN)) - side * roll * 0.12;
      const y = side * (2 + s * fold * Math.cos(theta)), z = 5 + s * fold * Math.sin(theta);
      const sweep = flap > 0 ? 0.22 * flap * s : 0;
      const x1 = lead(s), x0 = Math.min(trail(s), x1);
      for (let x = x0; x <= x1; x += 0.5) {
        const rib = Math.abs(s - 6) < 0.4 || Math.abs(s - 12) < 0.4;
        const c = x > x1 - 1.3 ? look.mane : x < x0 + 0.9 || rib ? look.wingDark : look.wing;
        put(v, x - sweep, y, z, c);
      }
    }
    // The claw at the wrist.
    put(v, 8 - (flap > 0 ? 1.5 * flap : 0), side * (2 + 7 * fold), 5 + 7 * fold * Math.sin(0.3 * flap * 0.57), look.tip);
  }
  // Tail root, torso, belly, neck, head.
  limb(v, -4, 0, 4, -9, 0, 4, 2.3, 1.7, skin);
  ball(v, 0, 0, 4.2, 5.4, 3.1, 2.4, skin);
  ball(v, 0, 0, 2, 4.4, 2.2, 0.8, () => look.belly);
  limb(v, 4, 0, 4.4, 9, 0, 5, 2, 1.7, skin);
  ball(v, 11.5, 0, 5, 3.2, 2.9, 2, skin);
  ball(v, 14.8, 0, 4.6, 2.8, 1.8, 1.2, skin);
  put(v, 17, 0, 5, look.bodyLight);
  put(v, 16, -1, 5, look.scale);
  put(v, 16, 1, 5, look.scale);
  for (const side of [-1, 1]) {
    put(v, 13, side * 2, 6, look.tip);
    put(v, 14, side * 2, 6, look.ink);
    limb(v, 10.5, side * 2, 6, 5, side * 4.5, 8, 0.6, 0.6, (x) => (x < 7.5 ? look.tip : look.mane));
    limb(v, 10, side * 3, 5, 8, side * 5, 5, 0.6, 0.6, () => look.mane);
  }
  // Spines down the back.
  for (let x = 8; x >= -8; x -= 2) {
    let top = 11;
    while (top > 0 && !filled(v, x, 0, top)) top--;
    put(v, x, 0, top + 1, look.mane);
  }
  return pieceOf(v, look.ink);
}

/** The spade at the tail's end, pointing back. */
function spadePiece(look: Look): Piece {
  return leafPiece(look, 5, 2.4);
}

interface Kit {
  bodies: Map<number, Piece>;
  rings: Rings;
  spade: Piece;
}

const kits = new Map<Look, Kit>();

function kitOf(look: Look): Kit {
  let k = kits.get(look);
  if (!k) {
    k = { bodies: new Map(), rings: ringsOf(look), spade: spadePiece(look) };
    kits.set(look, k);
  }
  return k;
}

/** The wings' position at `time`: two beats, then a glide with the wings a little raised. −1 down … 1 up. */
export function wingedFlap(time: number): number {
  let t = time % WINGED_CYCLE;
  if (t < 0) t += WINGED_CYCLE;
  if (t < 2 * WINGED_BEAT) return Math.cos((2 * Math.PI * t) / WINGED_BEAT + 1.2);
  const settle = smooth((t - 2 * WINGED_BEAT) / 0.4), rise = smooth((WINGED_CYCLE - t) / 0.4);
  const from = Math.cos(1.2);
  return (from + (0.2 - from) * settle) * rise + from * (1 - rise);
}

const JOINTS = 2 + Math.ceil((TAIL_START + TAIL_SPACING * (TAIL_RINGS + 1)) / TAIL_SPACING);
const fig = figure(TAIL_RINGS + 4);

/**
 * Draws the winged dragon centred on the flier: its shadow, the tail (rings along pose.chain, a spade at the end),
 * then the body with its wings at wingedFlap(pose.time), rolled into the turn by the flier's bank. Depth-tested.
 */
export function drawWinged(out: Uint32Array, rect: ViewRect, s: FlightState, view: Land, pose: Pose, look: Look = LACQUER): void {
  const kit = kitOf(look), n = pose.n;
  const flap = Math.round(wingedFlap(pose.time) * FLAP_STEPS), roll = s.bank > 0.35 ? 1 : s.bank < -0.35 ? -1 : 0;
  const key = (flap + FLAP_STEPS) * 3 + roll + 1;
  let body = kit.bodies.get(key);
  if (!body) {
    body = bodyPiece(look, flap / FLAP_STEPS, roll);
    kit.bodies.set(key, body);
  }
  const joints = pose.chain.joints(JOINTS, TAIL_SPACING);
  const first = Math.round(TAIL_START / TAIL_SPACING);
  fig.count = 0;
  for (let i = TAIL_RINGS; i >= 0; i--) {
    const jt = joints[first + i], d = i * TAIL_SPACING;
    const arg = pose.wave - d * 0.3, amp = 1.6 * smooth(d / 10);
    const off = amp * Math.sin(arg);
    const x = jt.x - Math.sin(jt.heading) * off, y = jt.y + Math.cos(jt.heading) * off;
    const heading = jt.heading + Math.atan(amp * 0.3 * Math.cos(arg));
    if (i === TAIL_RINGS) place(fig, kit.spade, x, y, jt.alt - 1, heading);
    else {
      const ring = kit.rings.get(1.7 - 0.13 * i, i % 2 === 1, false);
      place(fig, ring, x, y, jt.alt - 1 - ring.stack.layers * 0.5, heading);
    }
  }
  // The body lifts on the downstroke.
  place(fig, body, s.x, s.y, s.alt - 5 - 0.25 * flap, s.heading);
  castShadow(out, rect, view, fig, n);
  drawGroup(out, rect, view, fig, 0, fig.count, n);
}
