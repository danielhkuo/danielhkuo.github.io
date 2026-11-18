// Cloud shapes: each cloud is sculpted once, from the world seed, out of round
// lobes in the camera's own space, then lit by one sun. A painter turns the result
// into a sprite; the field places it.
//
// A cumulus has an outline of swells, one tall and one or two lesser, over a low
// shelf. It is built largest first: each swell is one great lobe with a lesser
// one leaning on it; lobes sized to the gaps fill the rest of the outline down to
// the shelf; then each form buds billows on its sunward crown, and those bud
// bumps; flattened lobes skirt the base. The frontmost surface wins each pixel, so
// the edge is crisp: a pixel is cloud or it is not.
//
// Light is the sun (north-west and above) on that surface and on the cloud's
// smoothed mass, so a whole flank turns to shade together; it is dimmed where a
// nearer lobe stands in the way, by the base, and in the creases between lobes.
// Streamers are chains of flattened lobes on a level base. Nothing here is noise
// per pixel.

import { rngFor, type Rng } from "../core/rng.ts";

export type CloudKind = "heap" | "puff" | "wisp" | "bank";

/** The cloud's shadow on level ground, for a cloud whose base is on the ground: the box sits (dx, dy) from the shape's top-left. */
export interface CloudShadow {
  w: number;
  h: number;
  dx: number;
  dy: number;
  /** 1 where the ground is shaded, w·h row-major. */
  mask: Uint8Array;
}

/** One sculpted cloud, w·h row-major. */
export interface CloudShape {
  kind: CloudKind;
  w: number;
  h: number;
  /** 1 where there is cloud, 0 elsewhere: no soft edge. */
  cover: Uint8Array;
  /** Sun on the surface, about −1.5 (deep in shade) to 1.2 (a crown facing the sun); 0 off the cloud. */
  light: Float32Array;
  /** 1 where a sunlit crown meets open sky on its sunward side, 2 where it stands in front of a farther lobe; else 0. */
  rim: Uint8Array;
  shadow: CloudShadow;
}

/** Box sizes in pixels, [min, max] inclusive. */
export const SHAPE_SIZES: Readonly<Record<CloudKind, { w: readonly [number, number]; h: readonly [number, number] }>> = {
  heap: { w: [110, 250], h: [45, 130] },
  puff: { w: [18, 84], h: [10, 48] },
  wisp: { w: [66, 170], h: [8, 22] },
  bank: { w: [190, 320], h: [100, 190] },
};

/** How many shapes of each kind the sky makes. */
export const SHAPE_COUNTS: Readonly<Record<CloudKind, number>> = { heap: 10, puff: 12, wisp: 7, bank: 5 };

const KINDS: readonly CloudKind[] = ["heap", "puff", "wisp", "bank"];
/** Empty pixels kept round every shape. */
const MARGIN = 1;

/**
 * The sun, in the camera's space (x right, up the screen, toward the viewer): north-west and above, as on the land.
 * Unit length.
 */
export const SUN = (() => {
  const x = -0.58, up = 0.68, toward = 0.45, len = Math.hypot(x, up, toward);
  return { x: x / len, up: up / len, toward: toward / len };
})();
/** Cells a shadow moves south-east per unit of height: the flier's shadow uses the same slope. */
export const SHADOW_SLOPE = 0.354;

/** A lobe in the camera's space: centre (x, y down the screen, f toward the viewer), radius r, squashed to `flat`·r tall and deep. */
interface Lobe {
  x: number;
  y: number;
  f: number;
  r: number;
  flat: number;
}

// The camera maps a point d cells south and z up to screen row 0.8·d − z, at depth (d + 0.8·z) / 1.28 toward the viewer.
const K = 1.28;
/** Height above the base of the point at screen row y and depth f. */
const heightOf = (y: number, f: number): number => (0.8 * K * f - y) / (0.64 + 1);
/** Cells south of the model's origin of that point. */
const southOf = (y: number, f: number): number => K * f - 0.8 * heightOf(y, f);

/** A lobe centred `d` cells south of the origin and `z` above the base. */
function lobeAt(x: number, d: number, z: number, r: number, flat = 1): Lobe {
  return { x, y: 0.8 * d - z, f: (d + 0.8 * z) / K, r, flat };
}

const range = (rng: Rng, lo: number, hi: number): number => lo + rng.float() * (hi - lo);
const intIn = (rng: Rng, lo: number, hi: number): number => lo + rng.int(hi - lo + 1);

