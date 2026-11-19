// Small life: sheep on the pastures, gulls resting on the beaches and wheeling over the harbour and the lighthouses,
// boats working out of the town's harbour, and smoke from a few chimneys.
//
// Everything is a function of the seed, the place and the clock. Things that stand on the land are placed on a lattice
// in bake space (which is fixed to the world) and drawn only where the bake pixel under them is the right material;
// things in the air are placed in world space round the sites. Birds near the flier's track lift and scatter, then
// settle: how far into that flight a bird is depends only on where the flier is and how it is heading. Boats keep to
// routes planned round the land (routes.ts), out from the roads off the harbour and home to them.

import { hash2, mix32 } from "../core/hash.ts";
import { pcos, psin } from "../core/psin.ts";
import { MATERIAL as M } from "../look/materials.ts";
import { artSet, blend, frameX, frameY, modP, ringDelta, smooth01 } from "./art.ts";
import type { Flier, LiveFrame, LiveLayer } from "./live.ts";
import type { LayerContext } from "./registry.ts";
import { planHarbour, ROUTE_STEP } from "./routes.ts";
import { bakeAt, drawSprite, worldRowAt } from "./sprites.ts";

// ── Tuning ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Sheep keep to pasture at least this high over the sea. */
export const UPLAND = 14;
/** A bird takes off when the flier's track passes within this many cells of it, no more than LOW units over it. */
export const REACH = 46;
export const LOW = 60;
/** Seconds a startled bird stays up. */
const ALOFT = 4.4;
/** Boats turn for home at least this far from the roads off the harbour, by water. */
const BOAT_FAR = 190;
/** Smoke rises only from roofs within this many cells of a town. */
const SMOKE_REACH = 190;
/** Boats to a town, fanned over the sea its harbour opens on. */
const BOATS = 12;

// How far from the pixel it stands on each thing can draw: a lattice point is placed (from the land under it, past the
// frame's edge as on it) whenever its thing can reach the frame, and drawn clipped, so it crosses the edge whole.
/** A sheep walks up to this many pixels either way along its slope. */
const SHEEP_WALK = 5;
/**
 * A startled gull flies up to FLEE_SIDE pixels either side of its beach, FLEE_UP above it and FLEE_DOWN below (flee's
 * furthest: 41 cells out, sideways or a little along the track, with 5 of wheeling; 25 units up), wings and all.
 */
const FLEE_SIDE = 59;
const FLEE_UP = 71;
const FLEE_DOWN = 48;
/** A boat and its wake: up to this many pixels from the boat's point, either way. */
const BOAT_REACH = 10;
/**
 * Smoke climbs up to 8 pixels to the ridge, rises up to 15 over it and leans up to 8 downwind. A town counts as near the
 * frame within SMOKE_REACH, the frame's half-diagonal and SMOKE_SLACK cells of its middle.
 */
const SMOKE_UP = 24;
const SMOKE_LEAN = 9;
const SMOKE_SLACK = 86;

const TAU = 2 * Math.PI;

const flags = (ids: readonly number[]): Uint8Array => {
  const t = new Uint8Array(256);
  for (const id of ids) t[id] = 1;
  return t;
};
export const isPasture: Uint8Array = flags([M.pastureCool, M.pastureMid, M.pastureWarm]);
export const isBeach: Uint8Array = flags([M.sand, M.sandPale, M.shingle]);
export const isSea: Uint8Array = flags([M.sea, M.seaClear]);
export const isRoof: Uint8Array = flags([M.roofTile, M.roofSlate]);

/** What the layer drew last frame, for tests: the kind and the frame pixel it stands on. */
export interface Placed {
  kind: "sheep" | "gull-resting" | "gull-startled" | "gull" | "boat" | "smoke";
  px: number;
  py: number;
}

export interface LifeLayer extends LiveLayer {
  /** Set to an array to have each frame's placements pushed onto it. */
  log: Placed[] | null;
}

// ── Startling ────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Seconds since the flier's track came within REACH of a bird at world (x, y), `ground` units up; −1 when it has not,
 * the bird has settled again, or the flier is more than LOW over it. The track is the flier's heading held straight,
 * so the answer needs no memory.
 */
