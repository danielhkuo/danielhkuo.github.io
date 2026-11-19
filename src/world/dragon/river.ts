// The river-dragon: a long serpentine body strung along the head's path, with a face that reads at 1×, a body that
// rolls into its turns and shows its gold belly on the outside of every curve, a mane and whiskers that swing wide and
// settle late, and a feathered tail fin.

import type { ViewRect } from "../render/compose.ts";
import { CRUISE, TURN, type FlightState } from "../runtime/flight.ts";
import { skinOf, smooth, waveRate, RING_STEP, type Pose } from "./body.ts";
import { LACQUER, type Look } from "./look.ts";
import { castShadow, drawGroup, drawStrand, figure, pieceOf, place, type Land, type Piece } from "./parts.ts";
import { ball, filled, limb, put, vox } from "./vox.ts";
import { drawWind, WIND_BACK, windAmount } from "./wind.ts";

/** Body rings behind the head, and the path between them, cells. */
const RINGS = 22;
const SPACING = 2.6;
/** No pixel of the dragon is drawn farther than this from the head's screen position. */
export const RIVER_REACH = 92;

/** The path is sampled at half the ring spacing: the whiskers, the mane and the fin use the points between. */
const FINE = SPACING / 2;
/** Fine points from the head's centre to the first ring. */
const NECK = 3;
/** The fin: pairs of rays every ring spacing on from the last ring, then one long feather. */
const FIN_ROOT = NECK + 2 * RINGS - 1;
const FIN_PAIRS = 5;
const JOINTS = FIN_ROOT + 2 * FIN_PAIRS + 2;
/** The wave: its length along the body (cells) and its greatest swing to either side. */
const WAVE_LENGTH = 40;
const WAVE_SWING = 5;
const WHISKER_POINTS = 16;
const MANE_RINGS = 7;
const FRONT_FEET = 4;
const HIND_FEET = 14;

/** Roll, radians: at full bank, and at the crest of the wave (into the bend, so the belly shows outside it). */
const ROLL_TURN = 0.75;
const ROLL_WAVE = 0.3;
/** Rings are built at rolls this far apart, up to ROLL_STEPS of them either way. */
const ROLL_STEP = 0.15;
const ROLL_STEPS = 7;
/** Path curvature at full bank and cruising speed, radians a cell. */
const FULL_CURVE = TURN / CRUISE;
/** Fine points either side over which the path's curvature is measured. */
const CURVE_SPAN = 3;
/** How far a full bank throws the whisker tips to the outside of the turn, cells; and the mane and fin, radians. */
const WHISKER_THROW = 7;
const MANE_THROW = 0.55;
const FIN_THROW = 0.5;

/** Radius of ring i: a slim neck, a fuller chest, a long taper to the tail. */
function ringRadius(i: number): number {
  const u = i / (RINGS - 1);
  if (u < 0.2) return 2.3 + (3.1 - 2.3) * smooth(u / 0.2);
  const v = (u - 0.2) / 0.8;
  return 3.1 - (3.1 - 1.3) * v * Math.sqrt(v);
}

/**
 * One ring of a body of radius r, rolled `roll` radians about the spine (positive: its back leans to the model's
 * right). The belly is the underside of the rolled body, so a roll turns its gold up on the other side; the light
 * still falls from above. `band` inks a scale edge along its rear rim; `spine` sets a mane-coloured stud on its back.
 */
