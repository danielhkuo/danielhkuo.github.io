// Study A, the river-dragon: long and wingless. A horned head with streaming whiskers and a mane, a body of rings
// strung along the head's path with a slow wave travelling down it, two pairs of small clawed feet, and a feathered
// tail tip. About 80 pixels from snout to tail.

import type { ViewRect } from "../render/compose.ts";
import type { FlightState } from "../runtime/flight.ts";
import { ringsOf, skinOf, smooth, type Pose, type Rings } from "./body.ts";
import { LACQUER, type Look } from "./look.ts";
import { castShadow, drawGroup, drawStrand, figure, pieceOf, place, type Land, type Piece } from "./parts.ts";
import { ball, limb, put, vox } from "./vox.ts";

/** Body rings behind the head, and the path between them, cells. */
export const RIVER_RINGS = 22;
export const RIVER_SPACING = 2.6;
/** No pixel of the study is drawn farther than this from the head's screen position. */
export const RIVER_REACH = 92;

/** The path is sampled at half the ring spacing: the whiskers and mane use the points between. */
const FINE = RIVER_SPACING / 2;
/** Fine points from the head's centre to the first ring. */
const NECK = 3;
const JOINTS = NECK + 2 * RIVER_RINGS + 6;
/** The wave: its length along the body (cells) and its greatest swing to either side. */
const WAVE_LENGTH = 40;
const WAVE_SWING = 5;
const WHISKER_POINTS = 16;
const MANE_RINGS = 7;
const FRONT_FEET = 4;
const HIND_FEET = 14;

/** Radius of ring i: a slim neck, a fuller chest, a long taper to the tail. */
function ringRadius(i: number): number {
  const u = i / (RIVER_RINGS - 1);
  if (u < 0.2) return 2.3 + (3.1 - 2.3) * smooth(u / 0.2);
  const v = (u - 0.2) / 0.8;
  return 3.1 - (3.1 - 1.3) * v * Math.sqrt(v);
}

function headPiece(look: Look): Piece {
  const v = vox(9, 8, 8);
  const skin = skinOf(look);
  // Jaw and chin under, skull and snout over.
  ball(v, 3.5, 0, 1, 4.6, 2, 1, () => look.belly);
  ball(v, 0, 0, 2.8, 3.6, 3.3, 2.4, skin);
  ball(v, 4.6, 0, 2.4, 3.9, 2.2, 1.5, skin);
  put(v, 8, 0, 3, look.bodyLight);
  put(v, 7, -1, 3, look.scale);
  put(v, 7, 1, 3, look.scale);
  for (const side of [-1, 1]) {
    // Cheek fins, swept back.
    limb(v, -2, side * 3, 2, -5, side * 6, 2, 0.6, 0.6, (x) => (x < -3 ? look.mane : look.maneDark));
    // Eyes under gold brows.
    put(v, 2, side * 2, 4, look.tip);
    put(v, 3, side * 2, 4, look.ink);
    put(v, 1, side * 2, 5, look.mane);
    // Horns: back and up, pale at the tips, with one short prong.
    limb(v, -1, side * 2, 5, -7, side * 3.4, 7, 0.6, 0.6, (x) => (x < -4 ? look.tip : look.mane));
    put(v, -4, side * 4, 6, look.mane);
    put(v, -5, side * 5, 6, look.tip);
  }
  // The mane begins on the crown.
  limb(v, 0, 0, 5, -4, 0, 5, 0.6, 0.6, () => look.maneLight);
  return pieceOf(v, look.ink);
}

/** A lock of the mane: a flame lying back along the spine. */
function lockPiece(look: Look, length: number, r: number): Piece {
  const v = vox(Math.ceil(length) + 1, Math.ceil(r) + 1, 2);
  limb(v, 1, 0, 0, -length, 0, 0, r, 0.5, () => look.mane);
  limb(v, 0, 0, 1, -length + 1, 0, 1, Math.max(0.5, r - 0.7), 0.5, () => look.maneLight);
  return pieceOf(v, look.ink);
}

/** A pair of feet for a body of radius r: short legs trailing back, three claws each. */
function feetPiece(look: Look, r: number): Piece {
  const v = vox(6, Math.ceil(r) + 5, 2);
  for (const side of [-1, 1]) {
    limb(v, 0, side * (r - 0.5), 0, -3, side * (r + 2), 0, 1, 0.8, () => look.bodyDark);
    limb(v, 0, side * (r - 0.5), 1, -2, side * (r + 1.4), 1, 0.8, 0.6, () => look.body);
    put(v, -4, side * (r + 1), 0, look.mane);
    put(v, -5, side * (r + 2), 0, look.tip);
    put(v, -4, side * (r + 3), 0, look.mane);
    put(v, -3, side * (r + 4), 0, look.tip);
  }
  return pieceOf(v, look.ink);
}

/** The tail tip: a plume of five feathers fanned back, pale at their ends. */
function fanPiece(look: Look): Piece {
  const v = vox(12, 8, 2);
  const feather = (x: number): number => (x < -9 ? look.tip : x < -5 ? look.maneLight : x < 0 ? look.mane : look.body);
  for (const side of [-1, 1]) {
    limb(v, 1, 0, 0, -6, side * 6, 0, 1.2, 0.9, feather);
    limb(v, 1, 0, 0, -9, side * 3, 0, 1.5, 1, feather);
  }
  limb(v, 4, 0, 0, -11, 0, 0, 1.6, 1, feather);
  limb(v, 3, 0, 1, -7, 0, 1, 0.6, 0.6, () => look.maneDark);
  return pieceOf(v, look.ink);
}