export function startledFor(fl: Flier | undefined, n: number, x: number, y: number, ground: number): number {
  if (!fl) return -1;
  const over = fl.alt - ground;
  if (over > LOW || over < -LOW) return -1;
  const dx = ringDelta(fl.x, x, n), dy = ringDelta(fl.y, y, n);
  const hx = pcos(fl.heading), hy = psin(fl.heading);
  const side = dx * hy - dy * hx;
  if (side >= REACH || side <= -REACH) return -1;
  const behind = -(dx * hx + dy * hy);
  const tau = (behind + Math.sqrt(REACH * REACH - side * side)) / (fl.speed < 20 ? 20 : fl.speed);
  return tau < 0 || tau > ALOFT ? -1 : tau;
}

/** The way the flier last asked of mayStartle was heading, and its cosine and sine: the same for a whole frame. */
const track = { heading: NaN, hx: 0, hy: 0 };

/**
 * Whether a bird anywhere on bake pixels x0…x1 (world columns) by rows by0…by1 could be startled by `fl`
 * (startledFor ≥ 0), from any ground it could be startled on (within LOW of the flier's height): a cheap test that
 * reads no land, false only where startledFor is surely −1. A bird's world row is (by + ground) / 0.8, and its distances
 * across and along the flier's track are linear in its column and row, so their extremes lie at the box's corners.
 */
export function mayStartle(fl: Flier, n: number, x0: number, x1: number, by0: number, by1: number): boolean {
  const dx0 = ringDelta(fl.x, x0, n), dx1 = dx0 + (x1 - x0);
  const dy0 = ringDelta(fl.y, (by0 + fl.alt - LOW) / 0.8, n), dy1 = dy0 + (by1 - by0 + 2 * LOW) / 0.8;
  if (fl.heading !== track.heading) {
    track.heading = fl.heading;
    track.hx = pcos(fl.heading);
    track.hy = psin(fl.heading);
  }
  const hx = track.hx, hy = track.hy;
  // Across the track: dx·hy − dy·hx; along it, behind the flier: −(dx·hx + dy·hy).
  const a = dx0 * hy, b = dx1 * hy, c = dy0 * hx, d = dy1 * hx;
  const sLo = Math.min(a, b) - Math.max(c, d), sHi = Math.max(a, b) - Math.min(c, d);
  if (sLo >= REACH || sHi <= -REACH) return false;
  const e = dx0 * hx, g = dx1 * hx, p = dy0 * hy, q = dy1 * hy;
  const bLo = -(Math.max(e, g) + Math.max(p, q)), bHi = -(Math.min(e, g) + Math.min(p, q));
  return bLo <= ALOFT * (fl.speed < 20 ? 20 : fl.speed) && bHi >= -REACH;
}

/** Where a startled bird is, relative to where it was: filled by `flee`. */
const fled = { dx: 0, dy: 0, up: 0 };

/** The flight of a bird `tau` seconds after it was startled: out to the side of the flier's track and up, then back. */
function flee(fl: Flier, n: number, x: number, y: number, tau: number, h: number): void {
  const a = smooth01(tau / 0.45) * (1 - smooth01((tau - 2.6) / (ALOFT - 2.6)));
  const hx = pcos(fl.heading), hy = psin(fl.heading);
  const side = ringDelta(fl.x, x, n) * hy - ringDelta(fl.y, y, n) * hx;
  const s = side > 0.5 ? 1 : side < -0.5 ? -1 : (h & 1) === 0 ? 1 : -1;
  const far = 20 + ((h >>> 3) & 15) * 1.4;
  const along = (((h >>> 8) & 31) - 15) / 22;
  const turn = tau * 2.6 + ((h >>> 14) & 63) / 10;
  fled.dx = a * (far * (s * hy + along * hx) + 5 * pcos(turn));
  fled.dy = a * (far * (-s * hx + along * hy) + 5 * psin(turn));
  fled.up = a * (13 + ((h >>> 20) & 15) * 0.8);
}