function rolledRing(look: Look, r: number, band: boolean, spine: boolean, roll: number): Piece {
  const rz = r * 0.625;
  const sin = Math.sin(roll), cos = Math.cos(roll);
  const layers = Math.max(2, Math.round(2 * Math.sqrt(r * r * sin * sin + rz * rz * cos * cos)));
  const half = Math.ceil(r) + 1, zc = (layers - 1) / 2;
  const v = vox(half, half, layers + 1);
  for (let z = 0; z < layers; z++) {
    for (let y = -half; y <= half; y++) {
      // Across and up in the body's own frame.
      const ly = y * cos - (z - zc) * sin, lz = y * sin + (z - zc) * cos;
      const up = lz / rz;
      if (up < -1.2 || up > 1.2) continue;
      const rr = r * Math.sqrt(Math.max(0, 1 - 0.32 * up * up));
      for (let x = -half; x <= half; x++) {
        const d2 = x * x + ly * ly;
        if (d2 > rr * rr + 0.3) continue;
        const rim = d2 > (rr - 1) * (rr - 1);
        let c: number;
        if (up < -0.35) c = z === 0 && rim ? look.bellyDark : look.belly;
        else if (band && x < 0 && d2 > (rr - 1.1) * (rr - 1.1)) c = look.scale;
        else if (z === layers - 1) c = d2 <= (rr - 0.9) * (rr - 0.9) ? look.bodyLight : look.body;
        else c = z < zc ? look.bodyDark : look.body;
        put(v, x, y, z, c);
      }
    }
  }
  if (spine) {
    const y = Math.round(sin * (rz + 0.6));
    let z = layers - 1;
    while (z > 0 && !filled(v, 0, y, z)) z--;
    put(v, 0, y, z + 1, look.mane);
  }
  return pieceOf(v, look.ink, roll === 0);
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
    // Horns: back and up, pale at the tips, with one short prong.
    limb(v, -1, side * 2, 5, -7, side * 3.4, 7, 0.6, 0.6, (x) => (x < -4 ? look.tip : look.mane));
    put(v, -4, side * 4, 6, look.mane);
    put(v, -5, side * 5, 6, look.tip);
    // The face, on the crown where no slice above can hide it: a bright eye under an inked lid.
    put(v, 2, side * 2, 5, look.tip);
    put(v, 3, side * 2, 5, look.tip);
    put(v, 1, side * 2, 5, look.ink);
    put(v, 2, side, 5, look.ink);
    put(v, 3, side, 5, look.ink);
  }
  put(v, 2, 0, 5, look.bodyLight);
  put(v, 3, 0, 5, look.bodyLight);
  // The mane begins on the crown.
  limb(v, 0, 0, 5, -4, 0, 5, 0.6, 0.6, () => look.maneLight);
  return pieceOf(v, look.ink);
}