/** Where on a parent's outline buds sit, in half-turns: 0 its right shoulder, 0.5 its top, 1 its left. */
const CROWN: readonly [number, number] = [0.08, 1.02];
const FACE: readonly [number, number] = [0.3, 0.95];
const LEE: readonly [number, number] = [-0.3, 0.12];

/**
 * Buds `count` smaller lobes on `parent`: spread along `arc` of its outline, each pushed out toward the viewer by a
 * share drawn from `toward`.
 */
function bud(
  rng: Rng, parent: Lobe, count: number, size: readonly [number, number], reach: readonly [number, number],
  arc: readonly [number, number], toward: readonly [number, number],
): Lobe[] {
  const out: Lobe[] = [];
  for (let i = 0; i < count; i++) {
    const a = Math.PI * (arc[0] + (arc[1] - arc[0]) * ((i + range(rng, 0.15, 0.85)) / count));
    const near = range(rng, toward[0], toward[1]);
    const flatPart = Math.sqrt(1 - near * near);
    const rho = parent.r * range(rng, reach[0], reach[1]);
    out.push({
      x: parent.x + Math.cos(a) * flatPart * rho,
      y: parent.y - Math.sin(a) * flatPart * rho * parent.flat,
      f: parent.f + near * rho * parent.flat,
      r: parent.r * range(rng, size[0], size[1]),
      flat: 1,
    });
  }
  return out;
}

/** One swell of a cumulus's outline: its crest `h` high at `x`, falling to nothing `s` to either side. */
interface Hump {
  x: number;
  h: number;
  s: number;
}

interface CumulusPlan {
  /** Width of the footprint, pixels, and its depth north to south as a share of that. */
  width: number;
  depth: number;
  /** The tallest swell first. */
  humps: readonly Hump[];
  /** Height of the low shelf that runs the whole width, under the swells. */
  shelf: number;
  /** The size of the least billow, pixels: gaps under the outline smaller than this are left to the crowns. */
  grain: number;
}

/** How high the cloud's top stands at `x`: the tallest swell there, or the shelf. */
function crest(plan: CumulusPlan, x: number): number {
  const edge = 1 - Math.pow(Math.abs((2 * x) / plan.width - 1), 3);
  let h = plan.shelf * edge;
  for (const m of plan.humps) {
    const u = (x - m.x) / m.s;
    if (u > -1 && u < 1) h = Math.max(h, m.h * Math.pow(1 - u * u, 0.7));
  }
  return h;
}

/**
 * The lobes of one cumulus on its base (height 0), its footprint running from x = 0 to `width`. Largest first: each
 * swell is one great lobe with a lesser one leaning on it; then whatever of the outline still stands empty is filled,
 * the widest gap first, with lobes sized to the gap, so the forms run from the body down through shoulders to the
 * shelf. Only then do the crowns bud: billows on each form's sunward top, bumps on those, a few on the great faces.
 */