// ── The layer ────────────────────────────────────────────────────────────────────────────────────────────────────────

interface Wheeler {
  x: number;
  y: number;
  r: number;
  /** Radians a second; the sign is the way round. */
  turn: number;
  phase: number;
  alt: number;
  h: number;
}

interface Boat {
  /** From the roads out to sea: x, y pairs every ROUTE_STEP cells, and its length in cells. */
  route: Float32Array;
  length: number;
  /** How far out along its route it lies when it is home, in cells: each boat a little apart from the others. */
  berth: number;
  period: number;
  phase: number;
}

/** Where a boat is `d` cells along `route` (x, y pairs every ROUTE_STEP), and the way the route runs there: filled by `routeAt`. */
const where = { x: 0, y: 0, dx: 0, dy: 0 };
function routeAt(route: Float32Array, d: number): void {
  const last = route.length / 2 - 1;
  const at = d <= 0 ? 0 : d / ROUTE_STEP;
  const i = at >= last ? last - 1 : Math.floor(at), k = at >= last ? 1 : at - i;
  where.x = route[2 * i] + (route[2 * i + 2] - route[2 * i]) * k;
  where.y = route[2 * i + 1] + (route[2 * i + 3] - route[2 * i + 1]) * k;
  // The heading over a few points, so a boat does not twitch at each one.
  const a = i >= 2 ? i - 2 : 0, b = i + 3 <= last ? i + 3 : last;
  const dx = route[2 * b] - route[2 * a], dy = route[2 * b + 1] - route[2 * a + 1];
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  where.dx = dx / len;
  where.dy = dy / len;
}