/** A lock of the mane: a flame lying back along the spine. */
function lockPiece(look: Look, length: number, r: number): Piece {
  const v = vox(Math.ceil(length) + 1, Math.ceil(r) + 1, 2);
  limb(v, 1, 0, 0, -length, 0, 0, r, 0.5, (x) => (x < -length + 1 ? look.maneLight : look.mane));
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

/**
 * A pair of the fin's rays: a chevron swept back `length` and out `width` to either side of the quill, three pixels
 * deep: a dark web, a gold one, and a pale ray along the trailing edge, cream at its end. Strung along the tail a
 * ring apart they overlap into one fin, striped by its rays and notched along its edge like a feather.
 */
function raysPiece(look: Look, length: number, width: number): Piece {
  const v = vox(length + 3, Math.ceil(width) + 1, 1);
  for (const side of [-1, 1]) {
    limb(v, 2, 0, 0, -length + 2, side * width, 0, 0.5, 0.5, () => look.maneDark);
    limb(v, 1, 0, 0, -length + 1, side * width, 0, 0.5, 0.5, () => look.mane);
    limb(v, 0, 0, 0, -length, side * width, 0, 0.5, 0.5, (x) => (x <= -length + 1 ? look.tip : look.maneLight));
  }
  // The quill: the tail carried on down the middle.
  limb(v, 2, 0, 0, 0, 0, 0, 0.5, 0.5, () => look.body);
  return pieceOf(v, look.ink);
}

/** The fin's last feather: long, narrow, pale at its end. */
function featherPiece(look: Look, length: number): Piece {
  const v = vox(length + 1, 1, 1);
  limb(v, 1, 0, 0, -length, 0, 0, 0.9, 0.5, (x) => (x < -length + 2 ? look.tip : x < -2 ? look.maneLight : look.mane));
  return pieceOf(v, look.ink);
}

interface Kit {
  head: Piece;
  rings: Map<number, Piece>;
  locks: Piece[];
  frontFeet: Piece;
  hindFeet: Piece;
  rays: Piece[];
  feather: Piece;
  strand: number[];
}

/** Built kits, most recently used last: a few colourings of the dragon through the day. */
const kits = new Map<Look, Kit>();
const KITS = 4;

function kitOf(look: Look): Kit {
  let k = kits.get(look);
  if (k) {
    kits.delete(look);
    kits.set(look, k);
  }
  if (!k) {
    if (kits.size >= KITS) kits.delete(kits.keys().next().value as Look);
    const strand: number[] = [];
    for (let i = 0; i < WHISKER_POINTS - 1; i++) strand.push(i < 4 ? look.mane : look.tip);
    k = {
      head: headPiece(look),
      rings: new Map(),
      locks: [lockPiece(look, 6, 0.9), lockPiece(look, 5, 0.8), lockPiece(look, 4, 0.6)],
      frontFeet: feetPiece(look, ringRadius(FRONT_FEET)),
      hindFeet: feetPiece(look, ringRadius(HIND_FEET)),
      rays: [raysPiece(look, 3, 2), raysPiece(look, 5, 3.5), raysPiece(look, 6, 4), raysPiece(look, 5, 3.5), raysPiece(look, 4, 2)],
      feather: featherPiece(look, 5),
      strand,
    };
    kits.set(look, k);
  }
  return k;
}

/** The ring nearest radius r and roll `roll`, built the first time it is asked for. */
function ringOf(kit: Kit, look: Look, r: number, band: boolean, spine: boolean, roll: number): Piece {
  const q = Math.max(3, Math.round(r / RING_STEP));
  let step = Math.round(roll / ROLL_STEP);
  if (step > ROLL_STEPS) step = ROLL_STEPS;
  else if (step < -ROLL_STEPS) step = -ROLL_STEPS;
  const key = ((q * 2 + (band ? 1 : 0)) * 2 + (spine ? 1 : 0)) * (2 * ROLL_STEPS + 1) + step + ROLL_STEPS;
  let p = kit.rings.get(key);
  if (!p) {
    p = rolledRing(look, q * RING_STEP, band, spine, step * ROLL_STEP);
    kit.rings.set(key, p);
  }
  return p;
}

const fig = figure(RINGS + MANE_RINGS + FIN_PAIRS + 8);
const px = new Float64Array(JOINTS), py = new Float64Array(JOINTS), pa = new Float64Array(JOINTS), ph = new Float64Array(JOINTS);
/** The bank the head held where each joint now is (−1 … 1), read back from the path's curvature. */
const turn = new Float64Array(JOINTS);
/** Each joint's lean with the wave: −1 … 1, positive when the body there bends to the right. */
const bend = new Float64Array(JOINTS);
const whisker = new Float64Array(WHISKER_POINTS * 3);
/** Fine points of path the wind of a boost needs: more than the body's. */
const WIND_JOINTS = Math.ceil(WIND_BACK / FINE) + 2;
/** The body's swing to its right, d cells behind the head, where the wave's phase is `phase`. */
const sway = (d: number, phase: number): number => WAVE_SWING * smooth(d / 22) * Math.sin(phase);

/** a − b as an angle in (−π, π]. */
function turned(a: number, b: number): number {
  let d = (a - b) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  else if (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

/**
 * Draws the river-dragon with its head at the flier: its shadow, then the tail fin, the rings from tail to neck
 * (feet under their rings), the mane, the head, and the two whiskers. The body lies along pose.chain, swung to
 * either side by a wave of phase pose.wave, and each ring rolls into the turn the head was making when it passed
 * there (s.bank at the head). Above cruising speed the wind of the boost is drawn under the body. Every pixel is depth-tested against the land.
 */
export function drawRiver(out: Uint32Array, rect: ViewRect, s: FlightState, view: Land, pose: Pose, look: Look = LACQUER): void {
  const kit = kitOf(look), n = pose.n;
  const windy = windAmount(s.speed) > 0;
  const joints = pose.chain.joints(windy ? WIND_JOINTS : JOINTS, FINE);
  const k = (2 * Math.PI) / WAVE_LENGTH;
  const finFrom = FIN_ROOT * FINE;
  for (let j = 0; j < JOINTS; j++) {
    const jt = joints[j], d = j * FINE;
    // The fin whips a little wider than the body that carries it.
    const amp = WAVE_SWING * smooth(d / 22) * (1 + 0.35 * smooth((d - finFrom) / 10)), arg = pose.wave - d * k;
    const off = amp * Math.sin(arg);
    const sin = Math.sin(jt.heading), cos = Math.cos(jt.heading);
    px[j] = jt.x - sin * off;
    py[j] = jt.y + cos * off;
    pa[j] = jt.alt + 0.25 * amp * Math.cos(arg);
    ph[j] = jt.heading + Math.atan(amp * k * Math.cos(arg));
    bend[j] = (-amp / WAVE_SWING) * Math.sin(arg);
    const a = j < CURVE_SPAN ? 0 : j - CURVE_SPAN, b = j + CURVE_SPAN >= JOINTS ? JOINTS - 1 : j + CURVE_SPAN;
    let t = turned(joints[a].heading, joints[b].heading) / ((b - a) * FINE * FULL_CURVE);
    if (t > 1) t = 1;
    else if (t < -1) t = -1;
    // At the head the bank is known outright; the path takes over down the neck.
    const near = j / (2 * CURVE_SPAN);
    turn[j] = near < 1 ? s.bank * (1 - near) + t * near : t;
  }

  fig.count = 0;
  // The fin, from its end forwards: the long feather, then each pair of rays. It flutters
  // more towards its end, and a turn throws it wide like the mane.
  for (let m = FIN_PAIRS; m >= 0; m--) {
    const j = FIN_ROOT + 2 * m;
    const flutter = 0.1 * (m + 1) * Math.sin(pose.wave * 2.2 - m * 0.9) + FIN_THROW * turn[j];
    if (m === FIN_PAIRS) {
      place(fig, kit.feather, px[j], py[j], pa[j] - 1, ph[j] + flutter);
      continue;
    }
    place(fig, kit.rays[m], px[j], py[j], pa[j] - 1, ph[j] + flutter);
  }
  const fin = fig.count;
  for (let i = RINGS - 1; i >= 0; i--) {
    const j = NECK + 2 * i;
    const roll = ROLL_TURN * turn[j] + ROLL_WAVE * bend[j];
    const ring = ringOf(kit, look, ringRadius(i), i % 2 === 1, i >= MANE_RINGS && i % 3 === 0 && i < RINGS - 3, roll);
    const base = pa[j] - ring.stack.layers * 0.5;
    if (i === FRONT_FEET) place(fig, kit.frontFeet, px[j], py[j], base, ph[j]);
    if (i === HIND_FEET) place(fig, kit.hindFeet, px[j], py[j], base, ph[j]);
    place(fig, ring, px[j], py[j], base, ph[j]);
  }
  for (let i = MANE_RINGS - 1; i >= 0; i--) {
    const j = NECK + 2 * i + 1;
    // Each lock sways, and is thrown to the outside of a turn by the bank of a moment ago.
    const sway = 0.5 * Math.sin(pose.wave * 2.3 - i * 1.1) + MANE_THROW * turn[j + 4];
    const lock = kit.locks[i < 2 ? 0 : i < 5 ? 1 : 2];
    // Alternate locks sit a little to either side of the spine, so the mane flickers like a flame.
    const aside = i % 2 === 0 ? 0.8 : -0.8;
    place(fig, lock, px[j] - Math.sin(ph[j]) * aside, py[j] + Math.cos(ph[j]) * aside, pa[j] + 1.5, ph[j] + sway);
  }
  const body = fig.count;
  place(fig, kit.head, s.x, s.y, s.alt - 3, s.heading);

  castShadow(out, rect, view, fig, n);
  // The wind of a boost lies under the body, so the streaks peel out from behind its outline.
  if (windy) {
    drawWind(out, rect, view, s, joints, FINE, n, pose.time, pose.wave, waveRate(s.speed), k, sway, RIVER_REACH - 1);
  }
  drawGroup(out, rect, view, fig, 0, fin, n);
  drawGroup(out, rect, view, fig, fin, body, n);

  // Whiskers: from either side of the snout, streaming back along the path and outwards, rippling at the tips.
  // A turn throws them to its outside, the tips last: each point answers to the bank of a little longer ago.
  const hs = Math.sin(s.heading), hc = Math.cos(s.heading);
  for (const side of [-1, 1]) {
    whisker[0] = s.x + 6 * hc - side * 2 * hs;
    whisker[1] = s.y + (6 * hs + side * 2 * hc) / 0.8;
    whisker[2] = s.alt;
    for (let i = 1; i < WHISKER_POINTS; i++) {
      const jt = joints[i - 1], u = i / (WHISKER_POINTS - 1);
      const out2 = side * (3.6 + 0.55 * i) + 0.18 * i * Math.sin(pose.wave * 2.6 - i * 0.6 + side)
        - WHISKER_THROW * turn[2 * i] * u * Math.sqrt(u);
      whisker[i * 3] = jt.x - Math.sin(jt.heading) * out2;
      whisker[i * 3 + 1] = jt.y + Math.cos(jt.heading) * out2;
      whisker[i * 3 + 2] = jt.alt + 1;
    }
    drawStrand(out, rect, view, whisker, WHISKER_POINTS, kit.strand, n);
  }
  // The head last, over the roots of its whiskers, so nothing crosses the face.
  drawGroup(out, rect, view, fig, body, fig.count, n);
}
