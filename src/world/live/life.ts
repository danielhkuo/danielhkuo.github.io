// Small life: sheep on the pastures, gulls resting on the beaches and wheeling over the harbour and the lighthouses,
// boats working out of the town's harbour, and smoke from a few chimneys.
//
// Everything is a function of the seed, the place and the clock. Things that stand on the land are placed on a lattice
// in bake space (which is fixed to the world) and drawn only where the bake pixel under them is the right material;
// things in the air are placed in world space round the sites. Birds near the flier lift and scatter, then settle: the
// one thing the layer remembers is which birds are up, since when, and which way they fled, so a bird keeps to its
// flight whatever the flier does next (see `scares`). Boats keep to routes planned round the land (routes.ts), out from
// the roads off the harbour and home to them, and float on the water drawn under them.

import { hash2, mix32 } from "../core/hash.ts";
import { pcos, psin } from "../core/psin.ts";
import { MATERIAL as M } from "../look/materials.ts";
import { artSet, blend, frameX, frameY, modP, ringDelta, smooth01 } from "./art.ts";
import type { Flier, LiveFrame, LiveLayer } from "./live.ts";
import type { LayerContext } from "./registry.ts";
import { planHarbour, ROUTE_STEP } from "./routes.ts";
import { drawSprite, worldRowAt } from "./sprites.ts";

// ── Tuning ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Sheep keep to pasture at least this high over the sea. */
export const UPLAND = 14;
/** A bird takes off when the flier's track passes within this many cells of it, no more than LOW units over it. */
export const REACH = 46;
export const LOW = 60;
/** Seconds a startled bird stays up. */
export const ALOFT = 4.4;
/** The flier must be going at least this fast (cells a second) to put birds up: one that has landed lets them settle. */
const STIR = 6;
/**
 * Frames further apart than this (seconds), or a flier that has moved further than it could have, start the birds'
 * memory afresh: as if the flier had come the way it is heading (see `startledFor`).
 */
const GAP = 0.5;
/** Boats turn for home at least this far from the roads off the harbour, by water. */
const BOAT_FAR = 190;
/** Smoke rises only from roofs within this many cells of a town. */
const SMOKE_REACH = 190;
/** Boats to a town, fanned over the sea its harbour opens on. */
const BOATS = 12;

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

/**
 * What the layer drew last frame, for tests: the kind, the frame pixel it stands on, which one it is (the same thing
 * keeps its id from frame to frame, within its kind) and the frame pixel its sprite's anchor was drawn on.
 */
export interface Placed {
  kind: "sheep" | "gull-resting" | "gull-startled" | "gull" | "boat" | "smoke";
  px: number;
  py: number;
  id: number;
  ax: number;
  ay: number;
  /** Whether the sprite was drawn mirrored. */
  flip: boolean;
}

export interface LifeLayer extends LiveLayer {
  /** Set to an array to have each frame's placements pushed onto it. */
  log: Placed[] | null;
}

// ── Startling ────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Seconds since the flier's track came within REACH of a bird at world (x, y), `ground` units up; −1 when it has not,
 * the bird has settled again, or the flier is more than LOW over it. The track is the flier's heading held straight:
 * the best guess at the past when there is no memory of it (the first frame, or after a jump).
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

/** A bird in the air: when it took off, the flier's heading then, and the side of the flier's way it fled to. */
interface Up {
  t0: number;
  hx: number;
  hy: number;
  side: 1 | -1;
}

/** Where a bird is in its flight, relative to its perch (cells, and units up), and seconds into it: −1 on its perch. */
export interface Fled {
  dx: number;
  dy: number;
  up: number;
  tau: number;
}

export interface Scares {
  /** Call once a frame, before `bird`: the frame's time and flier. */
  frame(t: number, flier: Flier | undefined): void;
  /**
   * The bird `id` (any number, the same every frame) perched at world (x, y), `ground` units up, with hash `h` for its
   * own way of flying: fills and returns where it is in its flight this frame.
   */
  bird(id: number, x: number, y: number, ground: number, h: number): Fled;
}

/**
 * Which birds are up. A bird takes off when the flier, going at STIR or more and within LOW of its height, comes within
 * REACH of it (looked for along the flier's way since the last frame, so no frame rate lets one slip), and flies for
 * ALOFT seconds out to the side of the flier's way and back to its perch. Its flight is fixed when it takes off, so the
 * flier turning, climbing, slowing or landing never moves a bird already up. A frame with no memory behind it (the
 * first, one after a gap of more than GAP seconds or a time earlier than the last, or one where the flier has moved
 * further than it could have) starts afresh, the birds up as if the flier had come the way it is heading.
 */