interface Kit {
  head: Piece;
  rings: Rings;
  locks: Piece[];
  frontFeet: Piece;
  hindFeet: Piece;
  fan: Piece;
  strand: number[];
}

const kits = new Map<Look, Kit>();

function kitOf(look: Look): Kit {
  let k = kits.get(look);
  if (!k) {
    const strand: number[] = [];
    for (let i = 0; i < WHISKER_POINTS - 1; i++) strand.push(i < 4 ? look.mane : look.tip);
    k = {
      head: headPiece(look),
      rings: ringsOf(look),
      locks: [lockPiece(look, 4, 1), lockPiece(look, 4, 0.8), lockPiece(look, 3, 0.6)],
      frontFeet: feetPiece(look, ringRadius(FRONT_FEET)),
      hindFeet: feetPiece(look, ringRadius(HIND_FEET)),
      fan: fanPiece(look),
      strand,
    };
    kits.set(look, k);
  }
  return k;
}

const fig = figure(RIVER_RINGS + MANE_RINGS + 8);
const px = new Float64Array(JOINTS), py = new Float64Array(JOINTS), pa = new Float64Array(JOINTS), ph = new Float64Array(JOINTS);
const whisker = new Float64Array(WHISKER_POINTS * 3);

/**
 * Draws the river-dragon with its head at the flier: its shadow, then the tail fan, the rings from tail to neck
 * (feet under their rings), the mane, the head, and the two whiskers. The body lies along pose.chain, swung to
 * either side by a wave of phase pose.wave. Every pixel is depth-tested against the land.
 */
export function drawRiver(out: Uint32Array, rect: ViewRect, s: FlightState, view: Land, pose: Pose, look: Look = LACQUER): void {
  const kit = kitOf(look), n = pose.n;
  const joints = pose.chain.joints(JOINTS, FINE);
  const k = (2 * Math.PI) / WAVE_LENGTH;
  for (let j = 0; j < JOINTS; j++) {
    const jt = joints[j], d = j * FINE;
    const amp = WAVE_SWING * smooth(d / 22), arg = pose.wave - d * k;
    const off = amp * Math.sin(arg);
    const sin = Math.sin(jt.heading), cos = Math.cos(jt.heading);
    px[j] = jt.x - sin * off;
    py[j] = jt.y + cos * off;
    pa[j] = jt.alt + 0.25 * amp * Math.cos(arg);
    ph[j] = jt.heading + Math.atan(amp * k * Math.cos(arg));
  }

  fig.count = 0;
  const tail = NECK + 2 * RIVER_RINGS;
  place(fig, kit.fan, px[tail], py[tail], pa[tail] - 1, ph[tail] + 0.25 * Math.sin(pose.wave * 2));
  for (let i = RIVER_RINGS - 1; i >= 0; i--) {
    const j = NECK + 2 * i, r = ringRadius(i);
    const ring = kit.rings.get(r, i % 2 === 1, i >= MANE_RINGS && i % 3 === 0 && i < RIVER_RINGS - 3);
    const base = pa[j] - ring.stack.layers * 0.5;
    if (i === FRONT_FEET) place(fig, kit.frontFeet, px[j], py[j], base, ph[j]);
    if (i === HIND_FEET) place(fig, kit.hindFeet, px[j], py[j], base, ph[j]);
    place(fig, ring, px[j], py[j], base, ph[j]);
  }
  for (let i = MANE_RINGS - 1; i >= 0; i--) {
    const j = NECK + 2 * i + 1;
    const sway = 0.5 * Math.sin(pose.wave * 2.3 - i * 1.1);
    const lock = kit.locks[i < 2 ? 0 : i < 5 ? 1 : 2];
    place(fig, lock, px[j], py[j], pa[j] + 1.5, ph[j] + sway);
  }
  const body = fig.count;
  place(fig, kit.head, s.x, s.y, s.alt - 3, s.heading);

  castShadow(out, rect, view, fig, n);
  drawGroup(out, rect, view, fig, 0, body, n);
  drawGroup(out, rect, view, fig, body, fig.count, n);

  // Whiskers: from either side of the snout, streaming back along the path and outwards, rippling at the tips.
  const hs = Math.sin(s.heading), hc = Math.cos(s.heading);
  for (const side of [-1, 1]) {
    whisker[0] = s.x + 6 * hc - side * 2 * hs;
    whisker[1] = s.y + (6 * hs + side * 2 * hc) / 0.8;
    whisker[2] = s.alt;
    for (let i = 1; i < WHISKER_POINTS; i++) {
      const jt = joints[i - 1];
      const out2 = side * (3.6 + 0.55 * i) + 0.18 * i * Math.sin(pose.wave * 2.6 - i * 0.6 + side);
      whisker[i * 3] = jt.x - Math.sin(jt.heading) * out2;
      whisker[i * 3 + 1] = jt.y + Math.cos(jt.heading) * out2;
      whisker[i * 3 + 2] = jt.alt + 1;
    }
    drawStrand(out, rect, view, whisker, WHISKER_POINTS, kit.strand, n);
  }
}