/** The small life. `ctx` is the world's seed, size and sites. */
export function lifeLayer(ctx: LayerContext): LifeLayer {
  const seed = ctx.seed;
  const art = artSet();
  const wool: Readonly<Record<string, readonly [number, number, number?]>> = {
    w: [M.whitewash, 12], s: [M.whitewash, 5], k: [M.stoneDark, 1],
  };
  const sheepGraze = art.add(["www.", "sswk"], 1, 1, wool);
  const sheepLook = art.add(["wwwk", "ssw."], 1, 1, wool);
  const feather: Readonly<Record<string, readonly [number, number, number?]>> = {
    W: [M.whitewash, 15], g: [M.roofSlate, 6], d: [M.roofSlate, 4, 150], k: [M.stoneDark, 1], s: [M.stoneDark, 2, 105],
  };
  // White strokes with a slate stroke under them, as a pen would draw a bird: they read over pale ground and dark.
  // At rest: a dark eye and wingtip, a slate back, and a little shadow on the sand.
  const gullRest = art.add(["..k", "kgW", ".ss"], 1, 1, feather);
  const gullUp = art.add(["W...W", "dWWWd", ".ddd."], 2, 1, feather);
  const gullLevel = art.add(["WWWWW", "ddddd"], 2, 0, feather);
  const gullDown = art.add([".WWW.", "WdddW", "d...d"], 2, 0, feather);
  const flap = [gullUp, gullLevel, gullDown, gullLevel] as const;
  const boatSprite = art.add([
    "..s...",
    "..ss..",
    "..sss.",
    "..m...",
    "hhhhhh",
    ".kkkk.",
  ], 3, 5, { s: [M.sailcloth, 13], m: [M.timber, 2], h: [M.timber, 10], k: [M.timber, 3] });

  const wheelers: Wheeler[] = [];
  const boats: Boat[] = [];
  const towns: { x: number; y: number }[] = [];
  for (let s = 0; s < ctx.sites.length; s++) {
    const site = ctx.sites[s];
    const town = site.type === "town";
    if (!town && site.type !== "lighthouse") continue;
    const count = town ? 9 : 5, spread = town ? 105 : 42;
    for (let k = 0; k < count; k++) {
      const h = hash2(s * 31 + k, 7, seed ^ 0x6a11);
      const ang = ((h & 1023) / 1024) * TAU, out = spread * Math.sqrt(((h >>> 10) & 255) / 255);
      wheelers.push({
        // Town gulls keep to the seaward half of the sky when there is one: south of the roofs.
        x: site.x + out * pcos(ang),
        y: site.y + (town ? 30 : 0) + out * psin(ang),
        r: 10 + ((h >>> 18) & 15),
        turn: (0.26 + ((h >>> 22) & 7) * 0.02) * ((h >>> 25) & 1 ? 1 : -1),
        phase: ((h >>> 26) / 64) * TAU,
        alt: 42 + ((mix32(h) & 15) * 1.5),
        h: mix32(h + 1),
      });
    }
    if (!town) continue;
    towns.push({ x: site.x, y: site.y });
    const hashes: number[] = [], fars: number[] = [];
    for (let k = 0; k < BOATS; k++) {
      hashes.push(hash2(s * 31 + k, 11, seed ^ 0x0b0a));
      fars.push(BOAT_FAR + ((hashes[k] >>> 8) & 127));
    }
    const plan = planHarbour(ctx.land, ctx.n, site.x, site.y, fars);
    if (!plan) continue;
    for (let k = 0; k < BOATS; k++) {
      const route = plan.routes[k], h = hashes[k];
      if (!route || route.length < 8) continue;
      boats.push({
        route,
        length: (route.length / 2 - 1) * ROUTE_STEP,
        berth: 3 + (h & 15),
        period: 150 + ((h >>> 16) & 63),
        phase: ((h >>> 22) & 1023) / 1024,
      });
    }
  }

  const layer: LifeLayer = {
    name: "life",
    log: null,
    draw(f: LiveFrame): void {
      art.sync(f.palette);
      smoke(f);
      sheep(f);
      sail(f);
      shoreGulls(f);
      wheel(f);
    },
  };

  const note = (kind: Placed["kind"], px: number, py: number): void => {
    if (layer.log) layer.log.push({ kind, px, py });
  };

  /** Sheep: flocks of three to five on a 40 × 32 lattice, one cell in four. */
  function sheep(f: LiveFrame): void {
    const { t, n } = f;
    const w = f.rect.w, h = f.rect.h, rx = f.rect.x, ry = f.rect.y;
    const perX = n / 40, perY = (n * 0.8) / 32;
    // A sheep covers a pixel left of where it stands to two right, and the row above: with its walk, those on
    // pixels −2 − SHEEP_WALK … w + SHEEP_WALK and rows 0 … h can show.
    const xLo = -2 - SHEEP_WALK, xHi = w + SHEEP_WALK;
    const cx1 = Math.floor((rx + xHi) / 40), cy1 = Math.floor((ry + h) / 32);
    for (let cy = Math.floor(ry / 32) - 1; cy <= cy1; cy++) for (let cx = Math.floor((rx + xLo) / 40) - 1; cx <= cx1; cx++) {
      const hc = hash2(modP(cx, perX), modP(cy, perY), seed ^ 0x5eeb);
      if ((hc & 3) !== 0) continue;
      const fx = cx * 40 + 9 + ((hc >>> 4) % 22), fy = cy * 32 + 7 + ((hc >>> 10) % 18);
      const count = 3 + ((hc >>> 16) % 3);
      for (let k = 0; k < count; k++) {
        const g = mix32(hc + Math.imul(k + 1, 0x9e3779b9));
        const px = fx + (g % 19) - 9 - rx, py = fy + ((g >>> 8) % 13) - 6 - ry;
        if (px < xLo || px > xHi || py < 0 || py > h) continue;
        const v = bakeAt(f, px, py);
        if (isPasture[v & 255] === 0 || ((v >>> 8) & 255) >= 64) continue;
        const row = worldRowAt(f, px, py);
        if (0.8 * row - (ry + py) < UPLAND) continue;
        // A slow walk out along the slope and back, with long stops to graze at each end.
        const period = 26 + ((g >>> 12) & 31);
        const ph = (t / period + ((g >>> 20) & 1023) / 1024) % 1;
        const reach = 2 + ((g >>> 5) & 3);
        const dir = (g >>> 3) & 1 ? 1 : -1;
        const want = ph < 0.3 ? 0 : ph < 0.44 ? Math.round((reach * (ph - 0.3)) / 0.14) : ph < 0.8 ? reach : ph < 0.94 ? Math.round(reach * (1 - (ph - 0.8) / 0.14)) : 0;
        let at = 0;
        while (at < want) {
          const u = bakeAt(f, px + dir * (at + 1), py);
          if (isPasture[u & 255] === 0 || ((u >>> 8) & 255) >= 64 || Math.abs((u >>> 16) - (v >>> 16)) > 12) break;
          at++;
        }
        const sx = px + dir * at;
        const going = ph < 0.62 ? dir : -dir;
        // Head up for a moment now and then; down to the grass otherwise.
        const up = ((t / 7 + ((g >>> 14) & 255) / 256) % 1) < 0.16;
        drawSprite(f, up ? sheepLook : sheepGraze, rx + sx, row, 0.8 * row - (ry + py), going < 0);
        note("sheep", sx, py);
      }
    }
  }

  /** Gulls on the beaches: a group of three to six to each cell of a 32 × 32 lattice, of which those on sand or shingle show. */
  function shoreGulls(f: LiveFrame): void {
    const { t, n } = f;
    const w = f.rect.w, h = f.rect.h, rx = f.rect.x, ry = f.rect.y;
    const perX = n / 32, perY = (n * 0.8) / 32;
    // A gull at rest covers the pixels round where it stands; one in the air can be a long way from its beach. With a
    // flier about, every beach a startled gull could fly into the frame from is looked at.
    const fl = f.flier;
    const side = fl ? FLEE_SIDE : 1, above = fl ? FLEE_DOWN : 1, below = fl ? FLEE_UP : 1;
    const cx1 = Math.floor((rx + w + side) / 32), cy1 = Math.floor((ry + h + below) / 32);
    for (let cy = Math.floor((ry - above) / 32) - 1; cy <= cy1; cy++) for (let cx = Math.floor((rx - side) / 32) - 1; cx <= cx1; cx++) {
      // The cell's gulls stand on bake pixels cx·32 + 1 … + 30 by cy·32 + 4 … + 27. Past the pixels a resting gull
      // covers, only one the flier may have startled can show: a cell with neither is passed over unhashed.
      const bx0 = cx * 32 + 1, by0 = cy * 32 + 4;
      const rests = bx0 + 29 >= rx - 1 && bx0 <= rx + w && by0 + 23 >= ry - 1 && by0 <= ry + h;
      // A cell wholly within the pixels where gulls rest needs no test: any of its gulls may be drawn.
      const whole = bx0 >= rx - 1 && bx0 + 29 <= rx + w && by0 >= ry - 1 && by0 + 23 <= ry + h;
      const may = !whole && fl !== undefined && mayStartle(fl, n, bx0, bx0 + 29, by0, by0 + 23);
      if (!rests && !may) continue;
      const hc = hash2(modP(cx, perX), modP(cy, perY), seed ^ 0x9011);
      const fx = cx * 32 + 8 + ((hc >>> 4) % 16), fy = cy * 32 + 8 + ((hc >>> 10) % 16);
      const count = 3 + ((hc >>> 16) & 3);
      for (let k = 0; k < count; k++) {
        const g = mix32(hc + Math.imul(k + 1, 0x9e3779b9));
        const px = fx + (g % 15) - 7 - rx, py = fy + ((g >>> 8) % 9) - 4 - ry;
        if (px < -side || px > w + side || py < -above || py > h + below) continue;
        const resting = px >= -1 && px <= w && py >= -1 && py <= h;
        if (!resting && !may) continue;
        const v = bakeAt(f, px, py);
        if (isBeach[v & 255] === 0 || ((v >>> 8) & 255) >= 64) continue;
        const row = worldRowAt(f, px, py);
        const ground = 0.8 * row - (ry + py);
        const tau = startledFor(f.flier, n, rx + px, row, ground);
        if (tau < 0 || !f.flier) {
          if (!resting) continue;
          drawSprite(f, gullRest, rx + px, row, ground, (g & 16) !== 0);
          note("gull-resting", px, py);
          continue;
        }
        flee(f.flier, n, rx + px, row, tau, g);
        const wing = flap[Math.floor(t * 7 + (g & 3)) & 3];
        drawSprite(f, wing, rx + px + fled.dx, row + fled.dy, ground + fled.up, false);
        note("gull-startled", px, py);
      }
    }
  }

  /** Gulls wheeling round the town and the lighthouses. */
  function wheel(f: LiveFrame): void {
    const { t, n } = f;
    const w = f.rect.w, h = f.rect.h;
    for (let k = 0; k < wheelers.length; k++) {
      const g = wheelers[k];
      const ang = g.phase + g.turn * t;
      let x = g.x + g.r * pcos(ang), y = g.y + g.r * psin(ang);
      let alt = g.alt + 3 * psin(ang * 0.37 + g.phase);
      // Mostly a glide, wings held up a little; a few beats now and then.
      let wing = gullUp;
      const beat = (t * 0.21 + (g.h & 255) / 256) % 1;
      if (beat < 0.22) wing = flap[Math.floor(t * 6) & 3];
      const tau = startledFor(f.flier, n, x, y, alt);
      if (tau >= 0 && f.flier) {
        flee(f.flier, n, x, y, tau, g.h);
        x += fled.dx;
        y += fled.dy;
        alt += fled.up;
        wing = flap[Math.floor(t * 7 + (g.h & 3)) & 3];
      }
      const sx = frameX(f, x, 4), sy = frameY(f, 0.8 * y - alt, 4);
      if (sx >= w + 4 || sy >= h + 4) continue;
      drawSprite(f, wing, x, y, alt, false);
      note("gull", sx, sy);
    }
  }

  /**
   * Boats: each lies off the harbour in the roads, sails out along its own route to sea, turns, and comes home the
   * same way. The routes keep to the water, so a boat is in sight the whole way round.
   */
  function sail(f: LiveFrame): void {
    const { out, bake, palette, t } = f;
    const w = f.rect.w, h = f.rect.h;
    for (let k = 0; k < boats.length; k++) {
      const b = boats[k];
      const u = (t / b.period + b.phase) % 1;
      const outward = u < 0.5;
      routeAt(b.route, b.berth + (b.length - b.berth) * (0.5 - 0.5 * pcos(TAU * u)));
      const x = where.x, y = where.y;
      const sign = outward ? 1 : -1;
      const dx = sign * where.dx, dy = sign * where.dy;
      // Frame pixel of the boat's point, in [−BOAT_REACH, …) when it is in reach: it and its wake can show.
      const px = frameX(f, x, BOAT_REACH), py = frameY(f, 0.8 * y, BOAT_REACH);
      if (px >= w + BOAT_REACH || py >= h + BOAT_REACH) continue;
      // Clear water under the whole hull: the routes are planned on a coarse grid, and a rock or a quay may lie on one.
      let clear = true;
      for (let q = -4; q <= 4; q += 2) {
        const v = bakeAt(f, px + q, py);
        if (isSea[v & 255] === 0) { clear = false; break; }
      }
      if (!clear) continue;
      // The wake: a few pale pixels astern, on the water's own ramp, breaking up as they fall behind.
      const wx = -dx, wy = -dy * 0.8;
      const crawl = Math.floor(t * 2.5);
      for (let j = 3; j <= 9; j++) {
        if (j > 5 && ((j + crawl) % 3) === 0) continue;
        const qx = px + Math.round(wx * j), qy = py + Math.round(wy * j);
        if (qx < 0 || qx >= w || qy < 0 || qy >= h) continue;
        const q = qy * w + qx;
        const v = bake[q];
        if (isSea[v & 255] === 0 || ((v >>> 8) & 255) >= 64) continue;
        const tone = j <= 5 ? 0 : 2;
        if (((v >>> 8) & 15) > tone) out[q] = palette[((v & 255) << 8) | tone];
      }
      drawSprite(f, boatSprite, x, y, 0, dx < 0);
      note("boat", px, py);
    }
  }

  /** Chimney smoke: wisps rising from the top of one roof in three, pale with a cool shade under them, leaning downwind. */
  function smoke(f: LiveFrame): void {
    const { out, palette, t, n } = f;
    if (towns.length === 0) return;
    const w = f.rect.w, h = f.rect.h, rx = f.rect.x, ry = f.rect.y;
    // Only when a town is near enough the frame for its roofs to smoke into it: SMOKE_REACH, the frame's half-diagonal in
    // cells, and SMOKE_SLACK for the plumes and for roofs standing high (520 in all for the flight page's frame).
    const midX = rx + w / 2, midY = (ry + h / 2) / 0.8;
    const reach = SMOKE_REACH + Math.hypot(w / 2, h / 2 / 0.8) + SMOKE_SLACK;
    let near = false;
    for (let s = 0; s < towns.length; s++) {
      const dx = ringDelta(towns[s].x, midX, n), dy = ringDelta(towns[s].y, midY, n);
      if (dx * dx + dy * dy < reach * reach) near = true;
    }
    if (!near) return;
    const pale = palette[(M.whitewash << 8) | 15], shade = palette[(M.roofSlate << 8) | 7];
    const perX = n / 20, perY = (n * 0.8) / 16;
    // A roof SMOKE_LEAN left of the frame, or SMOKE_UP below it, can still smoke into it.
    const cx1 = Math.floor((rx + w) / 20), cy1 = Math.floor((ry + h + SMOKE_UP) / 16);
    for (let cy = Math.floor(ry / 16); cy <= cy1; cy++) for (let cx = Math.floor((rx - SMOKE_LEAN) / 20); cx <= cx1; cx++) {
      const hc = hash2(modP(cx, perX), modP(cy, perY), seed ^ 0x50c7);
      if ((hc & 1) !== 0) continue;
      // The first of a few fixed tries in the cell that lands on a roof: the land's, on the frame or past it.
      let px = 0, py = 0, found = false;
      for (let k = 0; k < 5; k++) {
        const g = mix32(hc + k);
        const qx = cx * 20 + (g % 20) - rx, qy = cy * 16 + ((g >>> 8) & 15) - ry;
        if (isRoof[bakeAt(f, qx, qy) & 255] === 0) continue;
        px = qx;
        py = qy;
        found = true;
        break;
      }
      if (!found || px < -SMOKE_LEAN || px >= w + 1 || py < 1 || py >= h + SMOKE_UP) continue;
      // Up to the ridge.
      let climb = 0;
      while (climb < 8 && isRoof[bakeAt(f, px, py - 1) & 255] === 1) { py--; climb++; }
      const row = worldRowAt(f, px, py);
      let inTown = false;
      for (let s = 0; s < towns.length; s++) {
        const dx = ringDelta(towns[s].x, rx + px, n), dy = ringDelta(towns[s].y, row, n);
        if (dx * dx + dy * dy < SMOKE_REACH * SMOKE_REACH) inTown = true;
      }
      if (!inTown) continue;
      note("smoke", px, py);
      // The thread: a pale pixel a row with its shade on the lee side, so it shows on limewash and on trees alike.
      // Its bends travel up it, breaks rise through it to part it into wisps, and it thins as it climbs and leans.
      const bend = t * 1.5 + ((hc >>> 16) & 255) / 40;
      const tall = 12 + ((hc >>> 24) & 3);
      const gap = 7 + ((hc >>> 12) & 7) - (Math.floor(t * 3) % 7);
      for (let j = 1; j <= tall; j++) {
        const qy = py - j;
        if (qy < 0) break;
        if (qy >= h || (j > 2 && (j + gap) % 7 === 0)) continue;
        const u = j / tall;
        const qx = px + Math.round(6 * u * u + (0.5 + u) * psin(j * 0.7 - bend));
        if (qx < -1 || qx >= w) continue;
        const a = Math.round(245 * (1 - u * 0.6));
        if (qx >= 0) blend(out, qy * w + qx, pale, a);
        if (qx + 1 < w) blend(out, qy * w + qx + 1, shade, (a * 5) >> 3);
      }
    }
  }

  return layer;
}