function cumulus(rng: Rng, plan: CumulusPlan): Lobe[] {
  const { width, grain } = plan;
  const lobes: Lobe[] = [];
  const forms: Lobe[] = [];
  const halfAt = (x: number): number => 0.5 * plan.depth * width * Math.sqrt(Math.max(0, 1 - Math.pow((2 * x) / width - 1, 2)));
  // How high what has been placed stands at each column, in screen rows over the base's middle.
  const cols = Math.ceil(width) + 1;
  const have = new Float32Array(cols);
  /**
   * A form whose top stands `top` rows high at `x`, as near `d` cells south as lets it end behind the front of the
   * base: a great lobe is deeper than the footprint, and one that came forward of it would hang below the level base.
   */
  const place = (x: number, top: number, r: number, flat: number, d: number): Lobe => {
    const rho = r * flat, front = 0.7 * halfAt(x);
    let z = 0;
    for (; ; d -= 2) {
      z = Math.max(top + 0.8 * d - rho, 0.35 * rho);
      if (z >= rho || d + Math.sqrt(rho * rho - z * z) <= front || z <= 0.35 * rho) break;
    }
    const lobe = lobeAt(x, d, z, r, flat);
    for (let px = Math.max(0, Math.ceil(x - r)); px <= Math.min(cols - 1, Math.floor(x + r)); px++) {
      const t = z - 0.8 * d + flat * Math.sqrt(r * r - (px - x) * (px - x));
      if (t > have[px]) have[px] = t;
    }
    lobes.push(lobe);
    forms.push(lobe);
    return lobe;
  };

  // The bodies: to each swell one great lobe, wider than tall, and lesser ones leaning on its shoulders, each
  // smaller than the last.
  for (let k = 0; k < plan.humps.length; k++) {
    const m = plan.humps[k];
    const flat = range(rng, 0.84, 0.98);
    const r = Math.min((m.h * range(rng, 0.42, 0.5)) / flat, 0.95 * m.s);
    place(m.x, m.h, r, flat, halfAt(m.x) * range(rng, -0.15, 0.15));
    if (r < 9) continue;
    // Toward the middle of the cloud for a side swell, so it joins the body; both ways for the main one.
    let side = k === 0 ? (rng.float() < 0.5 ? -1 : 1) : m.x < plan.humps[0].x ? 1 : -1;
    let share = range(rng, 0.68, 0.84);
    for (let j = 0; j < (k === 0 ? 3 : 1); j++) {
      const x = m.x + side * r * range(rng, 0.6, 0.95);
      place(x, Math.min(0.9 * m.h, crest(plan, x) * range(rng, 0.86, 1)), r * share, range(rng, 0.82, 1), halfAt(x) * range(rng, 0, 0.5));
      side = -side;
      share *= range(rng, 0.7, 0.84);
    }
  }
  // The rest of the outline: the column that lacks most gets a lobe sized to what it lacks.
  for (let n = 0; n < 48; n++) {
    let at = -1, lack = Math.max(3, 0.55 * grain);
    for (let px = 0; px < cols; px++) {
      const l = crest(plan, px) - have[px];
      if (l > lack) { lack = l; at = px; }
    }
    if (at < 0) break;
    const c = crest(plan, at);
    const r = Math.max(2.5, Math.min(0.45 * c, Math.max(0.85 * lack, 0.5 * grain)) * range(rng, 0.8, 1.15));
    place(at + range(rng, -1, 1), c * range(rng, 0.94, 1.04), r, range(rng, 0.86, 1), halfAt(at) * range(rng, -0.3, 0.3));
  }
  // The crowns: billows on each form's sunward top, a size or two down from it, and bumps on those.
  for (const b of forms) {
    if (b.r < 4.5) continue;
    const great = b.r >= 16;
    const count = great ? Math.round(b.r / 9) + intIn(rng, 3, 4) : b.r >= 9 ? intIn(rng, 3, 4) : 2;
    for (const c of bud(rng, b, count, great ? [0.22, 0.55] : [0.3, 0.58], [0.82, 1], CROWN, [-0.1, 0.6])) {
      lobes.push(c);
      if (c.r >= 5) for (const g of bud(rng, c, intIn(rng, 2, 3), [0.32, 0.6], [0.75, 0.98], CROWN, [-0.1, 0.6])) lobes.push(g);
    }
    if (!great) continue;
    // A great face is not one smooth ball: billows swell out of its sunlit side, and a few lesser ones out of
    // the shoulder turned from the sun.
    for (const c of bud(rng, b, intIn(rng, 3, 5), [0.24, 0.46], [0.74, 0.94], FACE, [0.3, 0.65])) {
      lobes.push(c);
      if (c.r >= 6) for (const g of bud(rng, c, 2, [0.35, 0.55], [0.75, 0.95], FACE, [0.2, 0.6])) lobes.push(g);
    }
    for (const c of bud(rng, b, intIn(rng, 2, 3), [0.26, 0.44], [0.7, 0.9], LEE, [0.3, 0.7])) lobes.push(c);
  }
  // The base: a level rank of flattened lobes along the front of the footprint, under and before the forms.
  for (let x = 0.04 * width; x < 0.97 * width;) {
    const r = Math.max(2.5, Math.min(grain * range(rng, 0.55, 1.15), 0.5 * crest(plan, x) + 3));
    const flat = range(rng, 0.7, 0.85);
    lobes.push(lobeAt(x + 0.6 * r, halfAt(x + 0.6 * r) * range(rng, 0.4, 0.62), 0.45 * r * flat, r, flat));
    x += r * range(rng, 1, 1.4);
  }
  // The skirt: low, flattened lobes along the front of the base, so the cloud ends in soft scallops, not in a ruled line.
  const skirt = Math.max(2, Math.round(width / 20));
  for (let i = 0; i < skirt; i++) {
    const x = width * (0.06 + 0.88 * ((i + range(rng, 0.2, 0.8)) / skirt));
    const r = Math.max(2.5, Math.min(0.6 * grain, 0.2 * crest(plan, x) + 3) * range(rng, 0.8, 1.25));
    const flat = range(rng, 0.55, 0.75);
    lobes.push(lobeAt(x, halfAt(x) * range(rng, 0.6, 1), r * flat * range(rng, 0.6, 1), r, flat));
  }
  return lobes;
}