export function scares(n: number): Scares {
  const ups = new Map<number, Up>();
  const fled: Fled = { dx: 0, dy: 0, up: 0, tau: -1 };
  let fl: Flier | undefined;
  let t = 0;
  let fresh = true;
  // The flier at the last frame, and its way from there to now relative to it (for take-offs between frames).
  let had = false, lastT = 0, lastX = 0, lastY = 0, lastAlt = 0, lastSpeed = 0, wayX = 0, wayY = 0;

  const rest = (): Fled => {
    fled.dx = 0;
    fled.dy = 0;
    fled.up = 0;
    fled.tau = -1;
    return fled;
  };

  /** Share of the way since the last frame at which the flier came within REACH of (x, y), or −1 if it did not. */
  const reached = (x: number, y: number): number => {
    if (!fl) return -1;
    // From the bird to the flier at the last frame (a), and along its way since (d).
    const ax = ringDelta(x, fl.x, n) - wayX, ay = ringDelta(y, fl.y, n) - wayY;
    const aa = ax * ax + ay * ay;
    if (aa <= REACH * REACH) return 0;
    const dd = wayX * wayX + wayY * wayY;
    if (dd === 0) return -1;
    const ad = ax * wayX + ay * wayY;
    const disc = ad * ad - dd * (aa - REACH * REACH);
    if (disc < 0) return -1;
    const u = (-ad - Math.sqrt(disc)) / dd;
    return u >= 0 && u <= 1 ? u : -1;
  };

  return {
    frame(time, flier) {
      t = time;
      fl = flier;
      fresh = true;
      if (fl && had && t >= lastT && t - lastT <= GAP) {
        const dt = t - lastT;
        wayX = ringDelta(lastX, fl.x, n);
        wayY = ringDelta(lastY, fl.y, n);
        const most = (fl.speed > lastSpeed ? fl.speed : lastSpeed) * 1.5 * dt + 4;
        const climb = fl.alt - lastAlt;
        fresh = wayX * wayX + wayY * wayY > most * most || climb > 45 * dt + 4 || climb < -45 * dt - 4;
      }
      if (fresh) {
        ups.clear();
        wayX = 0;
        wayY = 0;
      } else {
        for (const [id, up] of ups) if (t - up.t0 >= ALOFT) ups.delete(id);
      }
      had = fl !== undefined;
      if (fl) {
        lastT = t;
        lastX = fl.x;
        lastY = fl.y;
        lastAlt = fl.alt;
        lastSpeed = fl.speed;
      }
    },
    bird(id, x, y, ground, h) {
      let up = ups.get(id);
      if (up === undefined) {
        if (!fl || fl.speed < STIR) return rest();
        let t0: number;
        if (fresh) {
          const tau = startledFor(fl, n, x, y, ground);
          if (tau < 0) return rest();
          t0 = t - tau;
        } else {
          const over = fl.alt - ground;
          if (over > LOW || over < -LOW) return rest();
          const u = reached(x, y);
          if (u < 0) return rest();
          t0 = t - (t - lastT) * (1 - u);
        }
        // Out to the side of the flier's way it was on, as it was when the bird took off.
        const hx = pcos(fl.heading), hy = psin(fl.heading);
        const side = ringDelta(fl.x, x, n) * hy - ringDelta(fl.y, y, n) * hx;
        up = { t0, hx, hy, side: side > 0.5 ? 1 : side < -0.5 ? -1 : (h & 1) === 0 ? 1 : -1 };
        ups.set(id, up);
      }
      const tau = t - up.t0;
      if (tau < 0 || tau >= ALOFT) {
        ups.delete(id);
        return rest();
      }
      // Up and out over half a second, wheeling a little, then back down to the perch from 2.6 s.
      const a = smooth01(tau / 0.45) * (1 - smooth01((tau - 2.6) / (ALOFT - 2.6)));
      const { hx, hy, side } = up;
      const far = 20 + ((h >>> 3) & 15) * 1.4;
      const along = (((h >>> 8) & 31) - 15) / 22;
      const turn = tau * 2.6 + ((h >>> 14) & 63) / 10;
      fled.dx = a * (far * (side * hy + along * hx) + 5 * pcos(turn));
      fled.dy = a * (far * (-side * hx + along * hy) + 5 * psin(turn));
      fled.up = a * (13 + ((h >>> 20) & 15) * 0.8);
      fled.tau = tau;
      return fled;
    },
  };
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

  const scare = scares(ctx.n);

  const layer: LifeLayer = {
    name: "life",
    log: null,
    draw(f: LiveFrame): void {
      art.sync(f.palette);
      scare.frame(f.t, f.flier);
      smoke(f);
      sheep(f);
      sail(f);
      shoreGulls(f);
      wheel(f);
    },
  };

  const note = (kind: Placed["kind"], px: number, py: number, id: number, ax = px, ay = py, flip = false): void => {
    if (layer.log) layer.log.push({ kind, px, py, id, ax, ay, flip });
  };

  /** Sheep: flocks of three to five on a 40 × 32 lattice, one cell in four. */
  function sheep(f: LiveFrame): void {
    const { bake, t, n } = f;
    const w = f.rect.w, h = f.rect.h, rx = f.rect.x, ry = f.rect.y;
    const perX = n / 40, perY = (n * 0.8) / 32;
    const cx1 = Math.floor((rx + w) / 40), cy1 = Math.floor((ry + h) / 32);
    for (let cy = Math.floor(ry / 32) - 1; cy <= cy1; cy++) for (let cx = Math.floor(rx / 40) - 1; cx <= cx1; cx++) {
      const hc = hash2(modP(cx, perX), modP(cy, perY), seed ^ 0x5eeb);
      if ((hc & 3) !== 0) continue;
      const fx = cx * 40 + 9 + ((hc >>> 4) % 22), fy = cy * 32 + 7 + ((hc >>> 10) % 18);
      const count = 3 + ((hc >>> 16) % 3);
      for (let k = 0; k < count; k++) {
        const g = mix32(hc + Math.imul(k + 1, 0x9e3779b9));
        const px = fx + (g % 19) - 9 - rx, py = fy + ((g >>> 8) % 13) - 6 - ry;
        if (px < 6 || px >= w - 6 || py < 2 || py >= h) continue;
        const i = py * w + px;
        const v = bake[i];
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
          const u = bake[i + dir * (at + 1)];
          if (isPasture[u & 255] === 0 || ((u >>> 8) & 255) >= 64 || Math.abs((u >>> 16) - (v >>> 16)) > 12) break;
          at++;
        }
        const sx = px + dir * at;
        const going = ph < 0.62 ? dir : -dir;
        // Head up for a moment now and then; down to the grass otherwise.
        const up = ((t / 7 + ((g >>> 14) & 255) / 256) % 1) < 0.16;
        drawSprite(f, up ? sheepLook : sheepGraze, rx + sx, row, 0.8 * row - (ry + py), going < 0);
        note("sheep", sx, py, (modP(cy, perY) * perX + modP(cx, perX)) * 8 + k);
      }
    }
  }

  /** Gulls on the beaches: a group of three to six to each cell of a 32 × 32 lattice, of which those on sand or shingle show. */
  function shoreGulls(f: LiveFrame): void {
    const { bake, t, n } = f;
    const w = f.rect.w, h = f.rect.h, rx = f.rect.x, ry = f.rect.y;
    const perX = n / 32, perY = (n * 0.8) / 32;
    const cx1 = Math.floor((rx + w) / 32), cy1 = Math.floor((ry + h) / 32);
    for (let cy = Math.floor(ry / 32) - 1; cy <= cy1; cy++) for (let cx = Math.floor(rx / 32) - 1; cx <= cx1; cx++) {
      const hc = hash2(modP(cx, perX), modP(cy, perY), seed ^ 0x9011);
      const fx = cx * 32 + 8 + ((hc >>> 4) % 16), fy = cy * 32 + 8 + ((hc >>> 10) % 16);
      const count = 3 + ((hc >>> 16) & 3);
      for (let k = 0; k < count; k++) {
        const g = mix32(hc + Math.imul(k + 1, 0x9e3779b9));
        const px = fx + (g % 15) - 7 - rx, py = fy + ((g >>> 8) % 9) - 4 - ry;
        if (px < 1 || px >= w - 1 || py < 1 || py >= h) continue;
        const v = bake[py * w + px];
        if (isBeach[v & 255] === 0 || ((v >>> 8) & 255) >= 64) continue;
        const row = worldRowAt(f, px, py);
        const ground = 0.8 * row - (ry + py);
        const id = (modP(cy, perY) * perX + modP(cx, perX)) * 8 + k;
        const fled = scare.bird(id, rx + px, row, ground, g);
        if (fled.tau < 0) {
          drawSprite(f, gullRest, rx + px, row, ground, (g & 16) !== 0);
          note("gull-resting", px, py, id);
          continue;
        }
        const wing = flap[Math.floor(t * 7 + (g & 3)) & 3];
        drawSprite(f, wing, rx + px + fled.dx, row + fled.dy, ground + fled.up, false);
        const ax = frameX(f, rx + px + fled.dx, 8), ay = frameY(f, 0.8 * (row + fled.dy) - ground - fled.up, 8);
        note("gull-startled", px, py, id, ax, ay);
      }
    }
  }

  /** Gulls wheeling round the town and the lighthouses. */
  function wheel(f: LiveFrame): void {
    const { t } = f;
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
      const fled = scare.bird(-1 - k, x, y, alt, g.h);
      if (fled.tau >= 0) {
        x += fled.dx;
        y += fled.dy;
        alt += fled.up;
        wing = flap[Math.floor(t * 7 + (g.h & 3)) & 3];
      }
      const sx = frameX(f, x, 4), sy = frameY(f, 0.8 * y - alt, 4);
      if (sx >= w + 4 || sy >= h + 4) continue;
      drawSprite(f, wing, x, y, alt, false);
      note("gull", sx, sy, k);
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
      const px = frameX(f, x, 8), py = frameY(f, 0.8 * y, 8);
      if (px < 5 || px >= w - 5 || py < 6 || py >= h - 1) continue;
      // Clear water under the whole hull: the routes are planned on a coarse grid, and a rock or a quay may lie on one.
      const i = py * w + px;
      let clear = true;
      for (let q = -4; q <= 4; q += 2) {
        const v = bake[i + q];
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
      // It floats on the water drawn under it: its depth is that water's own row, so the sea it sits on never hides its
      // keel. (Its route's row can lie up to a row and a half short of it, as the pixel rounds.)
      const surf = worldRowAt(f, px, py);
      if (Math.abs(ringDelta(y, surf, f.n)) <= 2.5) drawSprite(f, boatSprite, x, surf, 0.8 * surf - (f.rect.y + py), dx < 0);
      else drawSprite(f, boatSprite, x, y, 0, dx < 0);
      note("boat", px, py, k, px, py, dx < 0);
    }
  }

  /** Chimney smoke: wisps rising from the top of one roof in three, pale with a cool shade under them, leaning downwind. */
  function smoke(f: LiveFrame): void {
    const { out, bake, palette, t, n } = f;
    if (towns.length === 0) return;
    const w = f.rect.w, h = f.rect.h, rx = f.rect.x, ry = f.rect.y;
    // Only when a town is anywhere near the frame.
    const midX = rx + w / 2, midY = (ry + h / 2) / 0.8;
    let near = false;
    for (let s = 0; s < towns.length; s++) {
      const dx = ringDelta(towns[s].x, midX, n), dy = ringDelta(towns[s].y, midY, n);
      if (dx * dx + dy * dy < 520 * 520) near = true;
    }
    if (!near) return;
    const pale = palette[(M.whitewash << 8) | 15], shade = palette[(M.roofSlate << 8) | 7];
    const perX = n / 20, perY = (n * 0.8) / 16;
    const cx1 = Math.floor((rx + w) / 20), cy1 = Math.floor((ry + h) / 16);
    for (let cy = Math.floor(ry / 16); cy <= cy1; cy++) for (let cx = Math.floor(rx / 20); cx <= cx1; cx++) {
      const hc = hash2(modP(cx, perX), modP(cy, perY), seed ^ 0x50c7);
      if ((hc & 1) !== 0) continue;
      // The first of a few fixed tries in the cell that lands on a roof.
      let px = -1, py = -1;
      for (let k = 0; k < 5; k++) {
        const g = mix32(hc + k);
        const qx = cx * 20 + (g % 20) - rx, qy = cy * 16 + ((g >>> 8) & 15) - ry;
        if (qx < 0 || qx >= w || qy < 12 || qy >= h) continue;
        if (isRoof[bake[qy * w + qx] & 255] === 0) continue;
        px = qx;
        py = qy;
        break;
      }
      if (px < 0) continue;
      // Up to the ridge.
      let climb = 0;
      while (climb < 8 && py > 0 && isRoof[bake[(py - 1) * w + px] & 255] === 1) { py--; climb++; }
      const row = worldRowAt(f, px, py);
      let inTown = false;
      for (let s = 0; s < towns.length; s++) {
        const dx = ringDelta(towns[s].x, rx + px, n), dy = ringDelta(towns[s].y, row, n);
        if (dx * dx + dy * dy < SMOKE_REACH * SMOKE_REACH) inTown = true;
      }
      if (!inTown) continue;
      note("smoke", px, py, modP(cy, perY) * perX + modP(cx, perX));
      // The thread: a pale pixel a row with its shade on the lee side, so it shows on limewash and on trees alike.
      // Its bends travel up it, breaks rise through it to part it into wisps, and it thins as it climbs and leans.
      const bend = t * 1.5 + ((hc >>> 16) & 255) / 40;
      const tall = 12 + ((hc >>> 24) & 3);
      const gap = 7 + ((hc >>> 12) & 7) - (Math.floor(t * 3) % 7);
      for (let j = 1; j <= tall; j++) {
        const qy = py - j;
        if (qy < 0) break;
        if (j > 2 && (j + gap) % 7 === 0) continue;
        const u = j / tall;
        const qx = px + Math.round(6 * u * u + (0.5 + u) * psin(j * 0.7 - bend));
        if (qx < 0 || qx >= w - 1) continue;
        const a = Math.round(245 * (1 - u * 0.6));
        blend(out, qy * w + qx, pale, a);
        blend(out, qy * w + qx + 1, shade, (a * 5) >> 3);
      }
    }
  }

  return layer;
}
