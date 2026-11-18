// Study C, the small storybook wyrm: a round body, a big head with wide eyes, little wings that flutter, and a short
// tail with a leaf at its end. About 30 pixels long.

import type { ViewRect } from "../render/compose.ts";
import type { FlightState } from "../runtime/flight.ts";
import { leafPiece, ringsOf, skinOf, smooth, type Pose, type Rings } from "./body.ts";
import { LACQUER, type Look } from "./look.ts";
import { castShadow, drawGroup, figure, pieceOf, place, type Land, type Piece } from "./parts.ts";
import { ball, filled, limb, put, vox } from "./vox.ts";

/** No pixel of the study is drawn farther than this from the flier's screen position. */
export const WYRM_REACH = 28;
/** Seconds for one flutter of the wings, and one bob of the body. */
export const WYRM_BEAT = 0.4;
export const WYRM_BOB = 1.5;

const FLAP_STEPS = 2;
const WING = 8;
const TAIL_RINGS = 5;
const TAIL_START = 7.4;
const TAIL_SPACING = 1.8;

function bodyPiece(look: Look, flap: number): Piece {
  const v = vox(12, 11, 12);
  const skin = skinOf(look);
  // Little bat wings: gold, with a darker arm and a scalloped edge, pale at the tips.
  for (const side of [-1, 1]) {
    for (let s = 0; s <= WING; s += 0.34) {
      const theta = 0.75 * flap, u = s / WING;
      const y = side * (2.5 + s * Math.cos(theta)), z = 5 + s * Math.sin(theta);
      const x1 = -1.5 + 2 * Math.sin(Math.PI * u), x0 = Math.min(x1, -7 + 4.5 * u * u + 1.4 * Math.abs(Math.sin((Math.PI * s) / 4)));
      for (let x = x0; x <= x1; x += 0.5) {
        put(v, x, y, z, s > WING - 1.2 ? look.tip : x > x1 - 1.1 || Math.abs(s - 4) < 0.4 ? look.maneDark : look.mane);
      }
    }
  }
  // A round body with a gold belly; a short neck; a big round head held higher, with a pale snout.
  ball(v, -3, 0, 3.4, 4, 3.5, 2.6, skin);
  ball(v, -3, 0, 1.4, 3.2, 2.6, 0.8, () => look.belly);
  limb(v, 0, 0, 3.6, 3, 0, 4.4, 2.2, 2.2, () => look.bodyDark);
  ball(v, 5.5, 0, 4.8, 3.6, 3.7, 2.9, skin);
  ball(v, 9.2, 0, 3.8, 2.3, 2, 1.4, (_x, _y, _z, t) => (t > 0.4 ? look.bodyLight : look.body));
  put(v, 11, -1, 4, look.scale);
  put(v, 11, 1, 4, look.scale);
  for (const side of [-1, 1]) {
    // Wide eyes on top, small horns swept out behind them, feet tucked under.
    put(v, 6, side * 2, 7, look.tip);
    put(v, 6, side * 3, 7, look.tip);
    put(v, 7, side * 3, 7, look.tip);
    put(v, 7, side * 2, 7, look.ink);
    limb(v, 3, side * 2, 8, 0, side * 5, 9, 0.6, 0.6, (x) => (x < 2 ? look.tip : look.mane));
    put(v, -5, side * 4, 1, look.mane);
    put(v, -2, side * 4, 1, look.mane);
  }
  // Studs down the back.
  for (let x = -2; x >= -6; x -= 2) {
    let top = 10;
    while (top > 0 && !filled(v, x, 0, top)) top--;
    put(v, x, 0, top + 1, look.mane);
  }
  return pieceOf(v, look.ink);
}

interface Kit {
  bodies: Map<number, Piece>;
  rings: Rings;
  leaf: Piece;
}

const kits = new Map<Look, Kit>();

function kitOf(look: Look): Kit {
  let k = kits.get(look);
  if (!k) {
    k = { bodies: new Map(), rings: ringsOf(look), leaf: leafPiece(look, 3, 1.7) };
    kits.set(look, k);
  }
  return k;
}

const JOINTS = 2 + Math.ceil((TAIL_START + TAIL_SPACING * (TAIL_RINGS + 1)) / TAIL_SPACING);
const fig = figure(TAIL_RINGS + 4);

/**
 * Draws the wyrm centred on the flier: its shadow, its wagging tail (rings along pose.chain, a leaf at the end),
 * then the body with its wings fluttering once every WYRM_BEAT seconds and the whole bobbing gently. Depth-tested.
 */
export function drawWyrm(out: Uint32Array, rect: ViewRect, s: FlightState, view: Land, pose: Pose, look: Look = LACQUER): void {
  const kit = kitOf(look), n = pose.n;
  const flap = Math.round(Math.sin((2 * Math.PI * pose.time) / WYRM_BEAT) * FLAP_STEPS);
  let body = kit.bodies.get(flap);
  if (!body) {
    body = bodyPiece(look, flap / FLAP_STEPS);
    kit.bodies.set(flap, body);
  }
  const bob = Math.round(Math.sin((2 * Math.PI * pose.time) / WYRM_BOB));
  const joints = pose.chain.joints(JOINTS, TAIL_SPACING);
  const first = Math.round(TAIL_START / TAIL_SPACING);
  fig.count = 0;
  for (let i = TAIL_RINGS; i >= 0; i--) {
    const jt = joints[first + i], d = (i + 1) * TAIL_SPACING;
    const arg = pose.wave * 2 - d * 0.45, amp = 2.4 * smooth(d / 9);
    const off = amp * Math.sin(arg);
    const x = jt.x - Math.sin(jt.heading) * off, y = jt.y + Math.cos(jt.heading) * off;
    const heading = jt.heading + Math.atan(amp * 0.45 * Math.cos(arg));
    if (i === TAIL_RINGS) place(fig, kit.leaf, x, y, jt.alt - 1 + bob, heading);
    else {
      const ring = kit.rings.get(2.2 - 0.26 * i, i % 2 === 1, false);
      place(fig, ring, x, y, jt.alt - 1 + bob - ring.stack.layers * 0.5, heading);
    }
  }
  place(fig, body, s.x, s.y, s.alt - 4 + bob, s.heading);
  castShadow(out, rect, view, fig, n);
  drawGroup(out, rect, view, fig, 0, fig.count, n);
}