/** A plan with one main swell and `sides` lesser ones toward the ends. */
function planOf(rng: Rng, width: number, tall: readonly [number, number], spread: readonly [number, number], sides: number, grain: number): CumulusPlan {
  const at = range(rng, 0.34, 0.66);
  const h = width * range(rng, tall[0], tall[1]);
  const humps: Hump[] = [{ x: at * width, h, s: width * range(rng, spread[0], spread[1]) }];
  // Lesser swells on alternate sides of the main one, the first on its roomier side.
  let left = at > 0.5;
  for (let k = 0; k < sides; k++) {
    const room = left ? at : 1 - at;
    const x = left ? at - room * range(rng, 0.45, 0.8) : at + room * range(rng, 0.45, 0.8);
    humps.push({ x: x * width, h: h * range(rng, 0.45, 0.72), s: width * range(rng, 0.16, 0.26) });
    left = !left;
  }
  return { width, depth: range(rng, 0.2, 0.28), humps, shelf: h * range(rng, 0.2, 0.3), grain };
}

/**
 * A streamer: a long, low cloud with a level base. A chain of flattened lobes, close-set so they run together,
 * swelling toward the middle and thinning to the ends, with a few small billows riding its top.
 */
function streamer(rng: Rng, length: number, thick: number): Lobe[] {
  const lobes: Lobe[] = [];
  const count = Math.max(5, Math.round(length / (thick * 0.75)));
  const skew = range(rng, 0.7, 1.4);
  for (let i = 0; i < count; i++) {
    const u = (i + 0.5) / count;
    const swell = Math.pow(Math.sin(Math.PI * Math.pow(u, skew)), 0.7);
    const r = thick * (0.28 + 0.72 * swell) * range(rng, 0.85, 1.15);
    const flat = range(rng, 0.5, 0.62);
    // Sunk a little into the base, which cuts the chain's underside level.
    const lobe = lobeAt(u * length, range(rng, -0.2, 0.2) * r, r * flat * range(rng, 0.6, 0.9), r, flat);
    lobes.push(lobe);
    if (r > 0.8 * thick && rng.float() < 0.45) {
      const b = r * range(rng, 0.4, 0.55);
      lobes.push({ x: lobe.x + range(rng, -0.4, 0.4) * r, y: lobe.y - r * flat * 0.8, f: lobe.f + 0.2 * r, r: b, flat: 0.85 });
    }
  }
  return lobes;
}

/** Offsets where a nearer lobe makes a crease on the one behind it. */
const CREASE: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
/** A lobe this much nearer than its neighbour pixel stands in front of it. */
const STEP = 2.2;
/** How steeply the smoothed mass is taken to slope: more turns its flanks further from the sun. */
const MASS_SLOPE = 2.4;
/** How far up from the base the base's own shade reaches: this share of the cloud's height, and never more than the cap, in pixels. */
const BASE_SHADE = 0.42;
const BASE_SHADE_CAP = 30;

/** Rasterises lobes into a shape: nearest surface per pixel, lit, cropped to the cloud plus a margin. */
function sculpt(kind: CloudKind, lobes: readonly Lobe[]): CloudShape {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const l of lobes) {
    x0 = Math.min(x0, l.x - l.r);
    x1 = Math.max(x1, l.x + l.r);
    y0 = Math.min(y0, l.y - l.r * l.flat);
    y1 = Math.max(y1, l.y + l.r * l.flat);
  }
  const ox = Math.floor(x0), oy = Math.floor(y0);
  const bw = Math.ceil(x1) - ox + 1, bh = Math.ceil(y1) - oy + 1;
  const depth = new Float32Array(bw * bh).fill(-Infinity);
  const lam = new Float32Array(bw * bh), high = new Float32Array(bw * bh);
  let top = 1;
  for (const l of lobes) {
    const ry = l.r * l.flat, r2 = l.r * l.r;
    const pxa = Math.max(0, Math.floor(l.x - l.r - ox)), pxb = Math.min(bw - 1, Math.ceil(l.x + l.r - ox));
    const pya = Math.max(0, Math.floor(l.y - ry - oy)), pyb = Math.min(bh - 1, Math.ceil(l.y + ry - oy));
    for (let py = pya; py <= pyb; py++) {
      const sy = py + 0.5 + oy, dy = (sy - l.y) / l.flat;
      for (let px = pxa; px <= pxb; px++) {
        const dx = px + 0.5 + ox - l.x;
        const q = r2 - dx * dx - dy * dy;
        if (q <= 0) continue;
        const dz = Math.sqrt(q);
        const f = l.f + dz * l.flat;
        const i = py * bw + px;
        if (f <= depth[i]) continue;
        const z = heightOf(sy, f);
        if (z < 0) continue;
        depth[i] = f;
        high[i] = z;
        if (z > top) top = z;
        // The ellipsoid's normal, then the sun on it.
        const nx = dx, nu = -dy / l.flat, nf = dz / l.flat;
        lam[i] = (nx * SUN.x + nu * SUN.up + nf * SUN.toward) / Math.hypot(nx, nu, nf);
      }
    }
  }

  // One piece: keep the largest connected mass and drop the crumbs that stand apart from it.
  const piece = new Int32Array(bw * bh);
  let pieces = 0, best = 0, bestSize = 0;
  const stack: number[] = [];
  for (let start = 0; start < depth.length; start++) {
    if (depth[start] === -Infinity || piece[start]) continue;
    pieces++;
    let size = 0;
    piece[start] = pieces;
    stack.push(start);
    while (stack.length > 0) {
      const i = stack.pop() as number, px = i % bw;
      size++;
      for (const j of [px > 0 ? i - 1 : -1, px < bw - 1 ? i + 1 : -1, i - bw, i + bw]) {
        if (j >= 0 && j < depth.length && depth[j] !== -Infinity && !piece[j]) {
          piece[j] = pieces;
          stack.push(j);
        }
      }
    }
    if (size > bestSize) { bestSize = size; best = pieces; }
  }
  for (let i = 0; i < depth.length; i++) if (piece[i] !== best) depth[i] = -Infinity;

  // Fill holes: clear pixels walled in by cloud become its deepest, darkest recesses.
  let floor = Infinity;
  for (let i = 0; i < depth.length; i++) if (depth[i] !== -Infinity && depth[i] < floor) floor = depth[i];
  const open = new Uint8Array(bw * bh);
  const queue: number[] = [];
  const visit = (i: number): void => {
    if (depth[i] === -Infinity && !open[i]) {
      open[i] = 1;
      queue.push(i);
    }
  };
  for (let px = 0; px < bw; px++) { visit(px); visit((bh - 1) * bw + px); }
  for (let py = 0; py < bh; py++) { visit(py * bw); visit(py * bw + bw - 1); }
  while (queue.length > 0) {
    const i = queue.pop() as number, px = i % bw, py = (i - px) / bw;
    if (px > 0) visit(i - 1);
    if (px < bw - 1) visit(i + 1);
    if (py > 0) visit(i - bw);
    if (py < bh - 1) visit(i + bw);
  }
  for (let i = 0; i < depth.length; i++) {
    if (depth[i] !== -Infinity || open[i]) continue;
    depth[i] = floor - 3;
    lam[i] = -0.7;
  }

  // The mass: the surface with its lobes smoothed away, lit as one great form, so a whole flank turns from the sun
  // together and the lobes only scallop the edge between light and shade.
  const mass = new Float32Array(bw * bh), pass = new Float32Array(bw * bh);
  for (let i = 0; i < mass.length; i++) mass[i] = depth[i] === -Infinity ? floor - 2 : depth[i];
  const blur = Math.max(2, Math.round(Math.min(bw, bh) / 9));
  for (let round = 0; round < 2; round++) {
    for (let py = 0; py < bh; py++) {
      let sum = 0;
      for (let k = -blur; k <= blur; k++) sum += mass[py * bw + Math.min(bw - 1, Math.max(0, k))];
      for (let px = 0; px < bw; px++) {
        pass[py * bw + px] = sum / (2 * blur + 1);
        sum += mass[py * bw + Math.min(bw - 1, px + blur + 1)] - mass[py * bw + Math.max(0, px - blur)];
      }
    }
    for (let px = 0; px < bw; px++) {
      let sum = 0;
      for (let k = -blur; k <= blur; k++) sum += pass[Math.min(bh - 1, Math.max(0, k)) * bw + px];
      for (let py = 0; py < bh; py++) {
        mass[py * bw + px] = sum / (2 * blur + 1);
        sum += pass[Math.min(bh - 1, py + blur + 1) * bw + px] - pass[Math.max(0, py - blur) * bw + px];
      }
    }
  }
  /** The sun on the mass at a pixel of the working buffer, less what a face turned to the viewer gets: 0 on the flat. */
  const massLight = (px: number, py: number): number => {
    const xa = Math.max(0, px - 2), xb = Math.min(bw - 1, px + 2), ya = Math.max(0, py - 2), yb = Math.min(bh - 1, py + 2);
    const gx = MASS_SLOPE * (mass[py * bw + xb] - mass[py * bw + xa]) / (xb - xa);
    const gy = MASS_SLOPE * (mass[yb * bw + px] - mass[ya * bw + px]) / (yb - ya);
    return (-gx * SUN.x + gy * SUN.up + SUN.toward) / Math.hypot(gx, gy, 1) - SUN.toward;
  };

  // Crop to the cloud.
  let cx0 = bw, cx1 = -1, cy0 = bh, cy1 = -1;
  for (let py = 0; py < bh; py++) for (let px = 0; px < bw; px++) {
    if (depth[py * bw + px] === -Infinity) continue;
    if (px < cx0) cx0 = px;
    if (px > cx1) cx1 = px;
    if (py < cy0) cy0 = py;
    if (py > cy1) cy1 = py;
  }
  const w = cx1 - cx0 + 1 + 2 * MARGIN, h = cy1 - cy0 + 1 + 2 * MARGIN;
  const cover = new Uint8Array(w * h), light = new Float32Array(w * h), rim = new Uint8Array(w * h);
  const at = (x: number, y: number): number => {
    const px = x - MARGIN + cx0, py = y - MARGIN + cy0;
    return px < 0 || py < 0 || px >= bw || py >= bh ? -Infinity : depth[py * bw + px];
  };
  // How far a lobe's cast shade reaches, in pixels along the sun's line.
  const reach = Math.min(70, 0.55 * h);
  for (let y = MARGIN; y < h - MARGIN; y++) for (let x = MARGIN; x < w - MARGIN; x++) {
    const here = at(x, y);
    if (here === -Infinity) continue;
    const bi = (y - MARGIN + cy0) * bw + x - MARGIN + cx0;
    const i = y * w + x;
    cover[i] = 1;
    // Cast shade: walk toward the sun; a surface standing nearer the viewer than the ray is in the way.
    let shaded = false;
    for (let t = 2; t <= reach && !shaded; t += 1.5) {
      const d = at(Math.round(x + SUN.x * t), Math.round(y - SUN.up * t));
      if (d > here + SUN.toward * t + 1.5) shaded = true;
    }
    // A crease: a lobe well in front, one or two pixels away.
    let crease = false;
    for (const [ax, ay] of CREASE) if (at(x + ax, y + ay) > here + STEP) crease = true;
    // Higher is brighter; and the lowest part of the cloud, by its base, lies in its own shade.
    const up = high[bi] / top, under = Math.max(0, 1 - high[bi] / Math.min(BASE_SHADE * top, BASE_SHADE_CAP));
    const lift = 0.45 * (up - 0.5) - 0.75 * under * under;
    const body = 0.62 * massLight(x - MARGIN + cx0, y - MARGIN + cy0) + lift;
    // On the flank turned from the sun a lobe's own lit face counts for less, so the shade stays one calm mass.
    const own = lam[bi] > 0 ? lam[bi] * Math.min(1, Math.max(0.65, 1 + 2.2 * body)) : lam[bi];
    light[i] = 0.5 * own + body - (shaded ? 0.3 : 0) - (crease ? 0.42 : 0);
    // Rims: on the sunward side (up or left), open sky or a lobe well behind.
    if (lam[bi] > 0.2 && !shaded) {
      const up = at(x, y - 1), left = at(x - 1, y);
      if (up === -Infinity || (left === -Infinity && at(x - 1, y - 1) === -Infinity)) rim[i] = 1;
      else if (here > up + STEP) rim[i] = 2;
    }
  }

  // The shadow: each lobe's footprint on the ground under it, moved south-east by the sun's slope times its height.
  const feet: { x: number; y: number; rx: number; ry: number }[] = [];
  let sx0 = Infinity, sx1 = -Infinity, sy0 = Infinity, sy1 = -Infinity;
  for (const l of lobes) {
    if (l.r < 3) continue;
    const z = Math.max(0, heightOf(l.y, l.f)), south = southOf(l.y, l.f);
    const fx = l.x + SHADOW_SLOPE * z - ox - cx0 + MARGIN, fy = 0.8 * (south + SHADOW_SLOPE * z) - oy - cy0 + MARGIN;
    const rx = l.r * 0.92, ry = Math.max(1, 0.8 * rx * (l.flat < 1 ? 0.55 : 0.8));
    feet.push({ x: fx, y: fy, rx, ry });
    sx0 = Math.min(sx0, fx - rx);
    sx1 = Math.max(sx1, fx + rx);
    sy0 = Math.min(sy0, fy - ry);
    sy1 = Math.max(sy1, fy + ry);
  }
  const dx = Math.floor(sx0), dy = Math.floor(sy0);
  const sw = Math.max(1, Math.ceil(sx1) - dx), sh = Math.max(1, Math.ceil(sy1) - dy);
  const mask = new Uint8Array(sw * sh);
  for (const ft of feet) {
    const ya = Math.max(0, Math.floor(ft.y - ft.ry - dy)), yb = Math.min(sh - 1, Math.ceil(ft.y + ft.ry - dy));
    for (let y = ya; y <= yb; y++) {
      const v = (y + 0.5 + dy - ft.y) / ft.ry;
      if (v * v >= 1) continue;
      const half = ft.rx * Math.sqrt(1 - v * v);
      const xa = Math.max(0, Math.round(ft.x - half - dx)), xb = Math.min(sw, Math.round(ft.x + half - dx));
      for (let x = xa; x < xb; x++) mask[y * sw + x] = 1;
    }
  }
  return { kind, w, h, cover, light, rim, shadow: { w: sw, h: sh, dx, dy, mask } };
}

/**
 * Shape `index` of `count` of its kind. Widths are spread over the kind's range, one stratum to a shape, so every
 * sky has small and great clouds of each kind, whatever the seed.
 */
function make(kind: CloudKind, rng: Rng, index: number, count: number): CloudShape {
  const size = SHAPE_SIZES[kind];
  // Draw again in the rare case a shape falls outside its kind's box.
  for (let tries = 0; ; tries++) {
    const share = (index + rng.float()) / count;
    const span = (lo: number, hi: number): number => lo + (hi - lo) * share;
    let lobes: Lobe[];
    if (kind === "heap") {
      const width = span(105, 210);
      lobes = cumulus(rng, planOf(rng, width, [0.3, 0.46], [0.26, 0.4], width < 140 ? 1 : intIn(rng, 1, 2), range(rng, 13, 17)));
    } else if (kind === "bank") {
      const width = span(190, 270);
      lobes = cumulus(rng, planOf(rng, width, [0.46, 0.6], [0.24, 0.32], 2, range(rng, 19, 24)));
    } else if (kind === "puff") {
      const width = span(16, 62);
      lobes = cumulus(rng, planOf(rng, width, [0.36, 0.52], [0.4, 0.55], width > 44 ? 1 : 0, Math.max(5, width / range(rng, 3.6, 5))));
    } else {
      lobes = streamer(rng, span(70, 150), range(rng, 8, 12));
    }
    const s = sculpt(kind, lobes);
    const fits = s.w >= size.w[0] && s.w <= size.w[1] && s.h >= size.h[0] && s.h <= size.h[1];
    if (fits || tries >= 80) return s;
  }
}

/** The shapes, ordered by kind (heap, puff, wisp, bank) and then by index. Deterministic in the seed. */
export function makeShapes(seed: number, counts: Readonly<Record<CloudKind, number>>): CloudShape[] {
  const out: CloudShape[] = [];
  for (const kind of KINDS) {
    for (let i = 0; i < counts[kind]; i++) out.push(make(kind, rngFor(seed, `sky-shape-${kind}-${i}`), i, counts[kind]));
  }
  return out;
}
